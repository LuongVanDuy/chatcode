const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { chatError, normalizeError } = require('./errors');

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILES = 4000;
const MAX_WALK_DEPTH = 16;

const guardian = {
  stopped:false,
  stoppedAt:'',
  resumedAt:'',
  reason:''
};

function isMachine(project) {
  return project?.workspaceMode === 'machine' || project?.safety?._workspaceMode === 'machine';
}

function guardianSnapshot() {
  return {
    stopped:!!guardian.stopped,
    stopped_at:guardian.stoppedAt || '',
    resumed_at:guardian.resumedAt || '',
    reason:guardian.reason || '',
    hotkey:'Ctrl+Shift+F12'
  };
}

function guardianStop(reason = 'user') {
  guardian.stopped = true;
  guardian.stoppedAt = new Date().toISOString();
  guardian.reason = String(reason || 'user').slice(0,120);
  return guardianSnapshot();
}

function guardianResume() {
  guardian.stopped = false;
  guardian.resumedAt = new Date().toISOString();
  guardian.reason = '';
  return guardianSnapshot();
}

function assertGuardian() {
  if (guardian.stopped) {
    throw chatError('GUARDIAN_STOPPED', 'STOP ALL đang bật. Chỉ người dùng trong ứng dụng ChatCode mới có thể Resume.', guardianSnapshot());
  }
}

function resolveMachinePath(project, input, { defaultToProject = false } = {}) {
  const raw = String(input || '').trim();
  if (!raw) {
    if (defaultToProject) return path.resolve(project.root);
    throw chatError('FILE_NOT_FOUND', 'Đường dẫn đang trống.');
  }
  if (path.isAbsolute(raw)) return path.normalize(raw);
  if (process.platform === 'win32' && path.win32.isAbsolute(raw)) return path.win32.normalize(raw);
  return path.resolve(project.root, raw);
}

function bufferLooksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 65536));
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

async function readMachineFile(project, input) {
  const target = resolveMachinePath(project, input);
  let stat;
  try { stat = await fsp.stat(target); }
  catch (error) { if (error?.code === 'ENOENT') throw chatError('FILE_NOT_FOUND', `Không tìm thấy file: ${target}`, { path:target }); throw error; }
  if (!stat.isFile()) throw chatError('FILE_NOT_FOUND', 'Đường dẫn không phải file.', { path:target });
  if (stat.size > MAX_READ_BYTES) {
    throw chatError('FILE_TOO_LARGE', `File quá lớn cho read_file (${stat.size} bytes). Full Machine vẫn có thể đọc theo chunk bằng terminal.`, { path:target, size:stat.size, max_bytes:MAX_READ_BYTES });
  }
  const buffer = await fsp.readFile(target);
  if (bufferLooksBinary(buffer)) {
    return { path:target, content:buffer.toString('base64'), encoding:'base64', binary:true, size:stat.size };
  }
  return { path:target, content:buffer.toString('utf8'), encoding:'utf8', binary:false, size:stat.size };
}

async function walkMachine(start, limit = 2500) {
  const files = [];
  const capped = Math.min(5000, Math.max(1, Number(limit) || 2500));
  async function walk(abs, depth) {
    if (files.length >= capped || depth > MAX_WALK_DEPTH) return;
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes:true }); }
    catch { return; }
    for (const entry of entries) {
      if (files.length >= capped) break;
      const next = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(next, depth + 1);
      else if (entry.isFile()) files.push(next);
    }
  }
  const stat = await fsp.stat(start).catch(() => null);
  if (!stat) throw chatError('FILE_NOT_FOUND', `Không tìm thấy đường dẫn: ${start}`, { path:start });
  if (stat.isFile()) return [start];
  await walk(start, 0);
  return files;
}

async function searchMachine(project, query, basePath = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(word => word.length > 1).slice(0,8);
  const root = resolveMachinePath(project, basePath, { defaultToProject:true });
  const paths = await walkMachine(root, MAX_SEARCH_FILES);
  const results = [];
  for (const file of paths) {
    if (results.length >= 100) break;
    const lowerPath = file.toLowerCase();
    const nameScore = words.reduce((score, word) => score + (lowerPath.includes(word) ? 5 : 0), 0);
    let stat;
    try { stat = await fsp.stat(file); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_READ_BYTES) {
      if (nameScore) results.push({ path:file, score:nameScore, snippet:'' });
      continue;
    }
    let buffer;
    try { buffer = await fsp.readFile(file); } catch { continue; }
    if (bufferLooksBinary(buffer)) {
      if (nameScore) results.push({ path:file, score:nameScore, snippet:'' });
      continue;
    }
    const text = buffer.toString('utf8');
    const lower = text.toLowerCase();
    const score = nameScore + words.reduce((value, word) => value + (lower.includes(word) ? 2 : 0), 0);
    if (!score && !lowerPath.includes(q)) continue;
    const positions = words.map(word => lower.indexOf(word)).filter(index => index >= 0).sort((a,b)=>a-b);
    const first = positions[0] ?? 0;
    results.push({ path:file, score, snippet:text.slice(Math.max(0, first - 260), Math.max(0, first - 260) + 1200) });
  }
  return results.sort((a,b)=>b.score-a.score).slice(0,30);
}

function machineApproval() {
  return { required:false, status:'not_required', approval_id:null, mode:'full_machine_access' };
}

function installMachineAccessPatches() {
  const safety = require('./safety-tools');
  if (safety.__machineAccessPatched) return;
  safety.__machineAccessPatched = true;
  const previousCreate = safety.createSafeToolApi;

  safety.createSafeToolApi = function machineAwareSafeToolApi(projects, store, approvals, backups, options) {
    const api = previousCreate(projects, store, approvals, backups, options);
    const original = {};
    for (const name of ['listProjects','listFiles','search','readFile','readFiles','writeFile','deleteFile','renameFile','runTask','exec','applyAndVerify','inspectProject','prepareTask','projectScope']) {
      if (typeof api[name] === 'function') original[name] = api[name].bind(api);
    }

    api.listProjects = async (...args) => {
      const list = await original.listProjects(...args);
      return (Array.isArray(list) ? list : []).map(item => {
        let project = null;
        try { project = store.getProject(item.id || item.name); } catch {}
        return {
          ...item,
          workspace_mode:project?.workspaceMode || item.workspace_mode || 'safe',
          full_machine_access:isMachine(project),
          machine_scope:isMachine(project) ? 'all_os_visible_filesystems' : 'project_root'
        };
      });
    };

    api.listFiles = async (ref, limit = 2500, basePath = '') => {
      const project = store.getProject(ref);
      if (!isMachine(project)) return original.listFiles(ref, limit, basePath);
      const start = resolveMachinePath(project, basePath, { defaultToProject:true });
      return walkMachine(start, limit);
    };

    api.search = async (ref, query, basePath = '') => {
      const project = store.getProject(ref);
      if (!isMachine(project) || !basePath) return original.search(ref, query, basePath);
      return searchMachine(project, query, basePath);
    };

    api.readFile = async (ref, input) => {
      const project = store.getProject(ref);
      if (!isMachine(project)) return original.readFile(ref, input);
      return readMachineFile(project, input);
    };

    api.readFiles = async (ref, paths) => {
      const project = store.getProject(ref);
      if (!isMachine(project)) return original.readFiles(ref, paths);
      const out = [];
      for (const input of (Array.isArray(paths) ? paths : []).slice(0,12)) {
        try { out.push(await readMachineFile(project, input)); }
        catch (error) { out.push({ path:String(input || ''), error:normalizeError(error) }); }
      }
      return out;
    };

    api.writeFile = async (ref, input, content) => {
      const project = store.getProject(ref);
      if (!isMachine(project)) return original.writeFile(ref, input, content);
      assertGuardian();
      const target = resolveMachinePath(project, input);
      await fsp.mkdir(path.dirname(target), { recursive:true });
      await fsp.writeFile(target, String(content), 'utf8');
      return { ok:true, path:target, approval:machineApproval(), machine_scope:true };
    };

    api.deleteFile = async (ref, input) => {
      const project = store.getProject(ref);
      if (!isMachine(project)) return original.deleteFile(ref, input);
      assertGuardian();
      const target = resolveMachinePath(project, input);
      const stat = await fsp.stat(target).catch(() => null);
      if (!stat || !stat.isFile()) throw chatError('FILE_NOT_FOUND', 'Full Machine delete_file chỉ xóa file tồn tại; thư mục có thể quản lý bằng terminal.', { path:target });
      await fsp.unlink(target);
      return { ok:true, path:target, approval:machineApproval(), machine_scope:true };
    };

    api.renameFile = async (ref, fromInput, toInput) => {
      const project = store.getProject(ref);
      if (!isMachine(project)) return original.renameFile(ref, fromInput, toInput);
      assertGuardian();
      const from = resolveMachinePath(project, fromInput), to = resolveMachinePath(project, toInput);
      await fsp.mkdir(path.dirname(to), { recursive:true });
      await fsp.rename(from, to);
      return { ok:true, from, to, approval:machineApproval(), machine_scope:true };
    };

    api.runTask = async (ref, command) => {
      const project = store.getProject(ref);
      if (!isMachine(project)) return original.runTask(ref, command);
      assertGuardian();
      if (typeof api.exec !== 'function') throw chatError('TASK_NOT_ALLOWED', 'Terminal runtime chưa sẵn sàng.');
      return api.exec(ref, command, { cwd:project.root, background:false });
    };

    api.applyAndVerify = async (ref, changesInput = [], tasksInput = []) => {
      const project = store.getProject(ref);
      if (!isMachine(project)) return original.applyAndVerify(ref, changesInput, tasksInput);
      assertGuardian();
      const changes = Array.isArray(changesInput) ? changesInput.slice(0,64) : [];
      const tasks = Array.isArray(tasksInput) ? tasksInput.map(String).filter(Boolean).slice(0,12) : [];
      const outputs = [], verification = [];
      for (const change of changes) {
        const op = String(change.op || change.operation || '').toLowerCase();
        if (op === 'write') {
          const result = await api.writeFile(ref, change.path, String(change.content ?? ''));
          const read = await api.readFile(ref, change.path);
          const ok = read.encoding === 'utf8' && String(read.content) === String(change.content ?? '');
          outputs.push({ operation:op, target:result.path, ...result });
          verification.push({ operation:op, path:result.path, ok, check:'exact-content' });
        } else if (op === 'patch') {
          const read = await api.readFile(ref, change.path);
          if (read.encoding !== 'utf8') throw chatError('PATCH_CONFLICT', 'Không patch trực tiếp binary file.');
          let text = String(read.content || '');
          for (const edit of (Array.isArray(change.edits) ? change.edits : []).slice(0,80)) {
            const find = String(edit.find ?? ''), replace = String(edit.replace ?? '');
            if (!find || !text.includes(find)) throw chatError('PATCH_CONFLICT', 'Không tìm thấy đoạn cần thay thế.', { path:read.path, find:find.slice(0,160) });
            const count = text.split(find).length - 1;
            if (!edit.all && count !== 1) throw chatError('PATCH_CONFLICT', 'Đoạn patch xuất hiện nhiều hơn một lần.', { path:read.path, occurrences:count });
            text = edit.all ? text.split(find).join(replace) : text.replace(find, replace);
          }
          const result = await api.writeFile(ref, change.path, text);
          outputs.push({ operation:op, target:result.path, ...result });
          verification.push({ operation:op, path:result.path, ok:true, check:'patch-applied' });
        } else if (op === 'rename' || op === 'move') {
          const result = await api.renameFile(ref, change.from, change.to);
          outputs.push({ operation:op, target:`${result.from} → ${result.to}`, ...result });
          verification.push({ operation:op, from:result.from, to:result.to, ok:true, check:'renamed' });
        } else if (op === 'delete') {
          const result = await api.deleteFile(ref, change.path);
          outputs.push({ operation:op, target:result.path, ...result });
          verification.push({ operation:op, path:result.path, ok:!fs.existsSync(result.path), check:'deleted' });
        } else {
          throw chatError('INTERNAL_ERROR', `Change operation không hỗ trợ: ${op || '(trống)'}`);
        }
      }
      const taskOutputs = [];
      for (const command of tasks) {
        const result = await api.exec(ref, command, { cwd:project.root, background:false });
        taskOutputs.push({ command, ...result });
        verification.push({ operation:'task', command, ok:result.ok !== false && (result.exit_code == null || Number(result.exit_code) === 0), check:'exit-code', code:result.exit_code ?? result.code ?? null });
      }
      const verificationPassed = verification.every(item => item.ok !== false);
      return {
        ok:verificationPassed,
        status:'completed',
        job_id:crypto.randomUUID(),
        project:project.name,
        workspace_mode:'machine',
        machine_scope:'all_os_visible_filesystems',
        changes:outputs,
        tasks:taskOutputs,
        verification,
        verification_passed:verificationPassed,
        approval:machineApproval(),
        guardian:guardianSnapshot()
      };
    };

    if (original.inspectProject) {
      api.inspectProject = async (ref, ...args) => {
        const result = await original.inspectProject(ref, ...args);
        const project = store.getProject(ref);
        if (!isMachine(project)) return result;
        return { ...result, machine_scope:'all_os_visible_filesystems', guardian:guardianSnapshot() };
      };
    }

    if (original.prepareTask) {
      api.prepareTask = async (ref, ...args) => {
        const result = await original.prepareTask(ref, ...args);
        const project = store.getProject(ref);
        if (!isMachine(project)) return result;
        const guidance = Array.isArray(result?.agent_contract?.guidance) ? result.agent_contract.guidance : [];
        return {
          ...result,
          machine_scope:'all_os_visible_filesystems',
          guardian:guardianSnapshot(),
          agent_contract:result?.agent_contract ? {
            ...result.agent_contract,
            guidance:[
              'Full Machine Access đang bật: đường dẫn tuyệt đối trên mọi filesystem mà tài khoản hệ điều hành nhìn thấy đều được phép; không áp dụng project-root/owner/approval scope cho file và terminal.',
              'Có thể dùng read_file/read_files/write_file/delete_file/rename_file với absolute path và exec với absolute cwd. STOP ALL là user-only Guardian và không được bypass.',
              ...guidance
            ]
          } : result?.agent_contract
        };
      };
    }

    if (original.projectScope) {
      api.projectScope = ref => {
        if (ref) {
          let project = null;
          try { project = store.getProject(ref); } catch {}
          if (isMachine(project)) return { locked:false, machine_scope:true, scope:'all_os_visible_filesystems', guardian:guardianSnapshot() };
        }
        return original.projectScope(ref);
      };
    }

    return api;
  };
}

module.exports = {
  MAX_READ_BYTES,
  isMachine,
  guardianSnapshot,
  guardianStop,
  guardianResume,
  assertGuardian,
  resolveMachinePath,
  readMachineFile,
  walkMachine,
  searchMachine,
  installMachineAccessPatches
};
