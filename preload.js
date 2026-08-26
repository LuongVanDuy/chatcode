const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('personalCode', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: () => ipcRenderer.invoke('projects:add'),
  updateProject: (project) => ipcRenderer.invoke('projects:update', project),
  listFiles: (projectId) => ipcRenderer.invoke('files:list', projectId),
  readFile: (projectId, relPath) => ipcRenderer.invoke('files:read', projectId, relPath),
  search: (projectId, query) => ipcRenderer.invoke('files:search', projectId, query),
  runTask: (projectId, command) => ipcRenderer.invoke('tasks:run', projectId, command),
  gitStatus: (projectId) => ipcRenderer.invoke('git:status', projectId),
  gitDiff: (projectId) => ipcRenderer.invoke('git:diff', projectId),
  connectionStatus: () => ipcRenderer.invoke('connection:status'),
  connectionConfig: () => ipcRenderer.invoke('connection:config'),
  saveConnectionConfig: (config) => ipcRenderer.invoke('connection:save-config', config),
  clearTunnelToken: () => ipcRenderer.invoke('connection:clear-token'),
  startConnection: () => ipcRenderer.invoke('connection:start'),
  stopConnection: () => ipcRenderer.invoke('connection:stop'),
  copyConnection: () => ipcRenderer.invoke('connection:copy'),
  rotateConnection: () => ipcRenderer.invoke('connection:rotate'),
  onConnectionChanged: (callback) => ipcRenderer.on('connection:changed', (_, value) => callback(value))
});