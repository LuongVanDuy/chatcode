const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
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

function patchPath(raw) {
  let value = String(raw || '').trim();
  if (value === '/dev/null') return value;
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"');
  value = value.split('\t')[0].trim().replace(/^[ab]\//, '');
  return normalizeRel(value);
}

function parseHeader(line) {
  const m = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
  if (!m) return null;
  return { oldStart:+m[1], oldCount:m[2] == null ? 1 : +m[2], newStart:+m[3], newCount:m[4] == null ? 1 : +m[4] };
}

function parseUnifiedDiff(value) {
  const raw = String(value || '');
  if (!raw.trim()) throw chatError('PATCH_CONFLICT', 'Unified diff đang trống.');
  if (raw.length > MAX_PATCH_CHARS) throw chatError('PATCH_CONFLICT', 'Unified diff quá lớn.', { max_chars:MAX_PATCH_CHARS, actual_chars:raw.length });
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const files = [];
  let file = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ') || line.startsWith('index ') || line.startsWith('new file mode ') || line.startsWith('deleted file mode ') || line.startsWith('similarity index ')) continue;
    if (line.startsWith('--- ')) {
      if (!String(lines[i + 1] || '').startsWith('+++ ')) throw chatError('PATCH_CONFLICT', 'Unified diff thiếu +++ sau ---.', { line:i + 1 });
      file = { oldPath:patchPath(line.slice(4)), newPath:patchPath(lines[i + 1].slice(4)), hunks:[] };
      files.push(file); i++;
      if (files.length > MAX_FILES_PER_PATCH) throw chatError('PATCH_CONFLICT', 'Unified diff thay đổi quá nhiều file.', { max_files:MAX_FILES_PER_PATCH });
      continue;
    }
    if (!line.startsWith('@@')) continue;
    if (!file) throw chatError('PATCH_CONFLICT', 'Hunk xuất hiện trước file header.', { line:i + 1 });
    const header = parseHeader(line);
    if (!header) throw chatError('PATCH_CONFLICT', 'Hunk header không hợp lệ.', { line:i + 1, header:line.slice(0,160) });
    const hunk = { ...header, lines:[], noNewline:false };
    file.hunks.push(hunk);
    let oldSeen = 0, newSeen = 0;
    while (oldSeen < header.oldCount || newSeen < header.newCount) {
      i++;
      if (i >= lines.length) throw chatError('PATCH_CONFLICT', 'Unified diff kết thúc trước khi hunk đủ số dòng.', { hunk:file.hunks.length });
      const hline = lines[i];
      if (hline === '\\ No newline at end of file') { hunk.noNewline = true; continue; }
      const type = hline[0];
      if (![' ', '+', '-'].includes(type)) throw chatError('PATCH_CONFLICT', 'Dòng hunk không hợp lệ.', { line:i + 1, content:hline.slice(0,160) });
      const text = hline.slice(1);
      if (type === ' ') { oldSeen++; newSeen++; }
      else if (type === '-') oldSeen++;
      else newSeen++;
      if (oldSeen > header.oldCount || newSeen > header.newCount) throw chatError('PATCH_CONFLICT', 'Hunk chứa nhiều dòng hơn header khai báo.', { hunk:file.hunks.length, old_seen:oldSeen, new_seen:newSeen });
      hunk.lines.push({ type, text });
    }
    if (lines[i + 1] === '\\ No newline at end of file') { hunk.noNewline = true; i++; }
  }

  if (!files.length) throw chatError('PATCH_CONFLICT', 'Không tìm thấy file header ---/+++ trong unified diff.');
  for (const item of files) {
    if (!item.hunks.length) throw chatError('PATCH_CONFLICT', 'File patch không có hunk.', { old_path:item.oldPath, new_path:item.newPath });
    if (item.oldPath === '/dev/null' && item.newPath === '/dev/null') throw chatError('PATCH_CONFLICT', 'Patch không thể dùng /dev/null ở cả hai phía.');
    if (item.oldPath !== '/dev/null' && item.newPath !== '/dev/null' && item.oldPath !== item.newPath) {
      throw chatError('PATCH_CONFLICT', 'Unified diff rename chưa hỗ trợ ở apply_patch; dùng rename_file cho rename.', { old_path:item.oldPath, new_path:item.newPath });
    }
  }
  return files;
}

function splitText(value) {
  const raw = String(value ?? '');
  if (!raw.length) return { lines:[], eol:'\n', finalNewline:false };
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const normalized = raw.replace(/\r\n/g, '\n');
  const finalNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (finalNewline) lines.pop();
  return { lines, eol, finalNewline };
}

function applyFilePatch(original, filePatch) {
  const source = splitText(original), lines = source.lines.slice();
  let delta = 0;
  for (let hi = 0; hi < filePatch.hunks.length; hi++) {
    const hunk = filePatch.hunks[hi];
    const oldActual = hunk.lines.filter(x => x.type !== '+').length;
    const newActual = hunk.lines.filter(x => x.type !== '-').length;
    if (oldActual !== hunk.oldCount || newActual !== hunk.newCount) throw chatError('PATCH_CONFLICT', 'Số dòng hunk không khớp header.', { hunk:hi + 1, old_header:hunk.oldCount, old_actual:oldActual, new_header:hunk.newCount, new_actual:newActual });
    let cursor = Math.max(0, hunk.oldStart - 1 + delta), consumed = 0;
    const start = cursor, replacement = [];
    for (const row of hunk.lines) {
      if (row.type === ' ') {
        if (lines[cursor] !== row.text) throw chatError('PATCH_CONFLICT', 'Context unified diff không khớp file hiện tại.', { hunk:hi + 1, line:cursor + 1, expected:row.text.slice(0,220), actual:String(lines[cursor] ?? '').slice(0,220) });
        replacement.push(lines[cursor]); cursor++; consumed++;
      } else if (row.type === '-') {
        if (lines[cursor] !== row.text) throw chatError('PATCH_CONFLICT', 'Dòng cần xóa không khớp file hiện tại.', { hunk:hi + 1, line:cursor + 1, expected:row.text.slice(0,220), actual:String(lines[cursor] ?? '').slice(0,220) });
        cursor++; consumed++;
      } else replacement.push(row.text);
    }
    lines.splice(start, consumed, ...replacement);
    delta += replacement.length - consumed;
  }
  if (filePatch.newPath === '/dev/null') return '';
  const last = filePatch.hunks[filePatch.hunks.length - 1];
  let finalNewline = filePatch.oldPath === '/dev/null' ? !last.noNewline : source.finalNewline;
  if (last.noNewline) finalNewline = false;
  return lines.join(source.eol) + (finalNewline ? source.eol : '');
}

function createWorkRuntime(projects, store, backups, api) {
  const sessions = new Map();

  function prune() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of sessions) if ((Date.parse(s.finishedAt || s.updatedAt || s.startedAt) || 0) < cutoff) sessions.delete(id);
    const extra = Math.max(0, sessions.size - MAX_SESSIONS);
    if (extra) [...sessions.values()].sort((a,b) => a.startedAt.localeCompare(b.startedAt)).slice(0, extra).forEach(s => sessions.delete(s.id));
  }

  function get(id) {
    prune();
    const s = sessions.get(String(id || ''));
    if (!s) throw chatError('FILE_NOT_FOUND', 'Không tìm thấy work session hoặc session đã hết thời gian lưu.', { work_session_id:String(id || '') });
    return s;
  }

  function publicSession(s) {
    return {
      work_session_id:s.id, project:s.project, project_id:s.projectId, goal:s.goal, status:s.status,
      workspace_mode:s.workspaceMode, started_at:s.startedAt, updated_at:s.updatedAt, finished_at:s.finishedAt || null,
      changed_files:[...s.changedFiles], created_files:[...s.createdFiles], commands:s.commands.slice(-40),
      operations:s.operations.slice(-80).map(({ beforeContent, ...item }) => item),
      recovery_points:s.recoveryIds.map(snapshot_id => ({ snapshot_id })), baseline:s.baseline
    };
  }

  async function gitSnapshot(projectId) {
    const [status, diff] = await Promise.all([api.gitStatus(projectId), api.gitDiff(projectId, false)]);
    return {
      is_repository:!!status?.ok,
      status:status?.ok ? String(status.stdout || '') : '', diff:diff?.ok ? String(diff.stdout || '') : '',
      error:status?.ok ? null : normalizeError(new Error(status?.stderr || diff?.stderr || 'Git unavailable'))
    };
  }

  async function startWork(ref, goal = '') {
    prune();
    const p = store.getProject(ref), now = new Date().toISOString();
    const [git, brain] = await Promise.all([gitSnapshot(p.id), typeof api.projectBrain === 'function' ? api.projectBrain(p.id).catch(() => null) : null]);
    const s = {
      id:crypto.randomUUID(), projectId:p.id, project:p.name, goal:String(goal || '').trim().slice(0,1200), status:'active',
      workspaceMode:p.workspaceMode || 'safe', startedAt:now, updatedAt:now, finishedAt:'', changedFiles:new Set(), createdFiles:new Set(),
      commands:[], operations:[], recoveryIds:[],
      baseline:{ git, brain:brain ? { frameworks:brain.framework_names || [], primary_language:brain.primary_language || '', entrypoints:(brain.entrypoints || []).slice(0,20), stats:brain.stats || null } : null }
    };
    sessions.set(s.id, s);
    return publicSession(s);
  }

  function projectForSession(s) { return store.getProject(s.projectId); }

  async function readMaybe(ref, rel) {
    try { return { exists:true, ...(await api.readFile(ref, rel)) }; }
    catch (error) { if (normalizeError(error).code === 'FILE_NOT_FOUND') return { exists:false, path:rel, content:'' }; throw error; }
  }

  function record(s, plan, result) {
    s.updatedAt = new Date().toISOString();
    s.changedFiles.add(plan.path);
    if (plan.create) s.createdFiles.add(plan.path);
    const snapshotId = result?.snapshot_id || result?.recoveryId || null;
    if (snapshotId && !s.recoveryIds.includes(snapshotId)) s.recoveryIds.push(snapshotId);
    s.operations.push({ at:s.updatedAt, operation:plan.remove ? 'delete' : plan.create ? 'create' : 'modify', path:plan.path, created:plan.create, beforeExists:plan.before.exists, beforeContent:plan.before.content, snapshot_id:snapshotId });
    if (s.operations.length > MAX_SESSION_OPS) s.operations.splice(0, s.operations.length - MAX_SESSION_OPS);
  }

  async function directRestore(project, op) {
    const target = await projects.secureResolve(project, op.path, { mustExist:false });
    if (!op.beforeExists) {
      try { await fsp.unlink(target); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      return { path:op.path, action:'remove-created' };
    }
    await fsp.mkdir(path.dirname(target), { recursive:true });
    const verified = await projects.secureResolve(project, op.path, { mustExist:false });
    await fsp.writeFile(verified, String(op.beforeContent ?? ''), 'utf8');
    return { path:op.path, action:'restore-before' };
  }

  async function applyPatch(ref, patchText, sessionId = '') {
    const p = store.getProject(ref), s = sessionId ? get(sessionId) : null;
    if (s && s.projectId !== p.id) throw chatError('PERMISSION_DENIED', 'Work session thuộc project khác.', { work_session_id:s.id, expected_project:s.project, actual_project:p.name });
    if (s && s.status !== 'active') throw chatError('PERMISSION_DENIED', 'Work session không còn active.', { work_session_id:s.id, status:s.status });

    const files = parseUnifiedDiff(patchText), plans = [];
    for (const file of files) {
      const create = file.oldPath === '/dev/null', remove = file.newPath === '/dev/null', rel = create ? file.newPath : file.oldPath;
      const before = await readMaybe(p.id, rel);
      if (create && before.exists) throw chatError('PATCH_CONFLICT', 'Patch muốn tạo file nhưng file đã tồn tại.', { path:rel });
      if (!create && !before.exists) throw chatError('FILE_NOT_FOUND', 'File cần patch không tồn tại.', { path:rel });
      const after = applyFilePatch(before.content, file);
      if (remove && after.length) throw chatError('PATCH_CONFLICT', 'Patch xóa file nhưng kết quả vẫn còn nội dung.', { path:rel });
      plans.push({ file, create, remove, path:rel, before, after });
    }

    const applied = [], results = [];
    try {
      for (const plan of plans) {
        const result = plan.remove ? await api.deleteFile(p.id, plan.path) : await api.writeFile(p.id, plan.path, plan.after);
        applied.push({ plan, result });
        const item = {
          path:plan.path, operation:plan.remove ? 'delete' : plan.create ? 'create' : 'modify', hunks:plan.file.hunks.length,
          bytes_before:Buffer.byteLength(plan.before.content || '', 'utf8'), bytes_after:Buffer.byteLength(plan.after || '', 'utf8'),
          snapshot_created:!!result?.snapshot_created, snapshot_id:result?.snapshot_id || result?.recoveryId || null, approval:result?.approval || null
        };
        results.push(item);
        if (s) record(s, plan, result);
      }
    } catch (error) {
      const rollback = [];
      for (const item of [...applied].reverse()) {
        try { rollback.push(await directRestore(p, { path:item.plan.path, beforeExists:item.plan.before.exists, beforeContent:item.plan.before.content })); }
        catch (restoreError) { rollback.push({ path:item.plan.path, error:normalizeError(restoreError) }); }
      }
      await projects.reindex(p.id).catch(() => {});
      const n = normalizeError(error);
      throw chatError(n.code || 'INTERNAL_ERROR', n.message, { ...(n.details || {}), patch_auto_rollback:rollback });
    }

    const brainStart = Date.now();
    await projects.reindex(p.id);
    const brain = typeof api.rebuildBrain === 'function' ? await api.rebuildBrain(p.id) : null;
    const git = await gitSnapshot(p.id);
    return {
      ok:true, work_session_id:s?.id || null, files:results,
      changed_files:s ? [...s.changedFiles] : results.map(x => x.path), recovery_points:results.filter(x => x.snapshot_id).map(x => ({ path:x.path, snapshot_id:x.snapshot_id })),
      brain:{ refreshed:true, refresh_ms:Date.now() - brainStart, updated_at:brain?.updatedAt || null, stats:brain?.stats || null }, git
    };
  }

  function recordCommand(sessionId, ref, command, result) {
    if (!sessionId) return;
    const s = get(sessionId), p = store.getProject(ref);
    if (s.projectId !== p.id) throw chatError('PERMISSION_DENIED', 'Work session thuộc project khác.', { work_session_id:s.id });
    s.updatedAt = new Date().toISOString();
    s.commands.push({ at:s.updatedAt, command:String(command || '').slice(0,2000), status:result?.status || (result?.ok ? 'completed' : 'failed'), exit_code:result?.exit_code ?? result?.code ?? null, job_id:result?.job_id || null });
    if (s.commands.length > 80) s.commands.splice(0, s.commands.length - 80);
  }

  async function status(id) {
    const s = get(id), p = projectForSession(s);
    return { ...publicSession(s), current:{ git:await gitSnapshot(p.id) } };
  }

  async function finishWork(id, verifyCommands = []) {
    const s = get(id), p = projectForSession(s);
    if (s.status !== 'active') return status(id);
    const verification = [];
    for (const command of (Array.isArray(verifyCommands) ? verifyCommands : []).map(String).filter(Boolean).slice(0,6)) {
      let r;
      if ((p.workspaceMode || 'safe') === 'trusted' && typeof api.exec === 'function') r = await api.exec(p.id, command, { background:false, timeout_ms:120000, work_session_id:s.id });
      else r = await api.runTask(p.id, command);
      const ok = r?.status ? r.status === 'completed' && r.exit_code === 0 : !!r?.ok;
      verification.push({ command, ok, status:r?.status || (r?.ok ? 'completed' : 'failed'), exit_code:r?.exit_code ?? r?.code ?? null, stdout:String(r?.stdout || '').slice(-16000), stderr:String(r?.stderr || '').slice(-16000) });
      if (!r?.status) recordCommand(s.id, p.id, command, r);
    }
    const brainStart = Date.now();
    await projects.reindex(p.id);
    const brain = typeof api.rebuildBrain === 'function' ? await api.rebuildBrain(p.id) : null;
    s.status = verification.every(x => x.ok) ? 'completed' : 'verification_failed';
    s.updatedAt = s.finishedAt = new Date().toISOString();
    return { ...publicSession(s), verification, verification_passed:verification.every(x => x.ok), brain:{ refreshed:true, refresh_ms:Date.now() - brainStart, updated_at:brain?.updatedAt || null, stats:brain?.stats || null }, final:{ git:await gitSnapshot(p.id) } };
  }

  async function rollbackWork(id) {
    const s = get(id), p = projectForSession(s), restored = [], errors = [];
    if (s.status === 'rolled_back') return status(id);
    for (const op of [...s.operations].reverse()) {
      try { restored.push(await directRestore(p, op)); }
      catch (error) { errors.push({ path:op.path, error:normalizeError(error) }); }
    }
    await projects.reindex(p.id);
    if (typeof api.rebuildBrain === 'function') await api.rebuildBrain(p.id);
    s.status = errors.length ? 'rollback_partial' : 'rolled_back';
    s.updatedAt = s.finishedAt = new Date().toISOString();
    return { ...publicSession(s), ok:errors.length === 0, restored, errors, final:{ git:await gitSnapshot(p.id) } };
  }

  function list(ref = '') {
    prune();
    const projectId = ref ? store.getProject(ref).id : '';
    return [...sessions.values()].filter(s => !projectId || s.projectId === projectId).sort((a,b) => b.startedAt.localeCompare(a.startedAt)).map(publicSession);
  }

  return { startWork, applyPatch, status, finishWork, rollbackWork, list, recordCommand };
}

function electronApi() {
  try { const e = require('electron'); return e && typeof e === 'object' ? e : null; } catch { return null; }
}

function installWorkRuntimePatches() {
  const safety = require('./safety-tools');
  if (safety.__workRuntimePatched) return;
  safety.__workRuntimePatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function workAwareSafeToolApi(projects, store, approvals, backups, options) {
    const api = previousCreate(projects, store, approvals, backups, options);
    const runtime = createWorkRuntime(projects, store, backups, api);
    api.startWork = (ref, goal) => runtime.startWork(ref, goal);
    api.applyPatch = (ref, patch, id) => runtime.applyPatch(ref, patch, id || '');
    api.workStatus = id => runtime.status(id);
    api.finishWork = (id, commands) => runtime.finishWork(id, commands || []);
    api.rollbackWork = id => runtime.rollbackWork(id);
    api.listWorkSessions = ref => runtime.list(ref || '');

    const originalExec = typeof api.exec === 'function' ? api.exec.bind(api) : null;
    if (originalExec) api.exec = async (ref, command, opts = {}) => {
      const result = await originalExec(ref, command, opts);
      if (opts?.work_session_id) runtime.recordCommand(opts.work_session_id, ref, command, result);
      return result;
    };

    const e = electronApi();
    if (e?.ipcMain?.handle && !e.ipcMain.__chatcodeWorkHandlers) {
      e.ipcMain.__chatcodeWorkHandlers = true;
      e.ipcMain.handle('work:list', (_, ref) => api.listWorkSessions(ref || ''));
      e.ipcMain.handle('work:status', (_, id) => api.workStatus(id));
      e.ipcMain.handle('work:rollback', (_, id) => api.rollbackWork(id));
    }
    return api;
  };
}

module.exports = { installWorkRuntimePatches, createWorkRuntime, parseUnifiedDiff, applyFilePatch };
