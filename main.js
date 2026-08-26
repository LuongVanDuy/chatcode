const { app, BrowserWindow, dialog, ipcMain, clipboard } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const PORT = 47820;
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'target', '.next', '.cache', '.idea', '.vscode']);
const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'credentials.json']);
const TEXT_EXTS = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.json','.md','.txt','.css','.scss','.html','.htm','.py','.go','.rs','.java','.kt','.kts','.c','.h','.cpp','.hpp','.cs','.php','.rb','.swift','.sql','.sh','.ps1','.yaml','.yml','.toml','.ini','.xml','.vue','.svelte','.csv']);
const TASK_COMMANDS = new Set(['npm','npm.cmd','pnpm','pnpm.cmd','yarn','yarn.cmd','bun','bun.exe','npx','npx.cmd','node','node.exe','python','python.exe','python3','pytest','pytest.exe','cargo','cargo.exe','go','go.exe','dotnet','dotnet.exe','mvn','mvn.cmd','gradle','gradle.bat']);

let mainWindow;
let mcpRuntime = null;
let tunnelProcess = null;
let tunnel = { status: 'stopped', publicBaseUrl: '', error: '' };

function dataFile() { return path.join(app.getPath('userData'), 'personal-chatcode.json'); }
function defaultState() { return { projects: [], connection: { token: '', port: PORT } }; }

function normalizeState(raw) {
  const base = defaultState();
  const state = { ...base, ...(raw || {}) };
  state.projects = Array.isArray(state.projects) ? state.projects.map(p => ({
    ...p,
    permissions: {
      write: !!p.permissions?.write,
      manageFiles: !!p.permissions?.manageFiles,
      tasks: !!p.permissions?.tasks,
      gitWrite: !!p.permissions?.gitWrite
    }
  })) : [];
  state.connection = { ...base.connection, ...(state.connection || {}) };
  if (!state.connection.token) state.connection.token = crypto.randomBytes(24).toString('hex');
  state.connection.port = PORT;
  return state;
}

function readState() {
  try { return normalizeState(JSON.parse(fs.readFileSync(dataFile(), 'utf8'))); }
  catch { return normalizeState(defaultState()); }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(normalizeState(state), null, 2), 'utf8');
}

function ensureStatePersisted() {
  const state = readState();
  writeState(state);
  return state;
}

function getProject(ref) {
  const projects = readState().projects;
  const needle = String(ref || '').trim().toLowerCase();
  const project = projects.find(p => p.id === ref) || projects.find(p => String(p.name || '').toLowerCase() === needle);
  if (!project) throw new Error(`Project not found: ${ref}`);
  return project;
}

function assertInside(project, relPath) {
  const root = path.resolve(project.root);
  const target = path.resolve(root, relPath || '.');
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path escapes project boundary');
  return target;
}

function normalizeRel(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isSensitive(relPath) {
  const parts = normalizeRel(relPath).split('/').filter(Boolean);
  return parts.some(part => SENSITIVE_NAMES.has(part.toLowerCase()) || part.toLowerCase() === '.ssh' || /private.*key/i.test(part));
}

async function walkProject(project, maxFiles = 2500) {
  const files = [];
  async function walk(abs, rel) {
    if (files.length >= maxFiles) return;
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const nextRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && entry.name !== '.ssh') await walk(path.join(abs, entry.name), nextRel);
      } else if (entry.isFile() && !isSensitive(nextRel)) {
        files.push(nextRel.split(path.sep).join('/'));
      }
    }
  }
  await walk(project.root, '');
  return files;
}

async function readText(project, relPath, maxBytes = 220000) {
  const rel = normalizeRel(relPath);
  if (!rel || isSensitive(rel)) throw new Error('Sensitive or invalid file is blocked');
  const target = assertInside(project, rel);
  const stat = await fsp.stat(target);
  if (!stat.isFile()) throw new Error('Path is not a file');
  if (stat.size > maxBytes) throw new Error(`File too large (${stat.size} bytes)`);
  const ext = path.extname(target).toLowerCase();
  if (ext && !TEXT_EXTS.has(ext)) throw new Error('Binary/unsupported file type');
  return fsp.readFile(target, 'utf8');
}

async function searchFiles(project, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(w => w.length > 1).slice(0, 8);
  const files = await walkProject(project, 1800);
  const results = [];
  for (const rel of files) {
    if (results.length >= 100) break;
    const ext = path.extname(rel).toLowerCase();
    if (ext && !TEXT_EXTS.has(ext)) continue;
    let text;
    try { text = await readText(project, rel, 100000); } catch { continue; }
    const lower = text.toLowerCase();
    const relLower = rel.toLowerCase();
    let score = words.reduce((n, w) => n + (relLower.includes(w) ? 5 : 0) + (lower.includes(w) ? 2 : 0), 0);
    if (!score && !relLower.includes(q)) continue;
    const positions = words.map(w => lower.indexOf(w)).filter(i => i >= 0).sort((a,b) => a-b);
    const first = positions[0] ?? 0;
    const start = Math.max(0, first - 300);
    results.push({ path: rel, score, snippet: text.slice(start, start + 1400) });
  }
  return results.sort((a,b) => b.score - a.score).slice(0, 30);
}

function runExec(command, args, cwd, timeout = 120000) {
  return new Promise(resolve => {
    execFile(command, args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: String(stdout || ''), stderr: String(stderr || error?.message || '') });
    });
  });
}

function resolveTaskExecutable(cmd) {
  if (process.platform !== 'win32') return cmd;
  const map = { npm:'npm.cmd', npx:'npx.cmd', pnpm:'pnpm.cmd', yarn:'yarn.cmd', gradle:'gradle.bat' };
  return map[String(cmd).toLowerCase()] || cmd;
}

function parseCommandLine(input) {
  const parts = String(input || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return parts.map(s => s.replace(/^("|')|("|')$/g, ''));
}

function requirePermission(project, key, label) {
  if (!project.permissions?.[key]) throw new Error(`${label} permission is disabled for project "${project.name}"`);
}

const toolApi = {
  listProjects() {
    return readState().projects.map(p => ({ id: p.id, name: p.name, root: p.root, permissions: p.permissions }));
  },
  async listFiles(projectRef, limit = 2500) {
    return walkProject(getProject(projectRef), Math.min(Math.max(Number(limit) || 2500, 1), 5000));
  },
  async search(projectRef, query) { return searchFiles(getProject(projectRef), query); },
  async readFile(projectRef, relPath) {
    const project = getProject(projectRef);
    return { path: normalizeRel(relPath), content: await readText(project, relPath) };
  },
  async readFiles(projectRef, paths) {
    const project = getProject(projectRef);
    const out = [];
    for (const rel of (Array.isArray(paths) ? paths : []).slice(0, 12)) {
      try { out.push({ path: normalizeRel(rel), content: await readText(project, rel) }); }
      catch (error) { out.push({ path: normalizeRel(rel), error: String(error.message || error) }); }
    }
    return out;
  },
  async writeFile(projectRef, relPath, content) {
    const project = getProject(projectRef);
    requirePermission(project, 'write', 'Write');
    const rel = normalizeRel(relPath);
    if (!rel || isSensitive(rel)) throw new Error('Sensitive or invalid file is blocked');
    const target = assertInside(project, rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, String(content), 'utf8');
    return { ok: true, path: rel };
  },
  async deleteFile(projectRef, relPath) {
    const project = getProject(projectRef);
    requirePermission(project, 'manageFiles', 'Create/delete/rename');
    const rel = normalizeRel(relPath);
    if (!rel || isSensitive(rel)) throw new Error('Sensitive or invalid file is blocked');
    const target = assertInside(project, rel);
    const stat = await fsp.stat(target);
    if (!stat.isFile()) throw new Error('Only files can be deleted');
    await fsp.unlink(target);
    return { ok: true, path: rel };
  },
  async renameFile(projectRef, fromPath, toPath) {
    const project = getProject(projectRef);
    requirePermission(project, 'manageFiles', 'Create/delete/rename');
    const fromRel = normalizeRel(fromPath);
    const toRel = normalizeRel(toPath);
    if (!fromRel || !toRel || isSensitive(fromRel) || isSensitive(toRel)) throw new Error('Sensitive or invalid file is blocked');
    const from = assertInside(project, fromRel);
    const to = assertInside(project, toRel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
    return { ok: true, from: fromRel, to: toRel };
  },
  async runTask(projectRef, commandLine) {
    const project = getProject(projectRef);
    requirePermission(project, 'tasks', 'Task');
    const parts = parseCommandLine(commandLine);
    if (!parts.length || !TASK_COMMANDS.has(parts[0].toLowerCase())) throw new Error('Command is not in the task allow-list');
    return runExec(resolveTaskExecutable(parts[0]), parts.slice(1), project.root);
  },
  async gitStatus(projectRef) {
    const project = getProject(projectRef);
    return runExec('git', ['status', '--short', '--branch'], project.root, 30000);
  },
  async gitDiff(projectRef, staged = false) {
    const project = getProject(projectRef);
    return runExec('git', staged ? ['diff', '--cached', '--', '.'] : ['diff', '--', '.'], project.root, 30000);
  },
  async gitStage(projectRef, paths) {
    const project = getProject(projectRef);
    requirePermission(project, 'gitWrite', 'Git write');
    const list = (Array.isArray(paths) ? paths : []).slice(0, 100).map(normalizeRel).filter(Boolean);
    if (!list.length) throw new Error('Pass explicit file paths to stage');
    for (const rel of list) {
      if (isSensitive(rel)) throw new Error(`Sensitive path is blocked: ${rel}`);
      assertInside(project, rel);
    }
    return runExec('git', ['add', '--', ...list], project.root, 30000);
  },
  async gitCommit(projectRef, message) {
    const project = getProject(projectRef);
    requirePermission(project, 'gitWrite', 'Git write');
    const msg = String(message || '').trim();
    if (!msg) throw new Error('Commit message is required');
    return runExec('git', ['commit', '-m', msg], project.root, 60000);
  }
};

async function ensureMcpServer() {
  if (mcpRuntime) return mcpRuntime;
  const state = ensureStatePersisted();
  const moduleUrl = pathToFileURL(path.join(__dirname, 'mcp-server.mjs')).href;
  const { startMcpHttpServer } = await import(moduleUrl);
  mcpRuntime = await startMcpHttpServer({ port: PORT, token: state.connection.token, api: toolApi });
  return mcpRuntime;
}

function connectionSnapshot() {
  return {
    status: tunnel.status,
    error: tunnel.error,
    localUrl: mcpRuntime?.localUrl || '',
    connectionUrl: tunnel.publicBaseUrl && mcpRuntime ? `${tunnel.publicBaseUrl}${mcpRuntime.route}` : ''
  };
}

function notifyConnection() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('connection:changed', connectionSnapshot());
}

async function stopTunnel() {
  if (tunnelProcess && !tunnelProcess.killed) {
    try { tunnelProcess.kill(); } catch {}
  }
  tunnelProcess = null;
  tunnel = { status: 'stopped', publicBaseUrl: '', error: '' };
  notifyConnection();
}

async function startTunnel() {
  await ensureMcpServer();
  await stopTunnel();
  tunnel = { status: 'starting', publicBaseUrl: '', error: '' };
  notifyConnection();

  const { install } = await import('cloudflared');
  const binDir = path.join(app.getPath('userData'), 'bin');
  await fsp.mkdir(binDir, { recursive: true });
  const binPath = path.join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

  if (!fs.existsSync(binPath)) {
    tunnel.status = 'installing-tunnel';
    notifyConnection();
    await install(binPath);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const proc = spawn(binPath, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    tunnelProcess = proc;

    const onData = (chunk) => {
      const match = String(chunk || '').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !settled) {
        settled = true;
        tunnel = { status: 'connected', publicBaseUrl: match[0], error: '' };
        notifyConnection();
        resolve(connectionSnapshot());
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', err => {
      tunnel = { status: 'error', publicBaseUrl: '', error: String(err.message || err) };
      notifyConnection();
      if (!settled) { settled = true; reject(err); }
    });
    proc.on('exit', code => {
      if (tunnelProcess === proc) tunnelProcess = null;
      if (tunnel.status === 'connected') {
        tunnel = { status: 'stopped', publicBaseUrl: '', error: `Tunnel exited (${code ?? 'unknown'})` };
        notifyConnection();
      } else if (!settled) {
        const err = new Error(`Tunnel exited before a public URL was created (${code ?? 'unknown'})`);
        tunnel = { status: 'error', publicBaseUrl: '', error: err.message };
        notifyConnection();
        settled = true;
        reject(err);
      }
    });

    setTimeout(() => {
      if (!settled) {
        const err = new Error('Timed out while creating the ChatGPT tunnel');
        tunnel = { status: 'error', publicBaseUrl: '', error: err.message };
        notifyConnection();
        try { proc.kill(); } catch {}
        settled = true;
        reject(err);
      }
    }, 45000);
  });
}

async function rotateConnectionToken() {
  await stopTunnel();
  if (mcpRuntime) {
    try { await mcpRuntime.close(); } catch {}
    mcpRuntime = null;
  }
  const state = readState();
  state.connection.token = crypto.randomBytes(24).toString('hex');
  writeState(state);
  await ensureMcpServer();
  return startTunnel();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420, height: 900, minWidth: 1000, minHeight: 650,
    backgroundColor: '#0b0d10',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  ensureStatePersisted();
  createWindow();
  try {
    await ensureMcpServer();
    startTunnel().catch(err => {
      tunnel = { status: 'error', publicBaseUrl: '', error: String(err.message || err) };
      notifyConnection();
    });
  } catch (err) {
    tunnel = { status: 'error', publicBaseUrl: '', error: String(err.message || err) };
    notifyConnection();
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  if (tunnelProcess && !tunnelProcess.killed) {
    try { tunnelProcess.kill(); } catch {}
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('projects:list', () => readState().projects);
ipcMain.handle('projects:add', async () => {
  const pick = await dialog.showOpenDialog(mainWindow, { properties:['openDirectory'] });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const state = readState();
  const root = path.resolve(pick.filePaths[0]);
  const existing = state.projects.find(p => path.resolve(p.root) === root);
  if (existing) return existing;
  const project = { id: crypto.randomUUID(), name: path.basename(root) || root, root, permissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false } };
  state.projects.push(project);
  writeState(state);
  return project;
});
ipcMain.handle('projects:update', (_, incoming) => {
  const state = readState();
  const i = state.projects.findIndex(p => p.id === incoming.id);
  if (i < 0) throw new Error('Project not found');
  state.projects[i] = { ...state.projects[i], name: String(incoming.name || state.projects[i].name), permissions:{ ...state.projects[i].permissions, ...(incoming.permissions || {}) } };
  writeState(state);
  return state.projects[i];
});
ipcMain.handle('files:list', async (_, id) => toolApi.listFiles(id));
ipcMain.handle('files:read', async (_, id, rel) => (await toolApi.readFile(id, rel)).content);
ipcMain.handle('files:search', async (_, id, query) => toolApi.search(id, query));
ipcMain.handle('tasks:run', async (_, id, command) => toolApi.runTask(id, command));
ipcMain.handle('git:status', async (_, id) => toolApi.gitStatus(id));
ipcMain.handle('git:diff', async (_, id) => toolApi.gitDiff(id, false));
ipcMain.handle('connection:status', () => connectionSnapshot());
ipcMain.handle('connection:start', () => startTunnel());
ipcMain.handle('connection:copy', () => {
  const url = connectionSnapshot().connectionUrl;
  if (!url) throw new Error('ChatGPT connection link is not ready');
  clipboard.writeText(url);
  return true;
});
ipcMain.handle('connection:rotate', () => rotateConnectionToken());
