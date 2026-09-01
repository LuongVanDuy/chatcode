const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { chatError, normalizeError } = require('./errors');

const IGNORE_DIRS = new Set(['.git','node_modules','dist','build','out','target','.next','.cache','.idea','.vscode','vendor']);
const SENSITIVE_NAMES = new Set(['.env','.env.local','.env.production','wp-config.php','id_rsa','id_ed25519','credentials.json']);
const TEXT_EXTS = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.json','.md','.txt','.css','.scss','.html','.htm','.py','.go','.rs','.java','.kt','.kts','.c','.h','.cpp','.hpp','.cs','.php','.inc','.rb','.swift','.sql','.sh','.ps1','.yaml','.yml','.toml','.ini','.xml','.vue','.svelte','.csv']);
const BINARY_EXTS = new Set(['.exe','.dll','.so','.dylib','.zip','.7z','.rar','.gz','.png','.jpg','.jpeg','.gif','.webp','.ico','.pdf','.woff','.woff2','.ttf','.otf','.mp3','.mp4','.mov','.avi','.bin','.class','.jar']);
const TASK_COMMANDS = new Set(['npm','npm.cmd','pnpm','pnpm.cmd','yarn','yarn.cmd','bun','bun.exe','npx','npx.cmd','node','node.exe','python','python.exe','python3','pytest','pytest.exe','php','php.exe','cargo','cargo.exe','go','go.exe','dotnet','dotnet.exe','mvn','mvn.cmd','gradle','gradle.bat']);
const INDEX_MAX_FILES = 6000;

function sniffTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || '');
  if (!buffer.length) return true;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return true;
  let controls = 0;
  for (let i = 0; i < Math.min(buffer.length, 65536); i++) {
    const byte = buffer[i];
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) controls++;
  }
  if (controls / Math.min(buffer.length, 65536) > 0.025) return false;
  const text = buffer.toString('utf8');
  const replacements = (text.match(/\uFFFD/g) || []).length;
  return replacements <= Math.max(2, Math.floor(text.length * 0.002));
}

function containsShellMeta(input) {
  const text = String(input || ''); let quote = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ';' || ch === '>' || ch === '<' || ch === '|') return true;
    if (ch === '&' && next === '&') return true;
  }
  return false;
}

function resolvePhpExe(cwd) {
  const roots = [];
  if (process.env.PHP_HOME) roots.push(process.env.PHP_HOME);
  if (process.env.LARAGON_ROOT) roots.push(path.join(process.env.LARAGON_ROOT, 'bin', 'php'));
  let cursor = path.resolve(cwd || '.');
  while (true) {
    if (path.basename(cursor).toLowerCase() === 'www') roots.push(path.join(path.dirname(cursor), 'bin', 'php'));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const drive = path.parse(path.resolve(cwd || '.')).root;
  roots.push(path.join(drive, 'laragon', 'bin', 'php'), path.join(drive, 'xampp', 'php'));
  for (const root of [...new Set(roots)]) {
    const direct = path.join(root, 'php.exe');
    if (fs.existsSync(direct)) return direct;
    try {
      const versions = fs.readdirSync(root, { withFileTypes:true }).filter(item => item.isDirectory()).map(item => item.name).sort((a,b) => b.localeCompare(a, undefined, { numeric:true }));
      for (const version of versions) {
        const candidate = path.join(root, version, 'php.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {}
  }
  return 'php';
}

function resolveExe(command, cwd = '') {
  if (process.platform !== 'win32') return command;
  const lower = String(command).toLowerCase();
  if (lower === 'php' || lower === 'php.exe') return resolvePhpExe(cwd);
  return ({ npm:'npm.cmd', npx:'npx.cmd', pnpm:'pnpm.cmd', yarn:'yarn.cmd', gradle:'gradle.bat' })[lower] || command;
}

function createProjectService(store, { onIndexChanged, recordActivity } = {}) {
  const indexes = new Map(), watchers = new Map(), textCache = new Map();
  const normalizeRel = value => String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
  const isSensitive = rel => normalizeRel(rel).split('/').filter(Boolean).some(part => SENSITIVE_NAMES.has(part.toLowerCase()) || part.toLowerCase() === '.ssh' || /private.*key/i.test(part));
  const inside = (root, target) => { const r = path.resolve(root), t = path.resolve(target); return t === r || t.startsWith(r + path.sep); };

  async function canonicalRoot(project) {
    const root = path.resolve(project.root);
    try { return { root, real: await fsp.realpath(root) }; }
    catch (error) { throw chatError('FILE_NOT_FOUND', `Thư mục dự án không tồn tại: ${root}`, { path: root, cause: normalizeError(error) }); }
  }

  async function secureResolve(project, relPath, { mustExist = false } = {}) {
    const rel = normalizeRel(relPath), { root, real } = await canonicalRoot(project), lexical = path.resolve(root, rel || '.');
    if (!inside(root, lexical)) throw chatError('PATH_OUTSIDE_PROJECT', 'Đường dẫn nằm ngoài phạm vi dự án.', { path: rel });
    if (mustExist) {
      let actual;
      try { actual = await fsp.realpath(lexical); }
      catch (error) { if (error?.code === 'ENOENT') throw chatError('FILE_NOT_FOUND', `Không tìm thấy file: ${rel}`, { path: rel }); throw error; }
      if (!inside(real, actual)) throw chatError('PATH_OUTSIDE_PROJECT', 'Symlink/junction dẫn ra ngoài dự án đã bị chặn.', { path: rel });
      return actual;
    }
    let probe = lexical; const missing = [];
    while (true) {
      try { await fsp.lstat(probe); break; }
      catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const parent = path.dirname(probe); if (parent === probe) throw chatError('PATH_OUTSIDE_PROJECT', 'Không thể xác thực đường dẫn.', { path: rel });
        missing.unshift(path.basename(probe)); probe = parent;
      }
    }
    const actualParent = await fsp.realpath(probe);
    if (!inside(real, actualParent)) throw chatError('PATH_OUTSIDE_PROJECT', 'Symlink/junction dẫn ra ngoài dự án đã bị chặn.', { path: rel });
    const target = path.resolve(actualParent, ...missing);
    if (!inside(real, target)) throw chatError('PATH_OUTSIDE_PROJECT', 'Đường dẫn đích nằm ngoài dự án.', { path: rel });
    return target;
  }

  const indexEntry = id => { if (!indexes.has(id)) indexes.set(id, { files:[], updatedAt:'', dirty:true, building:null, lastError:'', watching:false, buildMs:0, rebuildTimer:null }); return indexes.get(id); };
  const statusSafe = id => { try { return status(id); } catch { return { id, fileCount:0, dirty:true, building:false, watching:false, lastError:'Project unavailable', buildMs:0, updatedAt:'' }; } };
  function notify(id) { onIndexChanged?.({ projectId:id, ...statusSafe(id) }); }
  function invalidate(id, rel = '') { const idx = indexEntry(id); idx.dirty = true; if (rel) textCache.delete(`${id}:${normalizeRel(rel)}`); notify(id); }

  async function scan(project, max = INDEX_MAX_FILES) {
    const files = [], started = Date.now(), { real } = await canonicalRoot(project);
    async function walk(abs, rel) {
      if (files.length >= max) return; let entries;
      try { entries = await fsp.readdir(abs, { withFileTypes:true }); } catch { return; }
      for (const entry of entries) {
        if (files.length >= max) break; const nextRel = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name) || entry.name === '.ssh') continue;
          const nextAbs = path.join(abs, entry.name); try { const realDir = await fsp.realpath(nextAbs); if (!inside(real, realDir)) continue; } catch { continue; }
          await walk(nextAbs, nextRel);
        } else if (entry.isFile() && !isSensitive(nextRel)) files.push(nextRel.split(path.sep).join('/'));
      }
    }
    await walk(real, ''); return { files, buildMs:Date.now() - started };
  }

  async function build(ref, force = false) {
    const project = store.getProject(ref), idx = indexEntry(project.id); if (!force && !idx.dirty && idx.files.length) return idx; if (idx.building) return idx.building;
    idx.building = (async () => { try { const result = await scan(project); idx.files = result.files; idx.updatedAt = new Date().toISOString(); idx.dirty = false; idx.lastError = ''; idx.buildMs = result.buildMs; return idx; } catch (error) { idx.lastError = String(error.message || error); throw error; } finally { idx.building = null; notify(project.id); } })();
    return idx.building;
  }

  function stopWatcher(id) { const watcher = watchers.get(id); if (watcher) { try { watcher.close(); } catch {} watchers.delete(id); } const idx = indexes.get(id); if (idx) idx.watching = false; }
  function watch(project) {
    stopWatcher(project.id); const idx = indexEntry(project.id);
    try {
      const watcher = fs.watch(project.root, { recursive:true }, (_, filename) => { const rel = filename ? String(filename) : ''; invalidate(project.id, rel); clearTimeout(idx.rebuildTimer); idx.rebuildTimer = setTimeout(() => build(project.id, true).catch(() => {}), 800); });
      watcher.on('error', error => { idx.watching = false; idx.lastError = String(error.message || error); notify(project.id); }); watchers.set(project.id, watcher); idx.watching = true; idx.lastError = '';
    } catch (error) { idx.watching = false; idx.lastError = String(error.message || error); }
    notify(project.id);
  }
  async function initialize() { for (const project of store.read().projects) { watch(project); build(project.id).catch(() => {}); } }
  function cleanup(id) { stopWatcher(id); indexes.delete(id); for (const key of [...textCache.keys()]) if (key.startsWith(`${id}:`)) textCache.delete(key); }
  function shutdown() { for (const id of [...watchers.keys()]) stopWatcher(id); }
  function status(ref) { const project = store.getProject(ref), idx = indexEntry(project.id); return { id:project.id, fileCount:idx.files.length, updatedAt:idx.updatedAt, dirty:idx.dirty, building:!!idx.building, watching:!!idx.watching, lastError:idx.lastError, buildMs:idx.buildMs }; }
  async function reindex(ref) { await build(ref, true); return status(ref); }

  async function readText(project, relPath, maxBytes = 220000) {
    const rel = normalizeRel(relPath);
    if (!rel) throw chatError('FILE_NOT_FOUND', 'Đường dẫn file đang trống.');
    if (isSensitive(rel)) throw chatError('SENSITIVE_PATH_BLOCKED', 'File nhạy cảm đã bị chặn.', { path:rel });
    const target = await secureResolve(project, rel, { mustExist:true }), stat = await fsp.stat(target);
    if (!stat.isFile()) throw chatError('FILE_NOT_FOUND', 'Đường dẫn không phải file.', { path:rel });
    if (stat.size > maxBytes) throw chatError('UNSUPPORTED_BINARY', `File quá lớn (${stat.size} bytes).`, { path:rel, size:stat.size });
    const ext = path.extname(target).toLowerCase(); if (BINARY_EXTS.has(ext)) throw chatError('UNSUPPORTED_BINARY', 'Định dạng binary không hỗ trợ.', { path:rel, extension:ext });
    const key = `${project.id}:${rel}`, cached = textCache.get(key); if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.text;
    const buffer = await fsp.readFile(target);
    if (!TEXT_EXTS.has(ext) && !sniffTextBuffer(buffer)) throw chatError('UNSUPPORTED_BINARY', 'Nội dung file được nhận diện là binary/không hỗ trợ.', { path:rel, extension:ext });
    const text = buffer.toString('utf8'); if (stat.size < 180000) textCache.set(key, { mtimeMs:stat.mtimeMs, size:stat.size, text }); return text;
  }

  async function searchFiles(project, query) {
    const q = String(query || '').trim().toLowerCase(); if (!q) return []; const words = q.split(/\s+/).filter(word => word.length > 1).slice(0, 8), idx = await build(project.id), results = [];
    for (const rel of idx.files) {
      if (results.length >= 100) break; const relLower = rel.toLowerCase(), nameScore = words.reduce((score, word) => score + (relLower.includes(word) ? 5 : 0), 0); let text = '';
      try { text = await readText(project, rel, 100000); } catch (error) { if (nameScore) results.push({ path:rel, score:nameScore, snippet:'', error:normalizeError(error).code }); continue; }
      const lower = text.toLowerCase(), score = nameScore + words.reduce((value, word) => value + (lower.includes(word) ? 2 : 0), 0); if (!score && !relLower.includes(q)) continue;
      const positions = words.map(word => lower.indexOf(word)).filter(index => index >= 0).sort((a, b) => a - b), first = positions[0] ?? 0; results.push({ path:rel, score, snippet:text.slice(Math.max(0, first - 260), Math.max(0, first - 260) + 1200) });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 30);
  }

  function runExec(command, args, cwd, timeout = 120000) { return new Promise(resolve => execFile(command, args, { cwd, timeout, windowsHide:true, shell:false, maxBuffer:4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok:!error, code:error?.code ?? 0, stdout:String(stdout || ''), stderr:String(stderr || error?.message || '') }))); }
  function parseCommand(input) { return (String(input || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map(value => value.replace(/^("|')|("|')$/g, '')); }
  function requirePermission(project, key, label) { if (!project.permissions?.[key]) throw chatError('PERMISSION_DENIED', `Quyền ${label} đang tắt cho dự án "${project.name}".`, { project:project.name, permission:key }); }

  const toolApi = {
    listProjects() { return store.read().projects.map(project => ({ id:project.id, name:project.name, root:project.root, permissions:project.permissions })); },
    async listFiles(ref, limit = 2500) { const idx = await build(ref); return idx.files.slice(0, Math.min(5000, Math.max(1, Number(limit) || 2500))); },
    async search(ref, query) { return searchFiles(store.getProject(ref), query); },
    async readFile(ref, rel) { const project = store.getProject(ref); return { path:normalizeRel(rel), content:await readText(project, rel) }; },
    async readFiles(ref, paths) { const project = store.getProject(ref), out = []; for (const rel of (Array.isArray(paths) ? paths : []).slice(0, 12)) { try { out.push({ path:normalizeRel(rel), content:await readText(project, rel) }); } catch (error) { out.push({ path:normalizeRel(rel), error:normalizeError(error) }); } } return out; },
    async writeFile(ref, relPath, content) { const project = store.getProject(ref); requirePermission(project, 'write', 'ghi file'); const rel = normalizeRel(relPath); if (!rel) throw chatError('FILE_NOT_FOUND','Đường dẫn file đang trống.'); if (isSensitive(rel)) throw chatError('SENSITIVE_PATH_BLOCKED','File nhạy cảm đã bị chặn.',{ path:rel }); const target = await secureResolve(project, rel); await fsp.mkdir(path.dirname(target), { recursive:true }); const verified = await secureResolve(project, rel); await fsp.writeFile(verified, String(content), 'utf8'); invalidate(project.id, rel); return { ok:true, path:rel }; },
    async deleteFile(ref, relPath) { const project = store.getProject(ref); requirePermission(project, 'manageFiles', 'xóa/đổi tên file'); const rel = normalizeRel(relPath); if (isSensitive(rel)) throw chatError('SENSITIVE_PATH_BLOCKED','File nhạy cảm đã bị chặn.',{ path:rel }); const target = await secureResolve(project, rel, { mustExist:true }), stat = await fsp.stat(target); if (!stat.isFile()) throw chatError('FILE_NOT_FOUND','Chỉ cho phép xóa file.',{ path:rel }); await fsp.unlink(target); invalidate(project.id, rel); return { ok:true, path:rel }; },
    async renameFile(ref, fromPath, toPath) { const project = store.getProject(ref); requirePermission(project, 'manageFiles', 'xóa/đổi tên file'); const fromRel = normalizeRel(fromPath), toRel = normalizeRel(toPath); if (isSensitive(fromRel) || isSensitive(toRel)) throw chatError('SENSITIVE_PATH_BLOCKED','File nhạy cảm đã bị chặn.',{ from:fromRel, to:toRel }); const from = await secureResolve(project, fromRel, { mustExist:true }), to = await secureResolve(project, toRel); await fsp.mkdir(path.dirname(to), { recursive:true }); const verified = await secureResolve(project, toRel); await fsp.rename(from, verified); invalidate(project.id, fromRel); invalidate(project.id, toRel); return { ok:true, from:fromRel, to:toRel }; },
    async runTask(ref, commandLine) { const project = store.getProject(ref); requirePermission(project, 'tasks', 'chạy tác vụ'); const raw = String(commandLine || '').trim(); if (containsShellMeta(raw)) throw chatError('TASK_NOT_ALLOWED','Shell chaining/toán tử shell không được phép. Hãy chạy một command duy nhất.',{ command:raw.slice(0,220) }); const parts = parseCommand(raw); if (!parts.length || !TASK_COMMANDS.has(parts[0].toLowerCase())) throw chatError('TASK_NOT_ALLOWED','Lệnh này không nằm trong danh sách tác vụ an toàn.',{ command:parts[0] || '' }); const cwd = (await canonicalRoot(project)).real; return runExec(resolveExe(parts[0], cwd), parts.slice(1), cwd); },
    async gitStatus(ref) { const project = store.getProject(ref); return runExec('git', ['status','--short','--branch'], (await canonicalRoot(project)).real, 30000); },
    async gitDiff(ref, staged = false) { const project = store.getProject(ref); return runExec('git', staged ? ['diff','--cached','--','.'] : ['diff','--','.'], (await canonicalRoot(project)).real, 30000); },
    async gitStage(ref, paths) { const project = store.getProject(ref); requirePermission(project, 'gitWrite', 'ghi Git'); const list = (Array.isArray(paths) ? paths : []).slice(0, 100).map(normalizeRel).filter(Boolean); if (!list.length) throw chatError('FILE_NOT_FOUND','Hãy chỉ định file cần stage.'); for (const rel of list) { if (isSensitive(rel)) throw chatError('SENSITIVE_PATH_BLOCKED',`Đường dẫn nhạy cảm đã bị chặn: ${rel}`,{ path:rel }); await secureResolve(project, rel, { mustExist:true }); } return runExec('git', ['add','--',...list], (await canonicalRoot(project)).real, 30000); },
    async gitCommit(ref, message) { const project = store.getProject(ref); requirePermission(project, 'gitWrite', 'ghi Git'); const text = String(message || '').trim(); if (!text) throw chatError('FILE_NOT_FOUND','Cần có nội dung commit.'); return runExec('git', ['commit','-m',text], (await canonicalRoot(project)).real, 60000); },
    recordActivity
  };

  return { toolApi, watch, initialize, cleanup, shutdown, status, reindex, secureResolve, canonicalRoot, invalidate, readText, containsShellMeta };
}

module.exports = { createProjectService, sniffTextBuffer, containsShellMeta, resolvePhpExe };
