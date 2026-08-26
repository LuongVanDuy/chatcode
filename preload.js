const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('personalCode', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: () => ipcRenderer.invoke('projects:add'),
  updateProject: (project) => ipcRenderer.invoke('projects:update', project),
  listFiles: (projectId) => ipcRenderer.invoke('files:list', projectId),
  readFile: (projectId, relPath) => ipcRenderer.invoke('files:read', projectId, relPath),
  search: (projectId, query) => ipcRenderer.invoke('files:search', projectId, query),
  writeFile: (projectId, relPath, content) => ipcRenderer.invoke('files:write', projectId, relPath, content),
  runTask: (projectId, command) => ipcRenderer.invoke('tasks:run', projectId, command),
  gitStatus: (projectId) => ipcRenderer.invoke('git:status', projectId),
  gitDiff: (projectId) => ipcRenderer.invoke('git:diff', projectId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveAISettings: (settings) => ipcRenderer.invoke('settings:ai', settings),
  runAgent: (projectId, message, history) => ipcRenderer.invoke('agent:run', projectId, message, history)
});
