const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'target', '.next', '.cache', '.idea', '.vscode']);
const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'credentials.json']);
const TEXT_EXTS = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.json','.md','.txt','.css','.scss','.html','.htm','.py','.go','.rs','.java','.kt','.kts','.c','.h','.cpp','.hpp','.cs','.php','.rb','.swift','.sql','.sh','.ps1','.yaml','.yml','.toml','.ini','.xml','.vue','.svelte']);
const TASK_COMMANDS = new Set(['npm','npm.cmd','pnpm','pnpm.cmd','yarn','yarn.cmd','bun','bun.exe','npx','npx.cmd','node','node.exe','python','python.exe','python3','pytest','pytest.exe','cargo','cargo.exe','go','go.exe','dotnet','dotnet.exe','mvn','mvn.cmd','gradle','gradle.bat']);

let mainWindow;

function dataFile() { return path.join(app.getPath('userData'), 'personal-chatcode.json'); }
function defaultState() { return { projects: [], ai: { baseUrl: 'https://api.openai.com/v1', model: '', apiKeyEnc: '' } }; }
function readState() {
  try { return { ...defaultState(), ...JSON.parse(fs.readFileSync(dataFile(), 'utf8')) }; }
  catch { return defaultState(); }
}
function writeState(state) {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(state, null, 2), 'utf8');
}
function publicState(state) {
  return { ...state, ai: { baseUrl: state.ai?.baseUrl || '', model: state.ai?.model || '', hasApiKey: !!state.ai?.apiKeyEnc } };
}
function getProject(id) {
  const project = readState().projects.find(p => p.id === id);
  if (!project) throw new Error('Project not found');
  return project;
}
function assertInside(project, relPath) {
  const root = path.resolve(project.root);
  const target = path.resolve(root, relPath || '.');
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path escapes project boundary');
  return target;
}
function isSensitive(relPath) {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  return parts.some(part => SENSITIVE_NAMES.has(part) || part === '.ssh' || /private.*key/i.test(part));
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
  const target = assertInside(project, relPath);
  if (isSensitive(relPath)) throw new Error('Sensitive file is blocked');
  const stat = await fsp.stat(target);
  if (stat.size > maxBytes) throw new Error(`File too large (${stat.size} bytes)`);
  const ext = path.extname(target).toLowerCase();
  if (ext && !TEXT_EXTS.has(ext)) throw new Error('Binary/unsupported file type');
  return fsp.readFile(target, 'utf8');
}
function runExec(command, args, cwd, timeout = 120000) {
  return new Promise(resolve => {
    execFile(command, args, { cwd, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: String(stdout || ''), stderr: String(stderr || error?.message || '') });
    });
  });
}
function resolveTaskExecutable(cmd) {
  if (process.platform !== 'win32') return cmd;
  const map = { npm:'npm.cmd', npx:'npx.cmd', pnpm:'pnpm.cmd', yarn:'yarn.cmd', gradle:'gradle.bat' };
  return map[cmd.toLowerCase()] || cmd;
}
function parseCommandLine(input) {
  const parts = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return parts.map(s => s.replace(/^("|')|("|')$/g, ''));
}
async function searchFiles(project, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(w => w.length > 1).slice(0, 8);
  const files = await walkProject(project, 1600);
  const results = [];
  for (const rel of files) {
    if (results.length >= 80) break;
    const ext = path.extname(rel).toLowerCase();
    if (ext && !TEXT_EXTS.has(ext)) continue;
    let text;
    try { text = await readText(project, rel, 90000); } catch { continue; }
    const lower = text.toLowerCase();
    let score = words.reduce((n, w) => n + (rel.toLowerCase().includes(w) ? 5 : 0) + (lower.includes(w) ? 2 : 0), 0);
    if (!score && !rel.toLowerCase().includes(q)) continue;
    const first = words.map(w => lower.indexOf(w)).filter(i => i >= 0).sort((a,b)=>a-b)[0] ?? 0;
    const start = Math.max(0, first - 350);
    results.push({ path: rel, score, snippet: text.slice(start, start + 1200) });
  }
  return results.sort((a,b) => b.score - a.score).slice(0, 24);
}
function decryptKey(enc) {
  if (!enc) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS storage is unavailable');
  return safeStorage.decryptString(Buffer.from(enc, 'base64'));
}

async function callAI(messages, tools) {
  const state = readState();
  const { baseUrl, model, apiKeyEnc } = state.ai || {};
  if (!baseUrl || !model || !apiKeyEnc) throw new Error('Configure AI base URL, model, and API key in Settings first');
  const apiKey = decryptKey(apiKeyEnc);
  const endpoint = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = { model, messages, temperature: 0.2 };
  if (tools) { body.tools = tools; body.tool_choice = 'auto'; }
  const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type':'application/json', 'authorization':`Bearer ${apiKey}` }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${text.slice(0, 600)}`);
  const json = JSON.parse(text);
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error('AI response had no message');
  return msg;
}

const TOOLS = [
  { type:'function', function:{ name:'search_files', description:'Search project text files for relevant code/context.', parameters:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } } },
  { type:'function', function:{ name:'read_file', description:'Read a UTF-8 text file in the current project.', parameters:{ type:'object', properties:{ path:{type:'string'} }, required:['path'] } } },
  { type:'function', function:{ name:'write_file', description:'Replace/create a text file. Requires project write permission.', parameters:{ type:'object', properties:{ path:{type:'string'}, content:{type:'string'} }, required:['path','content'] } } },
  { type:'function', function:{ name:'run_task', description:'Run an allow-listed development command. Requires task permission.', parameters:{ type:'object', properties:{ command:{type:'string'} }, required:['command'] } } },
  { type:'function', function:{ name:'git_status', description:'Read git status for current project.', parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{ name:'git_diff', description:'Read current git diff for current project.', parameters:{ type:'object', properties:{} } } }
];

async function executeTool(project, name, args) {
  if (name === 'search_files') return searchFiles(project, args.query);
  if (name === 'read_file') return { path: args.path, content: await readText(project, args.path) };
  if (name === 'write_file') {
    if (!project.permissions?.write) throw new Error('Write permission is disabled');
    if (isSensitive(args.path)) throw new Error('Sensitive file is blocked');
    const target = assertInside(project, args.path);
    await fsp.mkdir(path.dirname(target), { recursive:true });
    await fsp.writeFile(target, String(args.content), 'utf8');
    return { ok:true, path:args.path };
  }
  if (name === 'run_task') {
    if (!project.permissions?.tasks) throw new Error('Task permission is disabled');
    const parts = parseCommandLine(args.command);
    if (!parts.length || !TASK_COMMANDS.has(parts[0].toLowerCase())) throw new Error('Command is not in the task allow-list');
    return runExec(resolveTaskExecutable(parts[0]), parts.slice(1), project.root);
  }
  if (name === 'git_status') return runExec('git', ['status','--short','--branch'], project.root, 30000);
  if (name === 'git_diff') return runExec('git', ['diff','--','.'], project.root, 30000);
  throw new Error(`Unknown tool: ${name}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420, height: 900, minWidth: 1000, minHeight: 650,
    backgroundColor: '#0b0d10',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('projects:list', () => publicState(readState()).projects);
ipcMain.handle('projects:add', async () => {
  const pick = await dialog.showOpenDialog(mainWindow, { properties:['openDirectory'] });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const state = readState();
  const root = path.resolve(pick.filePaths[0]);
  let existing = state.projects.find(p => path.resolve(p.root) === root);
  if (existing) return existing;
  const project = { id: crypto.randomUUID(), name: path.basename(root) || root, root, permissions:{ write:false, tasks:false, gitWrite:false } };
  state.projects.push(project); writeState(state); return project;
});
ipcMain.handle('projects:update', (_, incoming) => {
  const state = readState();
  const i = state.projects.findIndex(p => p.id === incoming.id);
  if (i < 0) throw new Error('Project not found');
  state.projects[i] = { ...state.projects[i], name: String(incoming.name || state.projects[i].name), permissions:{ ...state.projects[i].permissions, ...incoming.permissions } };
  writeState(state); return state.projects[i];
});
ipcMain.handle('files:list', async (_, id) => walkProject(getProject(id)));
ipcMain.handle('files:read', async (_, id, rel) => readText(getProject(id), rel));
ipcMain.handle('files:search', async (_, id, query) => searchFiles(getProject(id), query));
ipcMain.handle('files:write', async (_, id, rel, content) => executeTool(getProject(id), 'write_file', { path:rel, content }));
ipcMain.handle('tasks:run', async (_, id, command) => executeTool(getProject(id), 'run_task', { command }));
ipcMain.handle('git:status', async (_, id) => executeTool(getProject(id), 'git_status', {}));
ipcMain.handle('git:diff', async (_, id) => executeTool(getProject(id), 'git_diff', {}));
ipcMain.handle('settings:get', () => publicState(readState()).ai);
ipcMain.handle('settings:ai', (_, incoming) => {
  const state = readState();
  state.ai = { ...state.ai, baseUrl:String(incoming.baseUrl || '').trim(), model:String(incoming.model || '').trim() };
  if (incoming.apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS storage is unavailable');
    state.ai.apiKeyEnc = safeStorage.encryptString(String(incoming.apiKey)).toString('base64');
  }
  writeState(state); return publicState(state).ai;
});
ipcMain.handle('agent:run', async (_, projectId, message, history = []) => {
  const project = getProject(projectId);
  const system = `You are a personal coding agent working only inside project "${project.name}" at the boundary granted by the app. Read/search before guessing. Never request or expose secrets. Write files only when the user asked for changes and write permission is enabled. Run tests only when useful and task permission is enabled. Keep final answers concise and report files changed and verification performed.`;
  const messages = [{ role:'system', content:system }, ...history.slice(-12), { role:'user', content:String(message) }];
  const events = [];
  for (let round = 0; round < 8; round++) {
    const reply = await callAI(messages, TOOLS);
    messages.push(reply);
    if (!reply.tool_calls?.length) return { content: reply.content || '', events };
    for (const tc of reply.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      try {
        const result = await executeTool(project, tc.function.name, args);
        events.push({ tool:tc.function.name, ok:true, summary: tc.function.name === 'write_file' ? `wrote ${args.path}` : tc.function.name });
        messages.push({ role:'tool', tool_call_id:tc.id, content: JSON.stringify(result).slice(0, 30000) });
      } catch (err) {
        events.push({ tool:tc.function.name, ok:false, summary:String(err.message || err) });
        messages.push({ role:'tool', tool_call_id:tc.id, content: JSON.stringify({ error:String(err.message || err) }) });
      }
    }
  }
  return { content:'Stopped after the tool-loop safety limit.', events };
});
