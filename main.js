const { app, BrowserWindow, dialog, ipcMain, clipboard, safeStorage, Tray, Menu, nativeImage } = require('electron');
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
const TRAY_ICON_DATA = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAArklEQVR4nO2WuQ2AMAxFDaKHDmaA/UdhB0o2gAoJIccXQT8ScR3bT99H3PTjfBDQWmTyClAEQGd9uG+rO/gwLeqbRpuCSGIPiFiCHMm1OEkFnk4WOSMxTE0YSW71YwHu5NHknD9XCvgYVgA4gHkTEvn2grV54QrAAVwleLsTOIMrUAHKBNA+EI9pH5tJgSiExU88yXJdRETpERYVyDX3Uhz1KL0MdhV/bWWO4a8ATnVYNW4vbwHSAAAAAElFTkSuQmCC';

let mainWindow;
let tray;
let isQuitting = false;
let mcpRuntime = null;
let tunnelProcess = null;
let tunnel = { status: 'stopped', publicBaseUrl: '', error: '', mode: 'custom' };

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

function dataFile() { return path.join(app.getPath('userData'), 'personal-chatcode.json'); }

function defaultState() {
  return {
    projects: [],
    connection: {
      token: '',
      port: PORT,
      mode: 'custom',
      domain: '',
      tunnelTokenEnc: ''
    },
    settings: {
      closeToTray: true,
      launchAtLogin: false
    }
  };
}

function normalizeDomain(value) {
  let text = String(value || '').trim().toLowerCase();
  text = text.replace(/^https?:\/\//, '').split('/')[0].replace(/\.$/, '');
  if (!text) return '';
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text)) {
    throw new Error('Domain không hợp lệ. Ví dụ: mcp.example.com');
  }
  return text;
}

function extractTunnelToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const fromFlag = text.match(/--token\s+([A-Za-z0-9._=\-]+)/i)?.[1];
  const fromInstall = text.match(/service\s+install\s+([A-Za-z0-9._=\-]+)/i)?.[1];
  return (fromFlag || fromInstall || text).trim();
}

function encryptSecret(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows Secure Storage chưa sẵn sàng để lưu Tunnel Token.');
  return safeStorage.encryptString(String(value)).toString('base64');
}

function decryptSecret(value) {
  if (!value) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows Secure Storage chưa sẵn sàng để đọc Tunnel Token.');
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

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
  state.connection.mode = state.connection.mode === 'quick' ? 'quick' : 'custom';
  try { state.connection.domain = normalizeDomain(state.connection.domain); } catch { state.connection.domain = ''; }
  state.connection.tunnelTokenEnc = String(state.connection.tunnelTokenEnc || '');
  state.settings = {
    closeToTray: state.settings?.closeToTray !== false,
    launchAtLogin: !!state.settings?.launchAtLogin
  };
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

function publicConnectionConfig(state = readState()) {
  return {
    mode: state.connection.mode,
    domain: state.connection.domain,
    hasTunnelToken: !!state.connection.tunnelTokenEnc,
    localPort: PORT
  };
}

function publicAppSettings(state = readState()) {
  return {
    closeToTray: !!state.settings.closeToTray,
    launchAtLogin: !!state.settings.launchAtLogin
  };
}

function applyLoginSettings(enabled) {
  try {
    const options = { openAtLogin: !!enabled };
    if (process.platform === 'win32' && app.isPackaged && enabled) options.args = ['--background'];
    app.setLoginItemSettings(options);
  } catch {}
}

function saveAppSettings(incoming = {}) {
  const state = readState();
  if (typeof incoming.closeToTray === 'boolean') state.settings.closeToTray = incoming.closeToTray;
  if (typeof incoming.launchAtLogin === 'boolean') state.settings.launchAtLogin = incoming.launchAtLogin;
  writeState(state);
  applyLoginSettings(state.settings.launchAtLogin);
  updateTrayMenu();
  return publicAppSettings(state);
}

function getProject(ref) {
  const projects = readState().projects;
  const needle = String(ref || '').trim().toLowerCase();
  const project = projects.find(p => p.id === ref) || projects.find(p => String(p.name || '').toLowerCase() === needle);
  if (!project) throw new Error(`Không tìm thấy dự án: ${ref}`);
  return project;
}

function assertInside(project, relPath) {
  const root = path.resolve(project.root);
  const target = path.resolve(root, relPath || '.');
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Đường dẫn nằm ngoài phạm vi dự án.');
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
  if (!rel || isSensitive(rel)) throw new Error('File nhạy cảm hoặc đường dẫn không hợp lệ đã bị chặn.');
  const target = assertInside(project, rel);
  const stat = await fsp.stat(target);
  if (!stat.isFile()) throw new Error('Đường dẫn không phải file.');
  if (stat.size > maxBytes) throw new Error(`File quá lớn (${stat.size} bytes).`);
  const ext = path.extname(target).toLowerCase();
  if (ext && !TEXT_EXTS.has(ext)) throw new Error('Định dạng binary/không hỗ trợ.');
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
    const score = words.reduce((n, w) => n + (relLower.includes(w) ? 5 : 0) + (lower.includes(w) ? 2 : 0), 0);
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
  if (!project.permissions?.[key]) throw new Error(`Quyền ${label} đang tắt cho dự án "${project.name}".`);
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
    requirePermission(project, 'write', 'ghi file');
    const rel = normalizeRel(relPath);
    if (!rel || isSensitive(rel)) throw new Error('File nhạy cảm hoặc đường dẫn không hợp lệ đã bị chặn.');
    const target = assertInside(project, rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, String(content), 'utf8');
    return { ok: true, path: rel };
  },
  async deleteFile(projectRef, relPath) {
    const project = getProject(projectRef);
    requirePermission(project, 'manageFiles', 'xóa/đổi tên file');
    const rel = normalizeRel(relPath);
    if (!rel || isSensitive(rel)) throw new Error('File nhạy cảm hoặc đường dẫn không hợp lệ đã bị chặn.');
    const target = assertInside(project, rel);
    const stat = await fsp.stat(target);
    if (!stat.isFile()) throw new Error('Chỉ cho phép xóa file.');
    await fsp.unlink(target);
    return { ok: true, path: rel };
  },
  async renameFile(projectRef, fromPath, toPath) {
    const project = getProject(projectRef);
    requirePermission(project, 'manageFiles', 'xóa/đổi tên file');
    const fromRel = normalizeRel(fromPath);
    const toRel = normalizeRel(toPath);
    if (!fromRel || !toRel || isSensitive(fromRel) || isSensitive(toRel)) throw new Error('File nhạy cảm hoặc đường dẫn không hợp lệ đã bị chặn.');
    const from = assertInside(project, fromRel);
    const to = assertInside(project, toRel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
    return { ok: true, from: fromRel, to: toRel };
  },
  async runTask(projectRef, commandLine) {
    const project = getProject(projectRef);
    requirePermission(project, 'tasks', 'chạy tác vụ');
    const parts = parseCommandLine(commandLine);
    if (!parts.length || !TASK_COMMANDS.has(parts[0].toLowerCase())) throw new Error('Lệnh này không nằm trong danh sách tác vụ an toàn.');
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
    requirePermission(project, 'gitWrite', 'ghi Git');
    const list = (Array.isArray(paths) ? paths : []).slice(0, 100).map(normalizeRel).filter(Boolean);
    if (!list.length) throw new Error('Hãy chỉ định file cần stage.');
    for (const rel of list) {
      if (isSensitive(rel)) throw new Error(`Đường dẫn nhạy cảm đã bị chặn: ${rel}`);
      assertInside(project, rel);
    }
    return runExec('git', ['add', '--', ...list], project.root, 30000);
  },
  async gitCommit(projectRef, message) {
    const project = getProject(projectRef);
    requirePermission(project, 'gitWrite', 'ghi Git');
    const msg = String(message || '').trim();
    if (!msg) throw new Error('Cần có nội dung commit.');
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
  const config = publicConnectionConfig();
  return {
    ...config,
    status: tunnel.status,
    error: tunnel.error,
    localUrl: mcpRuntime?.localUrl || '',
    publicBaseUrl: tunnel.publicBaseUrl || '',
    connectionUrl: tunnel.publicBaseUrl && mcpRuntime ? `${tunnel.publicBaseUrl}${mcpRuntime.route}` : ''
  };
}

function updateTrayMenu() {
  if (!tray) return;
  const snap = connectionSnapshot();
  const statusLabel = snap.status === 'connected' ? 'Đã kết nối ChatGPT' : snap.status === 'error' ? 'Kết nối đang lỗi' : 'Chưa kết nối';
  const menu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: 'Mở ChatCode Cá Nhân', click: showMainWindow },
    {
      label: 'Sao chép URL MCP',
      enabled: !!snap.connectionUrl,
      click: () => { if (snap.connectionUrl) clipboard.writeText(snap.connectionUrl); }
    },
    {
      label: 'Kết nối lại',
      click: () => startTunnel().catch(() => {})
    },
    { type: 'separator' },
    {
      label: 'Thoát hoàn toàn',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`ChatCode Cá Nhân · ${statusLabel}`);
}

function notifyConnection() {
  const snapshot = connectionSnapshot();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('connection:changed', snapshot);
  updateTrayMenu();
}

async function stopTunnel() {
  if (tunnelProcess && !tunnelProcess.killed) {
    try { tunnelProcess.kill(); } catch {}
  }
  tunnelProcess = null;
  tunnel = { status: 'stopped', publicBaseUrl: '', error: '', mode: readState().connection.mode };
  notifyConnection();
}

async function ensureCloudflared() {
  const { install } = await import('cloudflared');
  const binDir = path.join(app.getPath('userData'), 'bin');
  await fsp.mkdir(binDir, { recursive: true });
  const binPath = path.join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (!fs.existsSync(binPath)) {
    tunnel.status = 'installing-tunnel';
    notifyConnection();
    await install(binPath);
  }
  return binPath;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForPublicHealth(baseUrl, proc, timeoutMs = 30000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    if (proc.exitCode !== null) throw new Error(`Cloudflare Tunnel đã dừng (mã ${proc.exitCode}).`);
    try {
      const response = await fetch(`${baseUrl}/health?t=${Date.now()}`, {
        headers: { 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(4000)
      });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.ok && body?.service === 'personal-chatcode') return true;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await sleep(1000);
  }
  throw new Error(`Không thể truy cập ${baseUrl}/health. Kiểm tra domain đã trỏ đúng Published Application tới http://localhost:${PORT}. ${lastError ? `Chi tiết: ${lastError}` : ''}`);
}

function bindTunnelLifecycle(proc, mode) {
  tunnelProcess = proc;
  proc.on('error', err => {
    tunnel = { status: 'error', publicBaseUrl: '', error: String(err.message || err), mode };
    notifyConnection();
  });
  proc.on('exit', code => {
    if (tunnelProcess === proc) tunnelProcess = null;
    if (tunnel.status === 'connected') {
      tunnel = { status: 'stopped', publicBaseUrl: '', error: `Cloudflare Tunnel đã dừng (${code ?? 'không rõ mã'}).`, mode };
      notifyConnection();
    }
  });
}

async function startQuickTunnel(binPath) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const proc = spawn(binPath, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    bindTunnelLifecycle(proc, 'quick');

    const onData = async (chunk) => {
      const match = String(chunk || '').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!match || settled) return;
      settled = true;
      try {
        tunnel = { status: 'verifying', publicBaseUrl: match[0], error: '', mode: 'quick' };
        notifyConnection();
        await waitForPublicHealth(match[0], proc, 25000);
        tunnel = { status: 'connected', publicBaseUrl: match[0], error: '', mode: 'quick' };
        notifyConnection();
        resolve(connectionSnapshot());
      } catch (error) {
        try { proc.kill(); } catch {}
        tunnel = { status: 'error', publicBaseUrl: '', error: String(error.message || error), mode: 'quick' };
        notifyConnection();
        reject(error);
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', code => {
      if (!settled) {
        settled = true;
        const error = new Error(`Quick Tunnel dừng trước khi tạo URL (${code ?? 'không rõ mã'}).`);
        tunnel = { status: 'error', publicBaseUrl: '', error: error.message, mode: 'quick' };
        notifyConnection();
        reject(error);
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        try { proc.kill(); } catch {}
        const error = new Error('Hết thời gian chờ Cloudflare tạo Quick Tunnel.');
        tunnel = { status: 'error', publicBaseUrl: '', error: error.message, mode: 'quick' };
        notifyConnection();
        reject(error);
      }
    }, 45000);
  });
}

async function startCustomTunnel(binPath, state) {
  const domain = normalizeDomain(state.connection.domain);
  const token = decryptSecret(state.connection.tunnelTokenEnc);
  if (!domain || !token) throw new Error('Hãy nhập Domain và Tunnel Token trước khi kết nối.');

  const baseUrl = `https://${domain}`;
  const proc = spawn(binPath, ['tunnel', 'run', '--token', token], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  bindTunnelLifecycle(proc, 'custom');
  tunnel = { status: 'verifying', publicBaseUrl: baseUrl, error: '', mode: 'custom' };
  notifyConnection();

  let stderr = '';
  proc.stderr.on('data', chunk => { stderr = (stderr + String(chunk || '')).slice(-5000); });

  try {
    await waitForPublicHealth(baseUrl, proc, 35000);
    tunnel = { status: 'connected', publicBaseUrl: baseUrl, error: '', mode: 'custom' };
    notifyConnection();
    return connectionSnapshot();
  } catch (error) {
    try { proc.kill(); } catch {}
    const detail = stderr.match(/ERR[^\n]*/i)?.[0] || '';
    const finalError = new Error(`${error.message}${detail ? ` Cloudflared: ${detail}` : ''}`);
    tunnel = { status: 'error', publicBaseUrl: '', error: finalError.message, mode: 'custom' };
    notifyConnection();
    throw finalError;
  }
}

async function startTunnel() {
  await ensureMcpServer();
  await stopTunnel();
  const state = ensureStatePersisted();
  const mode = state.connection.mode;

  if (mode === 'custom' && (!state.connection.domain || !state.connection.tunnelTokenEnc)) {
    tunnel = { status: 'config-required', publicBaseUrl: '', error: '', mode };
    notifyConnection();
    return connectionSnapshot();
  }

  tunnel = { status: 'starting', publicBaseUrl: '', error: '', mode };
  notifyConnection();
  const binPath = await ensureCloudflared();
  return mode === 'quick' ? startQuickTunnel(binPath) : startCustomTunnel(binPath, state);
}

async function saveConnectionConfig(incoming = {}) {
  await stopTunnel();
  const state = readState();
  const mode = incoming.mode === 'quick' ? 'quick' : 'custom';
  state.connection.mode = mode;

  if (mode === 'custom') {
    state.connection.domain = normalizeDomain(incoming.domain);
    const token = extractTunnelToken(incoming.tunnelToken);
    if (token) state.connection.tunnelTokenEnc = encryptSecret(token);
    if (!state.connection.domain) throw new Error('Vui lòng nhập domain Cloudflare.');
    if (!state.connection.tunnelTokenEnc) throw new Error('Vui lòng nhập Tunnel Token/Key của Cloudflare.');
  }

  writeState(state);
  return publicConnectionConfig(state);
}

async function clearTunnelToken() {
  await stopTunnel();
  const state = readState();
  state.connection.tunnelTokenEnc = '';
  writeState(state);
  tunnel = { status: 'config-required', publicBaseUrl: '', error: '', mode: state.connection.mode };
  notifyConnection();
  return publicConnectionConfig(state);
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

async function diagnoseConnection() {
  await ensureMcpServer();
  const snap = connectionSnapshot();
  const checks = [];

  async function check(name, url, options = {}) {
    const started = Date.now();
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
      const text = await response.text();
      checks.push({ name, ok: response.ok, status: response.status, ms: Date.now() - started, detail: text.slice(0, 500) });
      return { response, text };
    } catch (error) {
      checks.push({ name, ok: false, status: 0, ms: Date.now() - started, detail: String(error?.message || error) });
      return null;
    }
  }

  await check('MCP cục bộ', `http://127.0.0.1:${PORT}/health`);
  if (snap.publicBaseUrl) await check('Cloudflare HTTPS', `${snap.publicBaseUrl}/health?t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });

  if (snap.connectionUrl) {
    const initializeBody = {
      jsonrpc: '2.0',
      id: 901,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'chatcode-self-test', version: app.getVersion() }
      }
    };
    await check('MCP initialize', snap.connectionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initializeBody)
    });

    const toolsBody = { jsonrpc: '2.0', id: 902, method: 'tools/list', params: {} };
    await check('MCP tools/list', snap.connectionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(toolsBody)
    });
  }

  return { ok: checks.length > 0 && checks.every(item => item.ok), checks };
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(true);
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createTray() {
  if (tray) return tray;
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_DATA}`);
  tray = new Tray(icon);
  tray.on('double-click', showMainWindow);
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) showMainWindow();
  });
  updateTrayMenu();
  return tray;
}

function createWindow(showInitially = true) {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1060,
    minHeight: 680,
    show: false,
    backgroundColor: '#f7f8fb',
    title: 'ChatCode Cá Nhân',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', event => {
    if (isQuitting) return;
    const settings = readState().settings;
    if (settings.closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  if (showInitially) mainWindow.once('ready-to-show', () => mainWindow?.show());
}

if (gotSingleInstanceLock) {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(async () => {
    const state = ensureStatePersisted();
    applyLoginSettings(state.settings.launchAtLogin);
    createTray();
    const backgroundStart = process.argv.includes('--background');
    createWindow(!backgroundStart);
    try {
      await ensureMcpServer();
      startTunnel().catch(err => {
        tunnel = { status: 'error', publicBaseUrl: '', error: String(err.message || err), mode: readState().connection.mode };
        notifyConnection();
      });
    } catch (err) {
      tunnel = { status: 'error', publicBaseUrl: '', error: String(err.message || err), mode: readState().connection.mode };
      notifyConnection();
    }
    app.on('activate', showMainWindow);
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (tunnelProcess && !tunnelProcess.killed) {
    try { tunnelProcess.kill(); } catch {}
  }
});

app.on('window-all-closed', () => {
  const settings = readState().settings;
  if (!settings.closeToTray || (process.platform === 'darwin' && !tray)) app.quit();
});

ipcMain.handle('projects:list', () => readState().projects);
ipcMain.handle('projects:add', async () => {
  const pick = await dialog.showOpenDialog(mainWindow, { title: 'Chọn thư mục dự án', properties:['openDirectory'] });
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
  if (i < 0) throw new Error('Không tìm thấy dự án.');
  state.projects[i] = { ...state.projects[i], name: String(incoming.name || state.projects[i].name), permissions:{ ...state.projects[i].permissions, ...(incoming.permissions || {}) } };
  writeState(state);
  return state.projects[i];
});
ipcMain.handle('projects:remove', (_, id) => {
  const state = readState();
  const before = state.projects.length;
  state.projects = state.projects.filter(p => p.id !== id);
  if (state.projects.length === before) throw new Error('Không tìm thấy dự án.');
  writeState(state);
  return true;
});
ipcMain.handle('files:list', async (_, id) => toolApi.listFiles(id));
ipcMain.handle('files:read', async (_, id, rel) => (await toolApi.readFile(id, rel)).content);
ipcMain.handle('files:search', async (_, id, query) => toolApi.search(id, query));
ipcMain.handle('tasks:run', async (_, id, command) => toolApi.runTask(id, command));
ipcMain.handle('git:status', async (_, id) => toolApi.gitStatus(id));
ipcMain.handle('git:diff', async (_, id) => toolApi.gitDiff(id, false));
ipcMain.handle('connection:status', () => connectionSnapshot());
ipcMain.handle('connection:config', () => publicConnectionConfig());
ipcMain.handle('connection:save-config', (_, config) => saveConnectionConfig(config));
ipcMain.handle('connection:clear-token', () => clearTunnelToken());
ipcMain.handle('connection:start', () => startTunnel());
ipcMain.handle('connection:stop', () => stopTunnel());
ipcMain.handle('connection:diagnose', () => diagnoseConnection());
ipcMain.handle('connection:copy', () => {
  const url = connectionSnapshot().connectionUrl;
  if (!url) throw new Error('URL MCP chưa sẵn sàng. Hãy kết nối Cloudflare trước.');
  clipboard.writeText(url);
  return true;
});
ipcMain.handle('connection:rotate', () => rotateConnectionToken());
ipcMain.handle('settings:get', () => publicAppSettings());
ipcMain.handle('settings:update', (_, settings) => saveAppSettings(settings));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, port: PORT }));
ipcMain.handle('app:hide', () => { mainWindow?.hide(); return true; });
