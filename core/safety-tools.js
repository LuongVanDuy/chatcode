const crypto = require('crypto');
const { createBrainService } = require('./brain');
const { chatError, normalizeError } = require('./errors');

const SENSITIVE_NAMES = new Set(['.env','.env.local','.env.production','wp-config.php','id_rsa','id_ed25519','credentials.json']);
function normalizeRel(value) { return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, ''); }
function isSensitive(relPath) { return normalizeRel(relPath).split('/').filter(Boolean).some(part => SENSITIVE_NAMES.has(part.toLowerCase()) || part.toLowerCase() === '.ssh' || /private.*key/i.test(part)); }
function requirePermission(project, key, label) { if (!project.permissions?.[key]) throw chatError('PERMISSION_DENIED', `Quyền ${label} đang tắt cho dự án "${project.name}".`, { project:project.name, permission:key }); }
function recoveryShape(snapshot) { return { snapshot_created:!!snapshot, snapshot_id:snapshot?.id || null, ...(snapshot ? { recoveryId:snapshot.id } : {}) }; }
function nowMs() { return Number(process.hrtime.bigint() / 1000000n); }

function createSafeToolApi(projects, store, approvals, backups) {
  const base = projects.toolApi;
  const brain = createBrainService(store, projects);
  const jobs = new Map();

  function pruneJobs() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, job] of jobs) if (new Date(job.createdAt).getTime() < cutoff) jobs.delete(id);
  }

  async function maybeExisting(project, rel) {
    try { return await projects.secureResolve(project, rel, { mustExist:true }); }
    catch (error) { if (normalizeError(error).code === 'FILE_NOT_FOUND') return null; throw error; }
  }

  async function approvedWrite(project, relPath, content, approval) {
    const started = nowMs(), rel = normalizeRel(relPath);
    if (!rel) throw chatError('FILE_NOT_FOUND','Đường dẫn file đang trống.');
    if (isSensitive(rel)) throw chatError('SENSITIVE_PATH_BLOCKED','File nhạy cảm đã bị chặn.',{ path:rel });
    await projects.secureResolve(project, rel);
    const existing = await maybeExisting(project, rel);
    const snapshot = existing ? await backups.snapshot(project, rel, existing, 'overwrite') : null;
    const result = await base.writeFile(project.id, rel, content);
    brain.invalidate(project.id);
    return { ...result, approval, ...recoveryShape(snapshot), telemetry:{ filesystem_ms:nowMs() - started } };
  }

  async function approvedDelete(project, relPath, approval) {
    const started = nowMs(), rel = normalizeRel(relPath);
    if (!rel) throw chatError('FILE_NOT_FOUND','Đường dẫn file đang trống.');
    if (isSensitive(rel)) throw chatError('SENSITIVE_PATH_BLOCKED','File nhạy cảm đã bị chặn.',{ path:rel });
    const target = await projects.secureResolve(project, rel, { mustExist:true });
    const snapshot = await backups.snapshot(project, rel, target, 'delete');
    const result = await base.deleteFile(project.id, rel);
    brain.invalidate(project.id);
    return { ...result, approval, ...recoveryShape(snapshot), telemetry:{ filesystem_ms:nowMs() - started } };
  }

  async function approvedRename(project, fromPath, toPath, approval) {
    const started = nowMs(), fromRel = normalizeRel(fromPath), toRel = normalizeRel(toPath);
    if (!fromRel || !toRel) throw chatError('FILE_NOT_FOUND','Đường dẫn rename không hợp lệ.');
    if (isSensitive(fromRel) || isSensitive(toRel)) throw chatError('SENSITIVE_PATH_BLOCKED','File nhạy cảm đã bị chặn.',{ from:fromRel, to:toRel });
    const source = await projects.secureResolve(project, fromRel, { mustExist:true });
    await projects.secureResolve(project, toRel);
    const snapshot = await backups.snapshot(project, fromRel, source, 'rename');
    const result = await base.renameFile(project.id, fromRel, toRel);
    brain.invalidate(project.id);
    return { ...result, approval, ...recoveryShape(snapshot), telemetry:{ filesystem_ms:nowMs() - started } };
  }

  async function approvedPatch(project, change, approval) {
    const rel = normalizeRel(change.path);
    requirePermission(project, 'write', 'ghi file');
    if (!rel) throw chatError('FILE_NOT_FOUND','Đường dẫn patch đang trống.');
    if (isSensitive(rel)) throw chatError('SENSITIVE_PATH_BLOCKED','File nhạy cảm đã bị chặn.',{ path:rel });
    const current = await base.readFile(project.id, rel);
    let text = String(current.content || '');
    const edits = Array.isArray(change.edits) ? change.edits.slice(0, 40) : [];
    if (!edits.length) throw chatError('PATCH_CONFLICT','Patch cần ít nhất một edit.');
    for (const edit of edits) {
      const find = String(edit.find ?? ''), replace = String(edit.replace ?? '');
      if (!find) throw chatError('PATCH_CONFLICT','Edit.find không được để trống.',{ path:rel });
      const occurrences = text.split(find).length - 1;
      if (!occurrences) throw chatError('PATCH_CONFLICT','Không tìm thấy đoạn cần thay thế.',{ path:rel, find:find.slice(0,160) });
      if (!edit.all && occurrences !== 1) throw chatError('PATCH_CONFLICT','Đoạn cần thay thế xuất hiện nhiều hơn một lần.',{ path:rel, occurrences, find:find.slice(0,160) });
      text = edit.all ? text.split(find).join(replace) : text.replace(find, replace);
    }
    const result = await approvedWrite(project, rel, text, approval);
    return { ...result, operation:'patch', edit_count:edits.length };
  }

  async function inspectProject(ref, query, limit = 8) {
    const started = nowMs(), project = store.getProject(ref), telemetry = { total_ms:0, filesystem_ms:0, brain_refresh_ms:0, git_ms:0 };
    const brainStart = nowMs();
    const context = await brain.projectContext(project.id, query, Math.min(16, Math.max(4, Number(limit) || 8)));
    const overview = await brain.projectBrain(project.id);
    telemetry.brain_refresh_ms = nowMs() - brainStart;

    const fsStart = nowMs(), relevantFiles = [];
    for (const item of context.files.slice(0, Math.min(10, Math.max(4, Number(limit) || 8)))) {
      try {
        const read = await base.readFile(project.id, item.path), content = String(read.content || '');
        relevantFiles.push({ ...item, content:content.slice(0, 24000), content_truncated:content.length > 24000 });
      } catch (error) { relevantFiles.push({ ...item, error:normalizeError(error) }); }
    }
    telemetry.filesystem_ms = nowMs() - fsStart;

    const gitStart = nowMs(), gitStatus = await base.gitStatus(project.id);
    telemetry.git_ms = nowMs() - gitStart;
    const git = gitStatus.ok
      ? { is_repository:true, status:gitStatus.stdout, stderr:gitStatus.stderr || '' }
      : (/not a git repository/i.test(gitStatus.stderr || '')
          ? { is_repository:false, error:{ code:'GIT_NOT_REPOSITORY', message:gitStatus.stderr || 'Not a Git repository' } }
          : { is_repository:false, error:{ code:'INTERNAL_ERROR', message:gitStatus.stderr || 'Git status failed' } });
    telemetry.total_ms = nowMs() - started;

    return {
      ok:true,
      project:{ id:project.id, name:project.name, permissions:project.permissions },
      query:String(query || ''),
      frameworks:overview.frameworks,
      framework_names:overview.framework_names,
      primary_language:overview.primary_language,
      entrypoints:overview.entrypoints,
      wordpress:overview.wordpress,
      relevant_files:relevantFiles,
      relevant_relations:context.relations,
      top_symbols:overview.topSymbols.slice(0, 40),
      git,
      telemetry
    };
  }

  function actionForChange(change) {
    const op = String(change?.op || change?.operation || '').toLowerCase();
    if (op === 'write' || op === 'patch') return 'write';
    if (op === 'rename' || op === 'move') return 'rename';
    if (op === 'delete') return 'delete';
    throw chatError('INTERNAL_ERROR',`Change operation không hỗ trợ: ${op || '(trống)'}`);
  }
  function targetForChange(change) {
    const op = String(change?.op || change?.operation || '').toLowerCase();
    return op === 'rename' || op === 'move' ? `${normalizeRel(change.from)} → ${normalizeRel(change.to)}` : normalizeRel(change.path);
  }

  async function verifyChange(project, change) {
    const op = String(change.op || change.operation || '').toLowerCase();
    try {
      if (op === 'write') {
        const read = await base.readFile(project.id, normalizeRel(change.path));
        const expected = String(change.content ?? '');
        return { operation:op, path:normalizeRel(change.path), ok:String(read.content || '') === expected, check:'exact-content' };
      }
      if (op === 'patch') {
        const read = await base.readFile(project.id, normalizeRel(change.path)), text = String(read.content || '');
        const missing = (change.edits || []).filter(edit => String(edit.replace ?? '') && !text.includes(String(edit.replace ?? ''))).map(edit => String(edit.replace ?? '').slice(0,100));
        return { operation:op, path:normalizeRel(change.path), ok:missing.length === 0, check:'patch-replacements', missing };
      }
      if (op === 'rename' || op === 'move') {
        const to = normalizeRel(change.to), from = normalizeRel(change.from);
        await base.readFile(project.id, to);
        let oldMissing = false;
        try { await base.readFile(project.id, from); }
        catch (error) { oldMissing = normalizeError(error).code === 'FILE_NOT_FOUND'; }
        return { operation:op, from, to, ok:oldMissing, check:'new-exists-old-missing' };
      }
      if (op === 'delete') {
        const rel = normalizeRel(change.path); let missing = false;
        try { await base.readFile(project.id, rel); }
        catch (error) { missing = normalizeError(error).code === 'FILE_NOT_FOUND'; }
        return { operation:op, path:rel, ok:missing, check:'deleted-file-missing' };
      }
    } catch (error) { return { operation:op, target:targetForChange(change), ok:false, error:normalizeError(error) }; }
    return { operation:op, ok:false, error:{ code:'INTERNAL_ERROR', message:'Không có verification handler.' } };
  }

  async function executeBatch(job, project, changes, tasks, approvalResults) {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const started = nowMs();
    const telemetry = { total_ms:0, filesystem_ms:0, brain_refresh_ms:0, git_ms:0, write_to_searchable_ms:0, rename_to_brain_ms:0, delete_stale_cleanup_ms:0 };
    const outputs = [], taskOutputs = [], verification = [];
    const mutationStarted = nowMs();

    try {
      for (const change of changes) {
        const op = String(change.op || change.operation || '').toLowerCase(), action = actionForChange(change), approval = approvalResults[action] || { required:false, status:'not_required', approval_id:null };
        const fsStart = nowMs(); let result;
        if (op === 'write') result = await approvedWrite(project, change.path, String(change.content ?? ''), approval);
        else if (op === 'patch') result = await approvedPatch(project, change, approval);
        else if (op === 'rename' || op === 'move') result = await approvedRename(project, change.from, change.to, approval);
        else if (op === 'delete') result = await approvedDelete(project, change.path, approval);
        telemetry.filesystem_ms += nowMs() - fsStart;
        outputs.push({ operation:op, target:targetForChange(change), ...result });
      }

      if (changes.length) {
        const brainStart = nowMs();
        await projects.reindex(project.id);
        const refreshed = await brain.rebuild(project.id);
        telemetry.brain_refresh_ms = nowMs() - brainStart;
        const elapsed = nowMs() - mutationStarted;
        if (changes.some(x => ['write','patch'].includes(String(x.op || x.operation).toLowerCase()))) telemetry.write_to_searchable_ms = elapsed;
        if (changes.some(x => ['rename','move'].includes(String(x.op || x.operation).toLowerCase()))) telemetry.rename_to_brain_ms = elapsed;
        if (changes.some(x => String(x.op || x.operation).toLowerCase() === 'delete')) telemetry.delete_stale_cleanup_ms = elapsed;
        job.brain = { updatedAt:refreshed.updatedAt, stats:refreshed.stats };
        for (const change of changes) verification.push(await verifyChange(project, change));
      }

      const taskApproval = approvalResults.task || { required:false, status:'not_required', approval_id:null };
      for (const command of tasks) {
        const taskStart = nowMs(), taskResult = await base.runTask(project.id, command), notification = !!store.settings().activityNotifications;
        const item = { command, ...taskResult, approval:taskApproval, notification_emitted:notification, notification_count:notification ? 1 : 0, duration_ms:nowMs() - taskStart };
        taskOutputs.push(item);
        verification.push({ operation:'task', command, ok:!!taskResult.ok, check:'exit-code', code:taskResult.code });
      }

      const gitStart = nowMs();
      const [gitDiff, gitStatus] = await Promise.all([base.gitDiff(project.id, false), base.gitStatus(project.id)]);
      telemetry.git_ms = nowMs() - gitStart;
      telemetry.total_ms = nowMs() - started;
      const verificationPassed = verification.every(item => item.ok !== false);
      const result = {
        ok:verificationPassed,
        status:'completed',
        job_id:job.id,
        project:project.name,
        changes:outputs,
        tasks:taskOutputs,
        brain:job.brain || null,
        verification,
        verification_passed:verificationPassed,
        git:{ status:gitStatus.ok ? gitStatus.stdout : '', diff:gitDiff.ok ? gitDiff.stdout : '', error:gitDiff.ok && gitStatus.ok ? null : normalizeError(new Error(gitDiff.stderr || gitStatus.stderr || 'Git inspection failed')) },
        git_diff:gitDiff.ok ? gitDiff.stdout : '',
        telemetry
      };
      job.status = 'completed'; job.completedAt = new Date().toISOString(); job.result = result;
      return result;
    } catch (error) {
      telemetry.total_ms = nowMs() - started;
      const normalized = normalizeError(error);
      job.status = normalized.code === 'APPROVAL_REQUIRED' ? 'denied' : 'failed';
      job.completedAt = new Date().toISOString(); job.error = normalized; job.telemetry = telemetry;
      throw error;
    }
  }

  async function applyAndVerify(ref, changesInput = [], tasksInput = []) {
    pruneJobs();
    const project = store.getProject(ref), changes = (Array.isArray(changesInput) ? changesInput : []).slice(0, 24), tasks = (Array.isArray(tasksInput) ? tasksInput : []).map(String).filter(Boolean).slice(0, 6);
    if (!changes.length && !tasks.length) throw chatError('INTERNAL_ERROR','apply_and_verify cần changes hoặc tasks.');

    const actionTargets = new Map();
    for (const change of changes) {
      const action = actionForChange(change);
      if (action === 'write') requirePermission(project, 'write', 'ghi file'); else requirePermission(project, 'manageFiles', 'xóa/đổi tên file');
      const target = targetForChange(change);
      if (isSensitive(target) || isSensitive(change.path) || isSensitive(change.from) || isSensitive(change.to)) throw chatError('SENSITIVE_PATH_BLOCKED','File nhạy cảm đã bị chặn.',{ target });
      if (!actionTargets.has(action)) actionTargets.set(action, []);
      actionTargets.get(action).push(target);
    }
    if (tasks.length) { requirePermission(project, 'tasks', 'chạy tác vụ'); actionTargets.set('task', tasks); }

    const deferred = {}, approvalResults = {}, pendingIds = [];
    for (const [action, targets] of actionTargets) {
      const request = approvals.requestDeferred(project.id, action, { target:targets.slice(0, 8).join(', '), detail:`Fast-path batch: ${targets.length} mục` });
      deferred[action] = request;
      if (request.approval.status === 'denied') { request.promise.catch(() => {}); throw chatError('APPROVAL_REQUIRED','Safety rule đã từ chối fast-path batch.',{ approval:request.approval, action }); }
      if (request.approval.status === 'pending') pendingIds.push(request.approval.approval_id); else approvalResults[action] = request.approval;
    }

    const job = { id:crypto.randomUUID(), createdAt:new Date().toISOString(), status:pendingIds.length ? 'pending' : 'running', projectId:project.id, project:project.name, approval_ids:pendingIds, result:null, error:null };
    jobs.set(job.id, job);
    const waitApprovals = async () => {
      const pairs = await Promise.all(Object.entries(deferred).map(async ([action, request]) => [action, await request.promise]));
      for (const [action, approval] of pairs) approvalResults[action] = approval;
      return approvalResults;
    };

    if (pendingIds.length) {
      waitApprovals().then(results => executeBatch(job, project, changes, tasks, results)).catch(error => { job.status = 'denied'; job.completedAt = new Date().toISOString(); job.error = normalizeError(error); });
      return { ok:true, status:'pending', job_id:job.id, approval:{ required:true, status:'pending', approval_ids:pendingIds }, next_action:'Chờ người dùng duyệt trong ChatCode, sau đó gọi operation_status với job_id. Không retry apply_and_verify.' };
    }
    return executeBatch(job, project, changes, tasks, await waitApprovals());
  }

  function operationStatus(jobId) {
    pruneJobs();
    const job = jobs.get(String(jobId));
    if (!job) throw chatError('FILE_NOT_FOUND','Không tìm thấy fast-path job.',{ job_id:String(jobId) });
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed' || job.status === 'denied') return { ok:false, status:job.status, job_id:job.id, error:job.error, telemetry:job.telemetry || null };
    return { ok:true, status:job.status, job_id:job.id, approval:{ required:job.approval_ids.length > 0, status:job.status === 'pending' ? 'pending' : 'approved', approval_ids:job.approval_ids, states:job.approval_ids.map(id => approvals.status(id)).filter(Boolean) }, next_action:job.status === 'pending' ? 'Chờ Approval Center; không retry mutation.' : 'Đang chạy verification.' };
  }

  return {
    listProjects:(...args) => base.listProjects(...args),
    listFiles:(...args) => base.listFiles(...args),
    search:(...args) => base.search(...args),
    readFile:(...args) => base.readFile(...args),
    readFiles:(...args) => base.readFiles(...args),
    projectBrain:(...args) => brain.projectBrain(...args),
    findSymbols:(...args) => brain.findSymbols(...args),
    findReferences:(...args) => brain.findReferences(...args),
    relatedFiles:(...args) => brain.relatedFiles(...args),
    projectContext:(...args) => brain.projectContext(...args),
    brainStatus:(...args) => brain.status(...args),
    rebuildBrain:(...args) => brain.rebuild(...args),
    inspectProject,
    applyAndVerify,
    operationStatus,

    async writeFile(ref, relPath, content) {
      const project = store.getProject(ref); requirePermission(project, 'write', 'ghi file');
      const rel = normalizeRel(relPath), approval = await approvals.request(project.id, 'write', { target:rel, detail:`Tạo hoặc thay thế ${rel}` });
      return approvedWrite(project, rel, content, approval);
    },
    async deleteFile(ref, relPath) {
      const project = store.getProject(ref); requirePermission(project, 'manageFiles', 'xóa/đổi tên file');
      const rel = normalizeRel(relPath), approval = await approvals.request(project.id, 'delete', { target:rel, detail:`Xóa file ${rel}` });
      return approvedDelete(project, rel, approval);
    },
    async renameFile(ref, fromPath, toPath) {
      const project = store.getProject(ref); requirePermission(project, 'manageFiles', 'xóa/đổi tên file');
      const fromRel = normalizeRel(fromPath), toRel = normalizeRel(toPath), approval = await approvals.request(project.id, 'rename', { target:`${fromRel} → ${toRel}`, detail:`Đổi tên/di chuyển file trong ${project.name}` });
      return approvedRename(project, fromRel, toRel, approval);
    },
    async runTask(ref, commandLine) {
      const project = store.getProject(ref); requirePermission(project, 'tasks', 'chạy tác vụ');
      const command = String(commandLine || '').trim(), approval = await approvals.request(project.id, 'task', { target:command.slice(0,220), detail:'Chạy development task theo allowlist của ChatCode.' });
      const started = nowMs(), taskResult = await base.runTask(project.id, command), notification = !!store.settings().activityNotifications;
      return { ...taskResult, approval, notification_emitted:notification, notification_count:notification ? 1 : 0, telemetry:{ filesystem_ms:0, git_ms:0, brain_refresh_ms:0, total_ms:nowMs() - started } };
    },
    gitStatus:(...args) => base.gitStatus(...args),
    gitDiff:(...args) => base.gitDiff(...args),
    async gitStage(ref, paths) {
      const project = store.getProject(ref); requirePermission(project, 'gitWrite', 'ghi Git');
      const list = Array.isArray(paths) ? paths.slice(0,100).map(normalizeRel).filter(Boolean) : [], approval = await approvals.request(project.id, 'gitStage', { target:`${list.length} file`, detail:list.slice(0,8).join(', ') });
      return { ...(await base.gitStage(project.id, list)), approval };
    },
    async gitCommit(ref, message) {
      const project = store.getProject(ref); requirePermission(project, 'gitWrite', 'ghi Git');
      const text = String(message || '').trim(), approval = await approvals.request(project.id, 'gitCommit', { target:text.slice(0,220), detail:'Tạo local Git commit. ChatCode không push.' });
      return { ...(await base.gitCommit(project.id, text)), approval };
    },
    recordActivity:base.recordActivity
  };
}

module.exports = { createSafeToolApi };