const crypto = require('crypto');
const { chatError, normalizeError } = require('./errors');

const MAX_SESSIONS = 40;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PATCH_CHARS = 2 * 1024 * 1024;
const MAX_FILES_PER_PATCH = 40;
const MAX_SESSION_OPS = 240;

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function cleanPatchPath(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (value === '/dev/null') return value;
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"');
  value = value.split('\t')[0].trim();
  value = value.replace(/^[ab]\//, '');
  return normalizeRel(value);
}

function parseHunkHeader(line) {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
  if (!match) return null;
  return {
    oldStart:Number(match[1]), oldCount:match[2] == null ? 1 : Number(match[2]),
    newStart:Number(match[3]), newCount:match[4] == null ? 1 : Number(match[4])
  };
}

function parseUnifiedDiff(patchText) {
  const raw = String(patchText || '');
  if (!raw.trim()) throw chatError('PATCH_CONFLICT', 'Unified diff đang trống.');
  if (raw.length > MAX_PATCH_CHARS) throw chatError('PATCH_CONFLICT', 'Unified diff quá lớn.', { max_chars:MAX_PATCH_CHARS, actual_chars:raw.length });
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const files = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) continue;
    if (line.startsWith('index ') || line.startsWith('new file mode ') || line.startsWith('deleted file mode ') || line.startsWith('similarity index ')) continue;
    if (line.startsWith('--- ')) {
      const oldPath = cleanPatchPath(line.slice(4));
      const next = lines[i + 1] || '';
      if (!next.startsWith('+++ ')) throw chatError('PATCH_CONFLICT', 'Unified diff thiếu dòng +++ sau ---.', { line:i + 1 });
      const newPath = cleanPatchPath(next.slice(4));
      current = { oldPath, newPath, hunks:[] };
      files.push(current);
      i++;
      if (files.length > MAX_FILES_PER_PATCH) throw chatError('PATCH_CONFLICT', 'Unified diff thay đổi quá nhiều file.', { max_files:MAX_FILES_PER_PATCH });
      continue;
    }
    if (line.startsWith('@@')) {
      if (!current) throw chatError('PATCH_CONFLICT', 'Hunk xuất hiện trước file header.', { line:i + 1 });
      const header = parseHunkHeader(line);
      if (!header) throw chatError('PATCH_CONFLICT', 'Hunk header không hợp lệ.', { line:i + 1, header:line.slice(0,160) });
      const hunk = { ...header, lines:[] };
      current.hunks.push(hunk);
      for (i = i + 1; i < lines.length; i++) {
        const hline = lines[i];
        if (hline.startsWith('@@') || hline.startsWith('--- ') || hline.startsWith('diff --git ')) { i--; break; }
        if (hline === '\\ No newline at end of file') { hunk.noNewline = true; continue; }
        if (!hline && i === lines.length - 1) continue;
        const prefix = hline[0];
        if (![' ', '+', '-'].includes(prefix)) throw chatError('PATCH_CONFLICT', 'Dòng hunk không hợp lệ.', { line:i + 1, content:hline.slice(0,160) });
        hunk.lines.push({ type:prefix, text:hline.slice(1) });
      }
    }
  }

  if (!files.length) throw chatError('PATCH_CONFLICT', 'Không tìm thấy file header ---/+++ trong unified diff.');
  for (const file of files) {
    if (!file.hunks.length) throw chatError('PATCH_CONFLICT', 'File patch không có hunk.', { old_path:file.oldPath, new_path:file.newPath });
    if (file.oldPath === '/dev/null' && file.newPath === '/dev/null') throw chatError('PATCH_CONFLICT', 'Patch không thể dùng /dev/null cho cả hai phía.');
    if (file.oldPath !== '/dev/null' && file.newPath !== '/dev/null' && file.oldPath !== file.newPath) {
      throw chatError('PATCH_CONFLICT', 'Chặng 3 apply_patch chưa dùng unified diff để rename file; hãy dùng rename_file cho rename.', { old_path:file.oldPath, new_path:file.newPath });
    }
  }
  return files;
}

function splitText(text) {
  const raw = String(text ?? '');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const normalized = raw.replace(/\r\n/g, '\n');
  const finalNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (finalNewline) lines.pop();
  return { lines, eol, finalNewline };
}

function applyFilePatch(original, filePatch) {
  const source = splitText(original);
  const lines = source.lines.slice();
  let delta = 0;
  for (let hunkIndex = 0; hunkIndex < filePatch.hunks.length; hunkIndex++) {
    const hunk = filePatch.hunks[hunkIndex];
    const expectedOld = hunk.lines.filter(item => item.type !== '+').length;
    const expectedNew = hunk.lines.filter(item => item.type !== '-').length;
    if (expectedOld !== hunk.oldCount || expectedNew !== hunk.newCount) {
      throw chatError('PATCH_CONFLICT', 'Số dòng trong hunk không khớp header.', { hunk:hunkIndex + 1, old_header:hunk.oldCount, old_actual:expectedOld, new_header:hunk.newCount, new_actual:expectedNew });
    }
    let cursor = Math.max(0, hunk.oldStart - 1 + delta);
    const start = cursor;
    const replacement = [];
    let consumed = 0;
    for (const item of hunk.lines) {
      if (item.type === ' ') {
        const actual = lines[cursor];
        if (actual !== item.text) throw chatError('PATCH_CONFLICT', 'Context của unified diff không khớp file hiện tại.', { hunk:hunkIndex + 1, line:cursor + 1, expected:item.text.slice(0,220), actual:String(actual ?? '').slice(0,220) });
        replacement.push(actual); cursor++; consumed++;
      } else if (item.type === '-') {
        const actual = lines[cursor];
        if (actual !== item.text) throw chatError('PATCH_CONFLICT', 'Dòng cần xóa của unified diff không khớp file hiện tại.', { hunk:hunkIndex + 1, line:cursor + 1, expected:item.text.slice(0,220), actual:String(actual ?? '').slice(0,220) });
        cursor++; consumed++;
      } else if (item.type === '+') replacement.push(item.text);
    }
    lines.splice(start, consumed, ...replacement);
    delta += replacement.length - consumed;
  }
  let finalNewline = source.finalNewline;
  const lastHunk = filePatch.hunks[filePatch.hunks.length - 1];
  if (filePatch.oldPath === '/dev/null') finalNewline = !lastHunk?.noNewline;
  if (lastHunk?.noNewline) finalNewline = false;
  return lines.join(source.eol) + (finalNewline ? source.eol : '');
}

function createCodexEditingRuntime(projects, store, backups, api) {
  const sessions = new Map();

  function prune() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, session] of sessions) {
      const at = Date.parse(session.finishedAt || session.updatedAt || session.startedAt) || 0;
      if (at < cutoff) sessions.delete(id);
    }
    if (sessions.size <= MAX_SESSIONS) return;
    const ordered = [...sessions.values()].sort((a,b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    while (sessions.size > MAX_SESSIONS && ordered.length) sessions.delete(ordered.shift().id);
  }

  function getSession(id) {
    prune();
    const session = sessions.get(String(id || ''));
    if (!session) throw chatError('FILE_NOT_FOUND', 'Không tìm thấy work session hoặc session đã hết thời gian lưu.', { work_session_id:String(id || '') });
    return session;
  }

  function ensureProjectSession(session, ref) {
    const project = store.getProject(ref);
    if (project.id !== session.projectId) throw chatError('PERMISSION_DENIED', 'Work session thuộc project khác.', { work_session_id:session.id, expected_project:session.project, actual_project:project.name });
    return project;
  }

  function summarize(session) {
    return {
      work_session_id:session.id,
      project:session.project,
      project_id:session.projectId,
      goal:session.goal,
      status:session.status,
      workspace_mode:session.workspaceMode,
      started_at:session.startedAt,
      updated_at:session.updatedAt,
      finished_at:session.finishedAt || null,
      changed_files:[...session.changedFiles],
      created_files:[...session.createdFiles],
      commands:session.commands.slice(-40),
      operations:session.operations.slice(-80),
      recovery_points:session.recoveryIds.map(id => ({ snapshot_id:id })),
      baseline:session.baseline
    };
  }

  async function gitSnapshot(projectId) {
    const [status, diff] = await Promise.all([api.gitStatus(projectId), api.gitDiff(projectId, false)]);
    return {
      is_repository:!!status?.ok,
      status:status?.ok ? String(status.stdout || '') : '',
      diff:diff?.ok ? String(diff.stdout || '') : '',
      error:status?.ok ? null : normalizeError(new Error(status?.stderr || diff?.stderr || 'Git unavailable'))
    };
  }

  async function startWork(ref, goal = '') {
    prune();
    const project = store.getProject(ref), now = new Date().toISOString();
    const [git, brain] = await Promise.all([
      gitSnapshot(project.id),
      typeof api.projectBrain === 'function' ? api.projectBrain(project.id).catch(() => null) : null
    ]);
    const session = {
      id:crypto.randomUUID(), projectId:project.id, project:project.name,
      goal:String(goal || '').trim().slice(0,1200), status:'active', workspaceMode:project.workspaceMode || 'safe',
      startedAt:now, updatedAt:now, finishedAt:'', changedFiles:new Set(), createdFiles:new Set(),
      operations:[], commands:[], recoveryIds:[],
      baseline:{ git, brain:brain ? { frameworks:brain.framework_names || [], primary_language:brain.primary_language || '', entrypoints:(brain.entrypoints || []).slice(0,20), stats:brain.stats || null } : null }
    };
    sessions.set(session.id, session);
    return summarize(session);
  }

  async function readMaybe(ref, rel) {
    try { return { exists:true, ...(await api.readFile(ref, rel)) }; }
    catch (error) {
      if (normalizeError(error).code === 'FILE_NOT_FOUND') return { exists:false, path:rel, content:'' };
      throw error;
    }
  }

  function recordMutation(session, info, result) {
    session.updatedAt = new Date().toISOString();
    if (info.path) session.changedFiles.add(info.path);
    if (info.created) session.createdFiles.add(info.path);
    const snapshotId = result?.snapshot_id || result?.recoveryId || null;
    if (snapshotId && !session.recoveryIds.includes(snapshotId)) session.recoveryIds.push(snapshotId);
    session.operations.push({ at:session.updatedAt, ...info, snapshot_id:snapshotId });
    if (session.operations.length > MAX_SESSION_OPS) session.operations.splice(0, session.operations.length - MAX_SESSION_OPS);
  }

  async function applyPatch(ref, patchText, workSessionId = '') {
    const project = store.getProject(ref), session = workSessionId ? getSession(workSessionId) : null;
    if (session) ensureProjectSession(session, project.id);
    const files = parseUnifiedDiff(patchText), results = [];

    for (const file of files) {
      const create = file.oldPath === '/dev/null', remove = file.newPath === '/dev/null';
      const rel = create ? file.newPath : file.oldPath;
      const before = await readMaybe(project.id, rel);
      if (create && before.exists) throw chatError('PATCH_CONFLICT', 'Unified diff muốn tạo file nhưng file đã tồn tại.', { path:rel });
      if (!create && !before.exists) throw chatError('FILE_NOT_FOUND', 'File cần patch không tồn tại.', { path:rel });
      const next = applyFilePatch(before.content, file);
      let result;
      if (remove) {
        if (next.length) throw chatError('PATCH_CONFLICT', 'Patch xóa file nhưng kết quả vẫn còn nội dung.', { path:rel });
        result = await api.deleteFile(project.id, rel);
      } else {
        result = await api.writeFile(project.id, rel, next);
      }
      const item = {
        path:rel, operation:remove ? 'delete' : create ? 'create' : 'modify',
        hunks:file.hunks.length, bytes_before:Buffer.byteLength(before.content || '', 'utf8'), bytes_after:Buffer.byteLength(next || '', 'utf8'),
        snapshot_created:!!result?.snapshot_created, snapshot_id:result?.snapshot_id || result?.recoveryId || null,
        approval:result?.approval || null
      };
      results.push(item);
      if (session) recordMutation(session, { operation:item.operation, path:rel, created:create }, result);
    }

    const brainStarted = Date.now();
    await projects.reindex(project.id);
    const brain = typeof api.rebuildBrain === 'function' ? await api.rebuildBrain(project.id) : null;
    const git = await gitSnapshot(project.id);
    return {
      ok:true,
      work_session_id:session?.id || null,
      files:results,
      changed_files:session ? [...session.changedFiles] : results.map(item => item.path),
      recovery_points:results.filter(item => item.snapshot_id).map(item => ({ path:item.path, snapshot_id:item.snapshot_id })),
      brain:{ refreshed:true, refresh_ms:Date.now() - brainStarted, updated_at:brain?.updatedAt || null, stats:brain?.stats || null },
      git
    };
  }

  async function status(id) {
    const session = getSession(id), project = store.getProject(session.projectId);
    const git = await gitSnapshot(project.id);
    return { ...summarize(session), current:{ git } };
  }

  async function finishWork(id, verifyCommands = []) {
    const session = getSession(id), project = store.getProject(session.projectId);
    if (session.status !== 'active') return status(id);
    const verification = [];
    for (const command of (Array.isArray(verifyCommands) ? verifyCommands : []).map(String).filter(Boolean).slice(0,6)) {
      if (typeof api.exec !== 'function') throw chatError('TASK_NOT_ALLOWED', 'Trusted Terminal Runtime chưa khả dụng để chạy verification command.');
      const result = await api.exec(project.id, command, { background:false, timeout_ms:120000, work_session_id:session.id });
      verification.push({ command, ok:result.status === 'completed' && result.exit_code === 0, status:result.status, exit_code:result.exit_code, stdout:String(result.stdout || '').slice(-16000), stderr:String(result.stderr || '').slice(-16000) });
      session.commands.push({ at:new Date().toISOString(), command, status:result.status, exit_code:result.exit_code });
    }
    const brainStarted = Date.now();
    await projects.reindex(project.id);
    const brain = typeof api.rebuildBrain === 'function' ? await api.rebuildBrain(project.id) : null;
    session.status = verification.every(item => item.ok) ? 'completed' : 'verification_failed';
    session.updatedAt = session.finishedAt = new Date().toISOString();
    const git = await gitSnapshot(project.id);
    return {
      ...summarize(session),
      verification,
      verification_passed:verification.every(item => item.ok),
      brain:{ refreshed:true, refresh_ms:Date.now() - brainStarted, updated_at:brain?.updatedAt || null, stats:brain?.stats || null },
      final:{ git }
    };
  }

  async function rollbackWork(id) {
    const session = getSession(id), project = store.getProject(session.projectId);
    if (session.status === 'rolled_back') return status(id);
    const restored = [], removed = [], errors = [];
    const handled = new Set();
    for (const op of [...session.operations].reverse()) {
      if (!op.path || handled.has(op.path)) continue;
      handled.add(op.path);
      try {
        if (op.created && !op.snapshot_id) {
          try { await api.deleteFile(project.id, op.path); removed.push(op.path); }
          catch (error) { if (normalizeError(error).code !== 'FILE_NOT_FOUND') throw error; }
        } else if (op.snapshot_id) {
          const result = await backups.restore(op.snapshot_id, projects.secureResolve);
          restored.push({ path:result.path, snapshot_id:op.snapshot_id });
        }
      } catch (error) { errors.push({ path:op.path, error:normalizeError(error) }); }
    }
    await projects.reindex(project.id);
    if (typeof api.rebuildBrain === 'function') await api.rebuildBrain(project.id);
    session.status = errors.length ? 'rollback_partial' : 'rolled_back';
    session.updatedAt = session.finishedAt = new Date().toISOString();
    const git = await gitSnapshot(project.id);
    return { ...summarize(session), ok:errors.length === 0, restored, removed, errors, final:{ git } };
  }

  function list(ref = '') {
    prune();
    const projectId = ref ? store.getProject(ref).id : '';
    return [...sessions.values()].filter(item => !projectId || item.projectId === projectId).sort((a,b) => b.startedAt.localeCompare(a.startedAt)).map(summarize);
  }

  return { startWork, applyPatch, status, finishWork, rollbackWork, list, parseUnifiedDiff, applyFilePatch };
}

function electronApi() {
  try { const electron = require('electron'); return electron && typeof electron === 'object' ? electron : null; }
  catch { return null; }
}

function installCodexEditingPatches() {
  const safetyModule = require('./safety-tools');
  if (safetyModule.__codexEditingPatched) return;
  safetyModule.__codexEditingPatched = true;
  const previousCreate = safetyModule.createSafeToolApi;
  safetyModule.createSafeToolApi = function codexEditingSafeToolApi(projects, store, approvals, backups, options) {
    const api = previousCreate(projects, store, approvals, backups, options);
    const runtime = createCodexEditingRuntime(projects, store, backups, api);
    api.startWork = (ref, goal) => runtime.startWork(ref, goal);
    api.applyPatch = (ref, patch, workSessionId) => runtime.applyPatch(ref, patch, workSessionId || '');
    api.workStatus = id => runtime.status(id);
    api.finishWork = (id, commands) => runtime.finishWork(id, commands || []);
    api.rollbackWork = id => runtime.rollbackWork(id);
    api.listWorkSessions = ref => runtime.list(ref || '');

    const originalExec = typeof api.exec === 'function' ? api.exec.bind(api) : null;
    if (originalExec) {
      api.exec = async (ref, command, opts = {}) => {
        const result = await originalExec(ref, command, opts);
        const sessionId = String(opts?.work_session_id || '');
        if (sessionId) {
          try {
            const session = runtime.list(ref).find(item => item.work_session_id === sessionId);
            if (session) {
              const internal = runtime._sessions?.get?.(sessionId);
              if (internal) internal.commands.push({ at:new Date().toISOString(), command:String(command || '').slice(0,2000), status:result.status, exit_code:result.exit_code });
            }
          } catch {}
        }
        return result;
      };
    }

    const electron = electronApi();
    if (electron?.ipcMain?.handle && !electron.ipcMain.__chatcodeWorkHandlers) {
      electron.ipcMain.__chatcodeWorkHandlers = true;
      electron.ipcMain.handle('work:list', (_, ref) => api.listWorkSessions(ref || ''));
      electron.ipcMain.handle('work:status', (_, id) => api.workStatus(id));
      electron.ipcMain.handle('work:rollback', (_, id) => api.rollbackWork(id));
    }
    return api;
  };
}

module.exports = { installCodexEditingPatches, createCodexEditingRuntime, parseUnifiedDiff, applyFilePatch };
