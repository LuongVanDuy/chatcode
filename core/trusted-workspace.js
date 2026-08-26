const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { chatError, normalizeError } = require('./errors');

const SENSITIVE_NAMES = new Set(['.env','.env.local','.env.production','wp-config.php','id_rsa','id_ed25519','credentials.json']);
const normalizeRel = value => String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
const isSensitive = rel => normalizeRel(rel).split('/').filter(Boolean).some(part => SENSITIVE_NAMES.has(part.toLowerCase()) || part.toLowerCase() === '.ssh' || /private.*key/i.test(part));
const isTrusted = project => project?.workspaceMode === 'trusted' || project?.safety?._workspaceMode === 'trusted';
const canUseSecrets = project => isTrusted(project) && !!(project?.trusted?.allowSecrets || project?.safety?._allowSecrets);
const trustedApproval = () => ({ required:false, status:'not_required', approval_id:null, mode:'trusted_workspace' });
const recoveryShape = snapshot => ({ snapshot_created:!!snapshot, snapshot_id:snapshot?.id || null, ...(snapshot ? { recoveryId:snapshot.id } : {}) });

function ensureSecretAccess(project, rel) {
  if (isSensitive(rel) && !canUseSecrets(project)) {
    throw chatError('SENSITIVE_PATH_BLOCKED', 'File nhạy cảm đã bị chặn. Chỉ Trusted Workspace có bật “Cho phép secrets” mới được truy cập.', { path:normalizeRel(rel) });
  }
}

function installProjectPatch() {
  const projectModule = require('./projects');
  if (projectModule.__trustedWorkspacePatched) return;
  projectModule.__trustedWorkspacePatched = true;
  const originalCreate = projectModule.createProjectService;

  projectModule.createProjectService = function patchedCreateProjectService(store, options) {
    const service = originalCreate(store, options);
    const api = service.toolApi;
    const original = {
      readFile:api.readFile.bind(api),
      readFiles:api.readFiles.bind(api),
      writeFile:api.writeFile.bind(api),
      deleteFile:api.deleteFile.bind(api),
      renameFile:api.renameFile.bind(api)
    };

    async function readSensitive(project, relPath) {
      const rel = normalizeRel(relPath);
      ensureSecretAccess(project, rel);
      const target = await service.secureResolve(project, rel, { mustExist:true });
      const stat = await fsp.stat(target);
      if (!stat.isFile()) throw chatError('FILE_NOT_FOUND', 'Đường dẫn không phải file.', { path:rel });
      if (stat.size > 220000) throw chatError('UNSUPPORTED_BINARY', `File quá lớn (${stat.size} bytes).`, { path:rel, size:stat.size });
      const buffer = await fsp.readFile(target);
      if (buffer.includes(0)) throw chatError('UNSUPPORTED_BINARY', 'Nội dung file được nhận diện là binary/không hỗ trợ.', { path:rel });
      return { path:rel, content:buffer.toString('utf8') };
    }

    api.readFile = async (ref, relPath) => {
      const project = store.getProject(ref), rel = normalizeRel(relPath);
      if (isSensitive(rel) && canUseSecrets(project)) return readSensitive(project, rel);
      return original.readFile(ref, relPath);
    };

    api.readFiles = async (ref, paths) => {
      const out = [];
      for (const rel of (Array.isArray(paths) ? paths : []).slice(0, 12)) {
        try { out.push(await api.readFile(ref, rel)); }
        catch (error) { out.push({ path:normalizeRel(rel), error:normalizeError(error) }); }
      }
      return out;
    };

    api.writeFile = async (ref, relPath, content) => {
      const project = store.getProject(ref), rel = normalizeRel(relPath);
      if (!isSensitive(rel) || !canUseSecrets(project)) return original.writeFile(ref, relPath, content);
      ensureSecretAccess(project, rel);
      const target = await service.secureResolve(project, rel);
      await fsp.mkdir(path.dirname(target), { recursive:true });
      const verified = await service.secureResolve(project, rel);
      await fsp.writeFile(verified, String(content), 'utf8');
      service.invalidate(project.id, rel);
      return { ok:true, path:rel };
    };

    api.deleteFile = async (ref, relPath) => {
      const project = store.getProject(ref), rel = normalizeRel(relPath);
      if (!isSensitive(rel) || !canUseSecrets(project)) return original.deleteFile(ref, relPath);
      ensureSecretAccess(project, rel);
      const target = await service.secureResolve(project, rel, { mustExist:true });
      const stat = await fsp.stat(target);
      if (!stat.isFile()) throw chatError('FILE_NOT_FOUND', 'Chỉ cho phép xóa file.', { path:rel });
      await fsp.unlink(target);
      service.invalidate(project.id, rel);
      return { ok:true, path:rel };
    };

    api.renameFile = async (ref, fromPath, toPath) => {
      const project = store.getProject(ref), fromRel = normalizeRel(fromPath), toRel = normalizeRel(toPath);
      if ((!isSensitive(fromRel) && !isSensitive(toRel)) || !canUseSecrets(project)) return original.renameFile(ref, fromPath, toPath);
      ensureSecretAccess(project, fromRel); ensureSecretAccess(project, toRel);
      const from = await service.secureResolve(project, fromRel, { mustExist:true });
      const to = await service.secureResolve(project, toRel);
      await fsp.mkdir(path.dirname(to), { recursive:true });
      const verified = await service.secureResolve(project, toRel);
      await fsp.rename(from, verified);
      service.invalidate(project.id, fromRel); service.invalidate(project.id, toRel);
      return { ok:true, from:fromRel, to:toRel };
    };

    return service;
  };
}

function installSafetyPatch() {
  const safetyModule = require('./safety-tools');
  if (safetyModule.__trustedWorkspacePatched) return;
  safetyModule.__trustedWorkspacePatched = true;
  const originalCreate = safetyModule.createSafeToolApi;

  safetyModule.createSafeToolApi = function patchedCreateSafeToolApi(projects, store, approvals, backups, options) {
    const api = originalCreate(projects, store, approvals, backups, options);
    const base = projects.toolApi;
    const original = {
      inspectProject:api.inspectProject.bind(api),
      applyAndVerify:api.applyAndVerify.bind(api),
      writeFile:api.writeFile.bind(api),
      deleteFile:api.deleteFile.bind(api),
      renameFile:api.renameFile.bind(api),
      runTask:api.runTask.bind(api),
      gitStage:api.gitStage.bind(api),
      gitCommit:api.gitCommit.bind(api)
    };

    api.listProjects = () => store.read().projects.map(project => ({
      id:project.id,
      name:project.name,
      root:project.root,
      permissions:project.permissions,
      workspace_mode:project.workspaceMode || 'safe',
      trusted:{ allow_secrets:!!project.trusted?.allowSecrets, allow_git_push:false },
      safety_mode:project.workspaceMode === 'trusted' ? 'trusted_workspace_no_per_action_approval' : 'safe_rules'
    }));

    api.readFile = (ref, rel) => base.readFile(ref, rel);
    api.readFiles = (ref, paths) => base.readFiles(ref, paths);

    api.inspectProject = async (...args) => {
      const result = await original.inspectProject(...args);
      const project = store.getProject(args[0]);
      result.project = {
        ...(result.project || {}),
        workspace_mode:project.workspaceMode || 'safe',
        trusted:{ allow_secrets:!!project.trusted?.allowSecrets, allow_git_push:false },
        effective_permissions:project.permissions
      };
      return result;
    };

    api.writeFile = async (ref, relPath, content) => {
      const project = store.getProject(ref);
      if (!isTrusted(project)) return original.writeFile(ref, relPath, content);
      const rel = normalizeRel(relPath); ensureSecretAccess(project, rel);
      let existing = null;
      try { existing = await projects.secureResolve(project, rel, { mustExist:true }); } catch (error) { if (normalizeError(error).code !== 'FILE_NOT_FOUND') throw error; }
      const snapshot = existing ? await backups.snapshot(project, rel, existing, 'overwrite') : null;
      const result = await base.writeFile(project.id, rel, content);
      return { ...result, approval:trustedApproval(), ...recoveryShape(snapshot) };
    };

    api.deleteFile = async (ref, relPath) => {
      const project = store.getProject(ref);
      if (!isTrusted(project)) return original.deleteFile(ref, relPath);
      const rel = normalizeRel(relPath); ensureSecretAccess(project, rel);
      const target = await projects.secureResolve(project, rel, { mustExist:true });
      const snapshot = await backups.snapshot(project, rel, target, 'delete');
      const result = await base.deleteFile(project.id, rel);
      return { ...result, approval:trustedApproval(), ...recoveryShape(snapshot) };
    };

    api.renameFile = async (ref, fromPath, toPath) => {
      const project = store.getProject(ref);
      if (!isTrusted(project)) return original.renameFile(ref, fromPath, toPath);
      const fromRel = normalizeRel(fromPath), toRel = normalizeRel(toPath);
      ensureSecretAccess(project, fromRel); ensureSecretAccess(project, toRel);
      const source = await projects.secureResolve(project, fromRel, { mustExist:true });
      const snapshot = await backups.snapshot(project, fromRel, source, 'rename');
      const result = await base.renameFile(project.id, fromRel, toRel);
      return { ...result, approval:trustedApproval(), ...recoveryShape(snapshot) };
    };

    for (const name of ['runTask','gitStage','gitCommit']) {
      api[name] = async (...args) => {
        const project = store.getProject(args[0]);
        const result = await original[name](...args);
        if (!isTrusted(project)) return result;
        return { ...result, approval:trustedApproval() };
      };
    }

    api.applyAndVerify = async (ref, changesInput = [], tasksInput = []) => {
      const project = store.getProject(ref);
      const changes = Array.isArray(changesInput) ? changesInput : [];
      const touchesSensitive = changes.some(change => [change.path, change.from, change.to].some(isSensitive));
      if (!isTrusted(project) || !touchesSensitive) return original.applyAndVerify(ref, changesInput, tasksInput);
      if (!canUseSecrets(project)) throw chatError('SENSITIVE_PATH_BLOCKED', 'Fast-path có file nhạy cảm nhưng Trusted Workspace chưa bật “Cho phép secrets”.');

      const started = Date.now(), outputs = [], verification = [];
      for (const change of changes.slice(0, 24)) {
        const op = String(change.op || change.operation || '').toLowerCase();
        if (op === 'write') {
          const result = await api.writeFile(project.id, change.path, String(change.content ?? ''));
          outputs.push({ operation:op, target:normalizeRel(change.path), ...result });
          const read = await api.readFile(project.id, change.path);
          verification.push({ operation:op, path:normalizeRel(change.path), ok:String(read.content || '') === String(change.content ?? ''), check:'exact-content' });
        } else if (op === 'patch') {
          const rel = normalizeRel(change.path), current = await api.readFile(project.id, rel); let text = String(current.content || '');
          for (const edit of (Array.isArray(change.edits) ? change.edits : []).slice(0, 40)) {
            const find = String(edit.find ?? ''), replace = String(edit.replace ?? '');
            if (!find || !text.includes(find)) throw chatError('PATCH_CONFLICT', 'Không tìm thấy đoạn cần thay thế trong patch.', { path:rel, find:find.slice(0,160) });
            const count = text.split(find).length - 1;
            if (!edit.all && count !== 1) throw chatError('PATCH_CONFLICT', 'Đoạn patch xuất hiện nhiều hơn một lần.', { path:rel, occurrences:count });
            text = edit.all ? text.split(find).join(replace) : text.replace(find, replace);
          }
          const result = await api.writeFile(project.id, rel, text);
          outputs.push({ operation:op, target:rel, ...result });
          verification.push({ operation:op, path:rel, ok:true, check:'patch-applied' });
        } else if (op === 'rename' || op === 'move') {
          const result = await api.renameFile(project.id, change.from, change.to);
          outputs.push({ operation:op, target:`${normalizeRel(change.from)} → ${normalizeRel(change.to)}`, ...result });
          verification.push({ operation:op, from:normalizeRel(change.from), to:normalizeRel(change.to), ok:true, check:'renamed' });
        } else if (op === 'delete') {
          const result = await api.deleteFile(project.id, change.path);
          outputs.push({ operation:op, target:normalizeRel(change.path), ...result });
          verification.push({ operation:op, path:normalizeRel(change.path), ok:true, check:'deleted' });
        } else throw chatError('INTERNAL_ERROR', `Change operation không hỗ trợ: ${op || '(trống)'}`);
      }

      const taskOutputs = [];
      for (const command of (Array.isArray(tasksInput) ? tasksInput : []).map(String).filter(Boolean).slice(0, 6)) {
        const result = await api.runTask(project.id, command);
        taskOutputs.push({ command, ...result });
        verification.push({ operation:'task', command, ok:!!result.ok, check:'exit-code', code:result.code });
      }

      await projects.reindex(project.id);
      const brain = await api.rebuildBrain(project.id);
      const [gitDiff, gitStatus] = await Promise.all([api.gitDiff(project.id, false), api.gitStatus(project.id)]);
      return {
        ok:verification.every(item => item.ok !== false),
        status:'completed',
        job_id:crypto.randomUUID(),
        project:project.name,
        workspace_mode:'trusted',
        changes:outputs,
        tasks:taskOutputs,
        brain:{ updatedAt:brain.updatedAt, stats:brain.stats },
        verification,
        verification_passed:verification.every(item => item.ok !== false),
        git:{ status:gitStatus.ok ? gitStatus.stdout : '', diff:gitDiff.ok ? gitDiff.stdout : '' },
        git_diff:gitDiff.ok ? gitDiff.stdout : '',
        approval:trustedApproval(),
        telemetry:{ total_ms:Date.now()-started, filesystem_ms:0, brain_refresh_ms:0, git_ms:0 }
      };
    };

    return api;
  };
}

function installTrustedWorkspacePatches() {
  installProjectPatch();
  installSafetyPatch();
}

module.exports = { installTrustedWorkspacePatches, isSensitive, isTrusted, canUseSecrets, trustedApproval };
