const { app, BrowserWindow, dialog, ipcMain, clipboard, safeStorage, Tray, Menu, nativeImage, Notification, powerMonitor, shell } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { createSupportService, installChildProcessAudit } = require('./core/support');

const support = createSupportService(app);
installChildProcessAudit(support);

const { createStore } = require('./core/store');
const { createUsageService } = require('./core/usage');
const { createProjectService } = require('./core/projects');
const { createConnectionService } = require('./core/connection');
const { createApprovalService } = require('./core/approvals');
const { createBackupService } = require('./core/backups');
const { createSafeToolApi } = require('./core/safety-tools');
const { createUpdateService } = require('./core/updater');

const PORT = 47820;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let mcpRuntime = null;
let connection = null;
let updater = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const asset = name => path.join(__dirname, 'assets', name);
const store = createStore(app, PORT);
const recentTaskNotifications = new Map();
function send(channel, value) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value); }

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(true);
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function emitTaskNotification(project, target) {
  const state = store.read();
  if (!state.settings.activityNotifications) return { emitted:false, count:0, reason:'disabled' };
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) return { emitted:false, count:0, reason:'foreground' };
  if (!Notification.isSupported()) return { emitted:false, count:0, reason:'unsupported' };
  const key = `${String(project || '')}\n${String(target || '')}`;
  const now = Date.now(), last = recentTaskNotifications.get(key) || 0;
  if (now - last < 5000) return { emitted:false, count:0, reason:'deduped' };
  try {
    new Notification({
      title: 'Tác vụ đã hoàn tất',
      body: `${project || 'Dự án'}${target ? ` · ${target}` : ''}`,
      icon: fs.existsSync(asset('icon.png')) ? asset('icon.png') : undefined
    }).show();
    recentTaskNotifications.set(key, now);
    for (const [itemKey, at] of recentTaskNotifications) if (now - at > 30000) recentTaskNotifications.delete(itemKey);
    return { emitted:true, count:1, reason:'emitted' };
  } catch (error) {
    return { emitted:false, count:0, reason:String(error?.message || error || 'notification-error').slice(0,160) };
  }
}

function notifyActivity(entry) {
  send('activity:changed', entry);
  if (entry.category === 'task') emitTaskNotification(entry.project, entry.target);
}

const usage = createUsageService(store, { onActivity: notifyActivity, onReset: () => send('activity:reset') });
const backups = createBackupService(app, store, { onChanged: () => send('backups:changed') });
const approvals = createApprovalService(store, {
  onChanged: list => { send('approval:changed', list); updateTrayMenu(); },
  onAttention: item => send('approval:attention', item)
});
const projects = createProjectService(store, { onIndexChanged: value => send('index:changed', value), recordActivity: usage.record });
const safeTools = createSafeToolApi(projects, store, approvals, backups, {
  notifyTaskCompleted: ({ project, command }) => emitTaskNotification(project, command)
});

async function ensureMcpServer() {
  if (mcpRuntime) return mcpRuntime;
  const state = store.ensure();
  const { startMcpHttpServer } = await import(pathToFileURL(path.join(__dirname, 'mcp-server.mjs')).href);
  mcpRuntime = await startMcpHttpServer({ port: PORT, token: state.connection.token, api: safeTools });
  return mcpRuntime;
}
async function resetMcpServer() {
  if (mcpRuntime) { try { await mcpRuntime.close(); } catch {} mcpRuntime = null; }
}
function connectionChanged(value) { send('connection:changed', value); updateTrayMenu(); }
connection = createConnectionService({ app, safeStorage, store, port: PORT, ensureMcpServer, resetMcpServer, getMcpRuntime: () => mcpRuntime, onChanged: connectionChanged });
updater = createUpdateService(app, shell, store, { onChanged: value => send('update:changed', value) });

function applyLogin(enabled) {
  try {
    const options = { openAtLogin: !!enabled };
    if (process.platform === 'win32' && app.isPackaged && enabled) options.args = ['--background'];
    app.setLoginItemSettings(options);
  } catch {}
}

function saveSettings(incoming = {}) {
  const state = store.read();
  for (const key of ['closeToTray', 'launchAtLogin', 'activityNotifications', 'autoReconnect', 'backupBeforeChanges', 'autoUpdateCheck']) {
    if (typeof incoming[key] === 'boolean') state.settings[key] = incoming[key];
  }
  if (incoming.healthIntervalSec != null) state.settings.healthIntervalSec = Math.min(120, Math.max(15, Number(incoming.healthIntervalSec) || 30));
  if (incoming.approvalTimeoutSec != null) state.settings.approvalTimeoutSec = Math.min(90, Math.max(30, Number(incoming.approvalTimeoutSec) || 60));
  store.write(state);
  applyLogin(state.settings.launchAtLogin);
  connection.restartWatchdog();
  updateTrayMenu();
  return store.settings(state);
}

function updateTrayMenu() {
  if (!tray || !connection) return;
  const snap = connection.snapshot();
  const pending = approvals.list();
  const label = snap.status === 'connected' ? 'Đã kết nối ChatGPT' : snap.status === 'reconnecting' ? 'Đang tự kết nối lại' : snap.status === 'offline' ? 'Mất kết nối' : 'Chưa kết nối';
  const template = [
    { label, enabled: false },
    ...(pending.length ? [{ label: `⚠ ${pending.length} yêu cầu chờ duyệt`, click: () => { showWindow(); send('approval:attention', pending[0]); } }, { type: 'separator' }] : [{ type: 'separator' }]),
    { label: 'Mở ChatCode Cá Nhân', click: showWindow },
    { label: 'Sao chép URL MCP', enabled: !!snap.connectionUrl, click: () => snap.connectionUrl && clipboard.writeText(snap.connectionUrl) },
    { label: 'Kết nối lại ngay', click: () => connection.start().catch(() => {}) },
    { type: 'separator' },
    { label: 'Thoát hoàn toàn', click: () => { isQuitting = true; app.quit(); } }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`ChatCode Cá Nhân · ${pending.length ? `${pending.length} chờ duyệt` : label}`);
}

function createTray() {
  if (tray) return;
  const icon = fs.existsSync(asset('icon.png')) ? nativeImage.createFromPath(asset('icon.png')).resize({ width:24, height:24 }) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.on('double-click', showWindow);
  tray.on('click', () => { if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) showWindow(); });
  updateTrayMenu();
}

function createWindow(showInitially = true) {
  mainWindow = new BrowserWindow({
    width:1480, height:930, minWidth:1100, minHeight:720, show:false,
    backgroundColor:'#f5f7fa', title:'ChatCode Cá Nhân',
    icon:fs.existsSync(asset('icon.png')) ? asset('icon.png') : undefined,
    autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', event => {
    if (isQuitting) return;
    if (store.read().settings.closeToTray) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  if (showInitially) mainWindow.once('ready-to-show', () => mainWindow?.show());
}

function updateProject(incoming) {
  const state = store.read();
  const index = state.projects.findIndex(project => project.id === incoming.id);
  if (index < 0) throw new Error('Không tìm thấy dự án.');
  state.projects[index] = {
    ...state.projects[index],
    name:String(incoming.name || state.projects[index].name),
    permissions:{ ...state.projects[index].permissions, ...(incoming.permissions || {}) },
    safety:store.normalizeSafety({ ...state.projects[index].safety, ...(incoming.safety || {}) })
  };
  store.write(state);
  return state.projects[index];
}

function applyPreset(id, preset) {
  const presets = {
    readonly:{ write:false, manageFiles:false, tasks:false, gitWrite:false },
    development:{ write:true, manageFiles:true, tasks:true, gitWrite:false },
    full:{ write:true, manageFiles:true, tasks:true, gitWrite:true }
  };
  const state = store.read();
  const index = state.projects.findIndex(project => project.id === id);
  if (index < 0) throw new Error('Không tìm thấy dự án.');
  if (!presets[preset]) throw new Error('Preset không hợp lệ.');
  state.projects[index].permissions = presets[preset];
  store.write(state);
  return state.projects[index];
}

function saveSafety(id, incoming = {}) {
  const state = store.read();
  const index = state.projects.findIndex(project => project.id === id);
  if (index < 0) throw new Error('Không tìm thấy dự án.');
  state.projects[index].safety = store.normalizeSafety({ ...state.projects[index].safety, ...incoming });
  store.write(state);
  return state.projects[index];
}

async function exportConfig() {
  const state = store.read();
  const result = await dialog.showSaveDialog(mainWindow, {
    title:'Sao lưu cấu hình ChatCode',
    defaultPath:`ChatCode-Config-${new Date().toISOString().slice(0,10)}.json`,
    filters:[{ name:'ChatCode config', extensions:['json'] }]
  });
  if (result.canceled || !result.filePath) return null;
  const payload = {
    schema:'chatcode-config-v1', exportedAt:new Date().toISOString(), appVersion:app.getVersion(),
    note:'Tunnel Token và MCP secret không được xuất ra file backup.',
    connection:{ mode:state.connection.mode, domain:state.connection.domain },
    settings:store.settings(state),
    projects:state.projects.map(project => ({ id:project.id, name:project.name, root:project.root, permissions:project.permissions, safety:project.safety }))
  };
  await fsp.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { path:result.filePath, projectCount:payload.projects.length };
}

async function importConfig() {
  const pick = await dialog.showOpenDialog(mainWindow, { title:'Khôi phục cấu hình ChatCode', properties:['openFile'], filters:[{ name:'ChatCode config', extensions:['json'] }] });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const payload = JSON.parse(await fsp.readFile(pick.filePaths[0], 'utf8'));
  if (payload?.schema !== 'chatcode-config-v1' || !Array.isArray(payload.projects)) throw new Error('File backup không đúng định dạng ChatCode.');

  const current = store.read();
  const roots = new Set();
  const existingByRoot = new Map(current.projects.map(project => [path.resolve(project.root).toLowerCase(), project]));
  const importedProjects = [];
  const importedIds = new Set();
  for (const raw of payload.projects.slice(0, 200)) {
    const root = String(raw.root || '').trim();
    if (!path.isAbsolute(root)) continue;
    const resolved = path.resolve(root);
    const key = resolved.toLowerCase();
    if (roots.has(key)) continue;
    roots.add(key);
    const existing = existingByRoot.get(key);
    let id = existing?.id || (typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID());
    if (importedIds.has(id)) id = crypto.randomUUID();
    importedIds.add(id);
    importedProjects.push({
      id,
      name:String(raw.name || path.basename(resolved) || resolved),
      root:resolved,
      permissions:{ write:!!raw.permissions?.write, manageFiles:!!raw.permissions?.manageFiles, tasks:!!raw.permissions?.tasks, gitWrite:!!raw.permissions?.gitWrite },
      safety:store.normalizeSafety(raw.safety)
    });
  }

  const next = store.read();
  next.projects = importedProjects;
  if (payload.connection) {
    next.connection.mode = payload.connection.mode === 'quick' ? 'quick' : 'custom';
    if (payload.connection.domain != null) next.connection.domain = store.normalizeDomain(payload.connection.domain);
  }
  if (payload.settings && typeof payload.settings === 'object') next.settings = { ...next.settings, ...payload.settings };
  store.write(next);
  projects.shutdown();
  await projects.initialize();
  applyLogin(store.read().settings.launchAtLogin);
  connection.restartWatchdog();
  connection.start().catch(() => {});
  return { path:pick.filePaths[0], projectCount:importedProjects.length };
}

async function supportIssue() {
  const report = await support.report({ version:app.getVersion(), limit:16 });
  const note = String(report.note || '').slice(0, 3500) || '(Chưa có ghi chú)';
  const events = JSON.stringify(report.terminalEvents, null, 2).slice(0, 6500);
  const body = `## Ghi chú từ ChatCode\n\n${note}\n\n## Terminal / process events gần nhất (đã sanitize)\n\n\`\`\`json\n${events}\n\`\`\`\n\n> ChatCode không đính kèm stdout/stderr, nội dung file, MCP secret hay Tunnel Token.`;
  const url = new URL('https://github.com/LuongVanDuy/chatcode/issues/new');
  url.searchParams.set('title', `[Support v${app.getVersion()}] Ghi chú từ ChatCode`);
  url.searchParams.set('body', body);
  await shell.openExternal(url.toString());
  return true;
}

ipcMain.handle('projects:list', () => store.read().projects);
ipcMain.handle('projects:add', async () => {
  const pick = await dialog.showOpenDialog(mainWindow, { title:'Chọn thư mục dự án', properties:['openDirectory'] });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const state = store.read();
  const root = path.resolve(pick.filePaths[0]);
  const existing = state.projects.find(project => path.resolve(project.root) === root);
  if (existing) return existing;
  const project = { id:crypto.randomUUID(), name:path.basename(root) || root, root, permissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false }, safety:store.normalizeSafety({}) };
  state.projects.push(project); store.write(state); projects.watch(project); projects.reindex(project.id).catch(() => {}); return project;
});
ipcMain.handle('projects:update', (_, incoming) => updateProject(incoming));
ipcMain.handle('projects:preset', (_, id, preset) => applyPreset(id, preset));
ipcMain.handle('projects:safety', (_, id, safety) => saveSafety(id, safety));
ipcMain.handle('projects:remove', (_, id) => { const state=store.read(), before=state.projects.length; state.projects=state.projects.filter(project=>project.id!==id); if(state.projects.length===before)throw new Error('Không tìm thấy dự án.'); store.write(state); projects.cleanup(id); return true; });
ipcMain.handle('projects:index-status', (_, id) => projects.status(id));
ipcMain.handle('projects:reindex', (_, id) => projects.reindex(id));

ipcMain.handle('files:list', (_, id) => projects.toolApi.listFiles(id));
ipcMain.handle('files:read', async (_, id, rel) => (await projects.toolApi.readFile(id, rel)).content);
ipcMain.handle('files:search', (_, id, query) => projects.toolApi.search(id, query));
ipcMain.handle('tasks:run', (_, id, command) => projects.toolApi.runTask(id, command));
ipcMain.handle('git:status', (_, id) => projects.toolApi.gitStatusExplicit ? projects.toolApi.gitStatusExplicit(id) : projects.toolApi.gitStatus(id));
ipcMain.handle('git:diff', (_, id) => projects.toolApi.gitDiffExplicit ? projects.toolApi.gitDiffExplicit(id, false) : projects.toolApi.gitDiff(id, false));

ipcMain.handle('approval:list', () => approvals.list());
ipcMain.handle('approval:respond', (_, id, decision) => approvals.respond(id, decision));
ipcMain.handle('approval:clear-session', () => approvals.clearSession());
ipcMain.handle('backups:list', (_, projectId) => backups.list(projectId || ''));
ipcMain.handle('backups:restore', async (_, id) => { const result=await backups.restore(id, projects.secureResolve); projects.reindex(result.projectId).catch(()=>{}); return result; });
ipcMain.handle('backups:remove', (_, id) => backups.remove(id));
ipcMain.handle('backups:clear', (_, projectId) => backups.clear(projectId || ''));
ipcMain.handle('config:export', () => exportConfig());
ipcMain.handle('config:import', () => importConfig());

ipcMain.handle('connection:status', () => connection.snapshot());
ipcMain.handle('connection:config', () => store.connectionConfig());
ipcMain.handle('connection:save-config', (_, config) => connection.saveConfig(config));
ipcMain.handle('connection:clear-token', () => connection.clearToken());
ipcMain.handle('connection:start', () => connection.start());
ipcMain.handle('connection:stop', () => connection.stop({ intentional:true }));
ipcMain.handle('connection:diagnose', () => connection.diagnose());
ipcMain.handle('connection:copy', () => { const url=connection.snapshot().connectionUrl; if(!url)throw new Error('URL MCP chưa sẵn sàng.'); clipboard.writeText(url); return true; });
ipcMain.handle('connection:rotate', async () => { await connection.rotate(); const state=store.read(); state.connection.tokenRotatedAt=new Date().toISOString(); store.write(state); return connection.snapshot(); });
ipcMain.handle('connection:copy-diagnostic', async () => { const diagnostic=await connection.diagnose(); clipboard.writeText(connection.report(diagnostic)); return true; });

ipcMain.handle('support:note-get', () => support.getNote());
ipcMain.handle('support:note-save', (_, text) => support.saveNote(text));
ipcMain.handle('support:events', (_, limit) => support.listEvents(limit));
ipcMain.handle('support:mark-terminal', (_, note) => support.markTerminalFlash(note));
ipcMain.handle('support:open-folder', async () => { await support.listEvents(1); const error=await shell.openPath(support.root()); if(error)throw new Error(error); return true; });
ipcMain.handle('support:copy-report', async () => { const report=await support.report({ version:app.getVersion(), limit:120 }); clipboard.writeText(JSON.stringify(report, null, 2)); return true; });
ipcMain.handle('support:github-issue', () => supportIssue());

ipcMain.handle('usage:snapshot', (_, days) => usage.snapshot(days));
ipcMain.handle('usage:clear', () => usage.clear());
ipcMain.handle('settings:get', () => store.settings());
ipcMain.handle('settings:update', (_, settings) => saveSettings(settings));
ipcMain.handle('update:status', () => updater.snapshot());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:download', () => updater.download());
ipcMain.handle('update:install', () => updater.install());
ipcMain.handle('app:info', () => ({ version:app.getVersion(), platform:process.platform, port:PORT, packaged:app.isPackaged, updateSource:'GitHub Releases' }));
ipcMain.handle('app:hide', () => { mainWindow?.hide(); return true; });

if (gotLock) {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.personal.chatcode');
    Menu.setApplicationMenu(null);
    const state = store.ensure();
    applyLogin(state.settings.launchAtLogin);
    createTray();
    createWindow(!process.argv.includes('--background'));
    await projects.initialize();
    try { await ensureMcpServer(); connection.start({ fromWatchdog:true }).catch(() => {}); }
    catch (error) { connectionChanged({ ...connection.snapshot(), status:'local-error', error:String(error.message || error) }); }
    connection.restartWatchdog();
    updater.autoCheck();
    powerMonitor.on('resume', () => connection.resume());
    app.on('activate', showWindow);
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  approvals.shutdown();
  projects.shutdown();
  connection.shutdown();
  resetMcpServer().catch(() => {});
});
app.on('window-all-closed', () => {
  const settings = store.read().settings;
  if (!settings.closeToTray || (process.platform === 'darwin' && !tray)) app.quit();
});
