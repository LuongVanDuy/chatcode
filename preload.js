const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('personalCode', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: () => ipcRenderer.invoke('projects:add'),
  updateProject: project => ipcRenderer.invoke('projects:update', project),
  applyPermissionPreset: (id, preset) => ipcRenderer.invoke('projects:preset', id, preset),
  updateSafety: (id, safety) => ipcRenderer.invoke('projects:safety', id, safety),
  removeProject: id => ipcRenderer.invoke('projects:remove', id),
  projectIndexStatus: id => ipcRenderer.invoke('projects:index-status', id),
  reindexProject: id => ipcRenderer.invoke('projects:reindex', id),

  listFiles: id => ipcRenderer.invoke('files:list', id),
  readFile: (id, rel) => ipcRenderer.invoke('files:read', id, rel),
  search: (id, query) => ipcRenderer.invoke('files:search', id, query),
  runTask: (id, command) => ipcRenderer.invoke('tasks:run', id, command),
  gitStatus: id => ipcRenderer.invoke('git:status', id),
  gitDiff: id => ipcRenderer.invoke('git:diff', id),

  listApprovals: () => ipcRenderer.invoke('approval:list'),
  respondApproval: (id, decision) => ipcRenderer.invoke('approval:respond', id, decision),
  clearApprovalSession: () => ipcRenderer.invoke('approval:clear-session'),
  listBackups: projectId => ipcRenderer.invoke('backups:list', projectId),
  restoreBackup: id => ipcRenderer.invoke('backups:restore', id),
  removeBackup: id => ipcRenderer.invoke('backups:remove', id),
  clearBackups: projectId => ipcRenderer.invoke('backups:clear', projectId),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: () => ipcRenderer.invoke('config:import'),

  connectionStatus: () => ipcRenderer.invoke('connection:status'),
  connectionConfig: () => ipcRenderer.invoke('connection:config'),
  saveConnectionConfig: config => ipcRenderer.invoke('connection:save-config', config),
  clearTunnelToken: () => ipcRenderer.invoke('connection:clear-token'),
  startConnection: () => ipcRenderer.invoke('connection:start'),
  stopConnection: () => ipcRenderer.invoke('connection:stop'),
  diagnoseConnection: () => ipcRenderer.invoke('connection:diagnose'),
  copyConnection: () => ipcRenderer.invoke('connection:copy'),
  rotateConnection: () => ipcRenderer.invoke('connection:rotate'),
  copyDiagnostic: () => ipcRenderer.invoke('connection:copy-diagnostic'),

  supportNote: () => ipcRenderer.invoke('support:note-get'),
  saveSupportNote: text => ipcRenderer.invoke('support:note-save', text),
  supportEvents: limit => ipcRenderer.invoke('support:events', limit),
  markTerminalFlash: note => ipcRenderer.invoke('support:mark-terminal', note),
  openSupportFolder: () => ipcRenderer.invoke('support:open-folder'),
  copySupportReport: () => ipcRenderer.invoke('support:copy-report'),
  openSupportGitHubIssue: () => ipcRenderer.invoke('support:github-issue'),

  usageSnapshot: days => ipcRenderer.invoke('usage:snapshot', days),
  clearUsage: () => ipcRenderer.invoke('usage:clear'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: settings => ipcRenderer.invoke('settings:update', settings),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  hideApp: () => ipcRenderer.invoke('app:hide'),

  onConnectionChanged: callback => ipcRenderer.on('connection:changed', (_, value) => callback(value)),
  onActivityChanged: callback => ipcRenderer.on('activity:changed', (_, value) => callback(value)),
  onActivityReset: callback => ipcRenderer.on('activity:reset', () => callback()),
  onIndexChanged: callback => ipcRenderer.on('index:changed', (_, value) => callback(value)),
  onApprovalChanged: callback => ipcRenderer.on('approval:changed', (_, value) => callback(value)),
  onApprovalAttention: callback => ipcRenderer.on('approval:attention', (_, value) => callback(value)),
  onBackupsChanged: callback => ipcRenderer.on('backups:changed', () => callback()),
  onUpdateChanged: callback => ipcRenderer.on('update:changed', (_, value) => callback(value))
});

window.addEventListener('DOMContentLoaded', async () => {
  const load = (src, key) => new Promise(resolve => {
    const existing = document.querySelector(`script[data-${key}]`);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = '1';
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });

  await load('vendor/lucide.js', 'lucide-vendor');
  await load('v07-runtime.js', 'v07-runtime');
  await load('v08-runtime.js', 'v08-runtime');
  await load('v081-runtime.js', 'v081-runtime');
  await load('v09-runtime.js', 'v09-runtime');
  await load('v091-runtime.js', 'v091-runtime');
});
