const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { chatError, normalizeError } = require('./errors');

const BUILTIN_PROJECT_ID = 'chatcode-gpt-skills';
const BUILTIN_PROJECT_NAME = 'CHATCODE-GPT';
const BUILTIN_ROOT = path.join(__dirname, '..', 'CHATCODE-GPT');
const READ_ONLY_PERMISSIONS = Object.freeze({ write:false, manageFiles:false, tasks:false, gitWrite:false });

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function isBuiltinRef(ref) {
  const value = String(ref || '').trim().toLowerCase();
  return value === BUILTIN_PROJECT_ID || value === BUILTIN_PROJECT_NAME.toLowerCase();
}

function builtinDescriptor() {
  return {
    id:BUILTIN_PROJECT_ID,
    name:BUILTIN_PROJECT_NAME,
    root:'builtin://CHATCODE-GPT',
    permissions:{ ...READ_ONLY_PERMISSIONS },
    workspace_mode:'safe',
    trusted:{ allow_secrets:false, allow_git_push:false },
    safety_mode:'builtin_read_only',
    read_only:true,
    kind:'builtin-skill-library',
    description:'Built-in ChatCode skills. Read with list_files/search_project/read_file/read_files.'
  };
}

function inside(root, target) {
  const r = path.resolve(root), t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}

function resolveBuiltin(relPath, { mustExist = false } = {}) {
  const rel = normalizeRel(relPath);
  const root = path.resolve(BUILTIN_ROOT);
  const target = path.resolve(root, rel || '.');
  if (!inside(root, target)) throw chatError('PATH_OUTSIDE_PROJECT', 'Đường dẫn nằm ngoài thư viện skill tích hợp.', { path:rel });
  if (mustExist && !fs.existsSync(target)) throw chatError('FILE_NOT_FOUND', `Không tìm thấy file skill: ${rel}`, { path:rel });
  return { rel, target };
}

async function listBuiltinFiles(limit = 2500) {
  if (!fs.existsSync(BUILTIN_ROOT)) return [];
  const out = [], max = Math.min(5000, Math.max(1, Number(limit) || 2500));
  async function walk(abs, rel) {
    if (out.length >= max) return;
    let entries = [];
    try { entries = await fsp.readdir(abs, { withFileTypes:true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= max) break;
      if (entry.isSymbolicLink()) continue;
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      const nextAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) await walk(nextAbs, nextRel);
      else if (entry.isFile()) out.push(nextRel);
    }
  }
  await walk(BUILTIN_ROOT, '');
  return out;
}

async function readBuiltinFile(relPath, maxBytes = 220000) {
  const { rel, target } = resolveBuiltin(relPath, { mustExist:true });
  const stat = await fsp.stat(target);
  if (!stat.isFile()) throw chatError('FILE_NOT_FOUND', 'Đường dẫn skill không phải file.', { path:rel });
  if (stat.size > maxBytes) throw chatError('UNSUPPORTED_BINARY', `File skill quá lớn (${stat.size} bytes).`, { path:rel, size:stat.size });
  const buffer = await fsp.readFile(target);
  if (buffer.includes(0)) throw chatError('UNSUPPORTED_BINARY', 'File skill binary không được hỗ trợ.', { path:rel });
  return { path:rel, content:buffer.toString('utf8') };
}

async function searchBuiltin(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(word => word.length > 1).slice(0,8);
  const files = await listBuiltinFiles(5000);
  const results = [];
  for (const rel of files) {
    if (results.length >= 100) break;
    const relLower = rel.toLowerCase();
    const nameScore = words.reduce((score, word) => score + (relLower.includes(word) ? 5 : 0), 0);
    let text = '';
    try { text = (await readBuiltinFile(rel, 100000)).content; }
    catch (error) {
      if (nameScore) results.push({ path:rel, score:nameScore, snippet:'', error:normalizeError(error).code });
      continue;
    }
    const lower = text.toLowerCase();
    const score = nameScore + words.reduce((value, word) => value + (lower.includes(word) ? 2 : 0), 0);
    if (!score && !relLower.includes(q)) continue;
    const positions = words.map(word => lower.indexOf(word)).filter(index => index >= 0).sort((a,b) => a-b);
    const first = positions[0] ?? 0;
    results.push({ path:rel, score, snippet:text.slice(Math.max(0, first - 260), Math.max(0, first - 260) + 1200) });
  }
  return results.sort((a,b) => b.score - a.score).slice(0,30);
}

function appendBuiltinProject(list) {
  const items = Array.isArray(list) ? [...list] : [];
  if (!fs.existsSync(BUILTIN_ROOT)) return items;
  if (!items.some(item => isBuiltinRef(item?.id) || isBuiltinRef(item?.name))) items.push(builtinDescriptor());
  return items;
}

function denyBuiltinOperation(ref, operation) {
  if (!isBuiltinRef(ref)) return;
  throw chatError('PERMISSION_DENIED', `CHATCODE-GPT là thư viện skill read-only; không cho phép ${operation}.`, {
    project:BUILTIN_PROJECT_NAME,
    operation,
    read_only:true
  });
}

function installProjectPatch() {
  const projectModule = require('./projects');
  if (projectModule.__builtinSkillsProjectPatched) return;
  projectModule.__builtinSkillsProjectPatched = true;
  const previousCreate = projectModule.createProjectService;

  projectModule.createProjectService = function builtinSkillsProjectService(store, options) {
    const service = previousCreate(store, options);
    const api = service.toolApi;
    const original = {
      listProjects:api.listProjects.bind(api),
      listFiles:api.listFiles.bind(api),
      search:api.search.bind(api),
      readFile:api.readFile.bind(api),
      readFiles:api.readFiles.bind(api)
    };

    api.listProjects = (...args) => appendBuiltinProject(original.listProjects(...args));
    api.listFiles = (ref, limit) => isBuiltinRef(ref) ? listBuiltinFiles(limit) : original.listFiles(ref, limit);
    api.search = (ref, query) => isBuiltinRef(ref) ? searchBuiltin(query) : original.search(ref, query);
    api.readFile = (ref, rel) => isBuiltinRef(ref) ? readBuiltinFile(rel) : original.readFile(ref, rel);
    api.readFiles = async (ref, paths) => {
      if (!isBuiltinRef(ref)) return original.readFiles(ref, paths);
      const out = [];
      for (const rel of (Array.isArray(paths) ? paths : []).slice(0,12)) {
        try { out.push(await readBuiltinFile(rel)); }
        catch (error) { out.push({ path:normalizeRel(rel), error:normalizeError(error) }); }
      }
      return out;
    };

    return service;
  };
}

function installSafetyPatch() {
  const safetyModule = require('./safety-tools');
  if (safetyModule.__builtinSkillsProjectPatched) return;
  safetyModule.__builtinSkillsProjectPatched = true;
  const previousCreate = safetyModule.createSafeToolApi;

  safetyModule.createSafeToolApi = function builtinSkillsSafeApi(projects, store, approvals, backups, options) {
    const api = previousCreate(projects, store, approvals, backups, options);
    const original = {};
    for (const name of ['listProjects','listFiles','search','readFile','readFiles','writeFile','deleteFile','renameFile','runTask','gitStatus','gitDiff','gitStage','gitCommit']) {
      if (typeof api[name] === 'function') original[name] = api[name].bind(api);
    }

    api.listProjects = (...args) => appendBuiltinProject(original.listProjects ? original.listProjects(...args) : []);

    for (const name of ['listFiles','search','readFile','readFiles']) {
      api[name] = (ref, ...args) => {
        if (!isBuiltinRef(ref)) return original[name](ref, ...args);
        return projects.toolApi[name](ref, ...args);
      };
    }

    const blocked = {
      writeFile:'ghi file',
      deleteFile:'xóa file',
      renameFile:'đổi tên/di chuyển file',
      runTask:'chạy task',
      gitStatus:'đọc Git status',
      gitDiff:'đọc Git diff',
      gitStage:'Git stage',
      gitCommit:'Git commit'
    };
    for (const [name, label] of Object.entries(blocked)) {
      if (!original[name]) continue;
      api[name] = (ref, ...args) => {
        denyBuiltinOperation(ref, label);
        return original[name](ref, ...args);
      };
    }

    return api;
  };
}

function installBuiltinSkillsProjectPatches() {
  installProjectPatch();
  installSafetyPatch();
  return true;
}

module.exports = {
  BUILTIN_PROJECT_ID,
  BUILTIN_PROJECT_NAME,
  BUILTIN_ROOT,
  builtinDescriptor,
  isBuiltinRef,
  listBuiltinFiles,
  readBuiltinFile,
  searchBuiltin,
  installBuiltinSkillsProjectPatches
};
