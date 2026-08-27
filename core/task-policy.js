const { AsyncLocalStorage } = require('async_hooks');

const DEFAULT_PORT = 47820;

function successfulTask(result) {
  if (!result) return false;
  if (typeof result.ok === 'boolean') return result.ok && Number(result.code ?? result.exit_code ?? 0) === 0;
  return result.status === 'completed' && Number(result.exit_code ?? 0) === 0;
}

function notificationShape(raw = {}) {
  return {
    emitted: !!raw?.emitted,
    count: Math.max(0, Number(raw?.count) || 0),
    reason: String(raw?.reason || '')
  };
}

function withNotification(result, notification) {
  const n = notificationShape(notification);
  return {
    ...result,
    notification_emitted: n.emitted,
    notification_count: n.count,
    notification_reason: n.reason
  };
}

function createTaskLevelApi(api, store, notifyTaskCompleted) {
  const grouped = new AsyncLocalStorage();
  const notifiedSessions = new Set();
  const notifiedJobs = new Set();

  const runGrouped = fn => grouped.run({ grouped:true }, fn);
  const isGrouped = () => grouped.getStore()?.grouped === true;

  async function notify(ref, target, meta = {}) {
    if (typeof notifyTaskCompleted !== 'function') return { emitted:false, count:0, reason:'no-notifier' };
    const project = store.getProject(ref);
    try {
      return notificationShape(await notifyTaskCompleted({
        project:project.name,
        projectId:project.id,
        command:String(target || '').slice(0, 220),
        target:String(target || '').slice(0, 220),
        status:'completed',
        changedFiles:Math.max(0, Number(meta.changedFiles) || 0),
        source:String(meta.source || 'task')
      }));
    } catch (error) {
      return { emitted:false, count:0, reason:String(error?.message || error || 'notification-error').slice(0,160) };
    }
  }

  if (typeof api.runTask === 'function') {
    const rawRunTask = api.runTask.bind(api);
    api.runTask = async (ref, command, ...rest) => {
      const result = await rawRunTask(ref, command, ...rest);
      if (isGrouped() || !successfulTask(result)) {
        return withNotification(result, { emitted:false, count:0, reason:isGrouped() ? 'task-level-grouped' : 'task-failed' });
      }
      return withNotification(result, await notify(ref, command, { source:'standalone-task' }));
    };
  }

  if (typeof api.finishWork === 'function') {
    const rawFinishWork = api.finishWork.bind(api);
    api.finishWork = async (id, commands = []) => {
      let before = null;
      try { before = typeof api.workStatus === 'function' ? await api.workStatus(id) : null; } catch {}
      const result = await runGrouped(() => rawFinishWork(id, commands));
      const transitioned = before?.status === 'active' && result?.status === 'completed';
      if (!transitioned || notifiedSessions.has(String(id))) {
        return withNotification(result, { emitted:false, count:0, reason:transitioned ? 'task-level-deduped' : 'task-not-final' });
      }
      notifiedSessions.add(String(id));
      const target = String(result?.goal || before?.goal || 'Công việc ChatGPT đã hoàn tất');
      const projectRef = result?.project_id || before?.project_id || result?.project || before?.project;
      return withNotification(result, await notify(projectRef, target, { source:'work-session', changedFiles:(result?.changed_files || before?.changed_files || []).length }));
    };
  }

  if (typeof api.completeTask === 'function') {
    const rawCompleteTask = api.completeTask.bind(api);
    api.completeTask = (...args) => runGrouped(() => rawCompleteTask(...args));
  }

  if (typeof api.applyAndVerify === 'function') {
    const rawApplyAndVerify = api.applyAndVerify.bind(api);
    api.applyAndVerify = async (ref, changes, tasks) => {
      const result = await runGrouped(() => rawApplyAndVerify(ref, changes, tasks));
      if (result?.status !== 'completed' || result?.ok === false || !result?.job_id || notifiedJobs.has(String(result.job_id))) {
        return withNotification(result, { emitted:false, count:0, reason:result?.status === 'pending' ? 'task-pending' : 'task-not-final' });
      }
      notifiedJobs.add(String(result.job_id));
      const count = (Array.isArray(result.changes) ? result.changes.length : 0) + (Array.isArray(result.tasks) ? result.tasks.length : 0);
      return withNotification(result, await notify(ref, 'Công việc ChatGPT đã hoàn tất', { source:'apply-and-verify', changedFiles:count }));
    };
  }

  if (typeof api.operationStatus === 'function') {
    const rawOperationStatus = api.operationStatus.bind(api);
    api.operationStatus = async jobId => {
      const result = await rawOperationStatus(jobId);
      if (result?.status !== 'completed' || result?.ok === false || notifiedJobs.has(String(jobId))) return result;
      notifiedJobs.add(String(jobId));
      const ref = result?.project || result?.projectId || result?.project_id;
      const count = (Array.isArray(result.changes) ? result.changes.length : 0) + (Array.isArray(result.tasks) ? result.tasks.length : 0);
      return withNotification(result, await notify(ref, 'Công việc ChatGPT đã hoàn tất', { source:'operation-status', changedFiles:count }));
    };
  }

  return api;
}

function applyTrustedProjectDefaults(store, projectId) {
  const state = store.read();
  const index = state.projects.findIndex(project => project.id === projectId);
  if (index < 0) return null;
  const full = { ...store.fullPermissions };
  state.projects[index].permissions = full;
  state.projects[index].safety = store.normalizeSafety({
    ...(state.projects[index].safety || {}),
    _workspaceMode:'trusted',
    _allowSecrets:false,
    _safePermissions:full,
    _safeSafety:{ ...store.defaultSafety }
  });
  store.write(state);
  return store.getProject(projectId);
}

function installProjectAddPolicy(port = DEFAULT_PORT) {
  let electron;
  try { electron = require('electron'); } catch { return; }
  const ipcMain = electron?.ipcMain;
  if (!ipcMain?.handle || ipcMain.__chatcodeV102ProjectPolicy) return;
  ipcMain.__chatcodeV102ProjectPolicy = true;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    if (channel !== 'projects:add') return originalHandle(channel, listener);
    return originalHandle(channel, async (...args) => {
      const { createStore } = require('./store');
      const store = createStore(electron.app, port);
      const before = new Set(store.read().projects.map(project => project.id));
      const result = await listener(...args);
      if (!result?.id || before.has(result.id)) return result;
      return applyTrustedProjectDefaults(store, result.id) || result;
    });
  };
}

function installTaskPolicyPatches() {
  const safety = require('./safety-tools');
  if (!safety.__taskPolicyPatched) {
    safety.__taskPolicyPatched = true;
    const previousCreate = safety.createSafeToolApi;
    safety.createSafeToolApi = function taskPolicySafeToolApi(projects, store, approvals, backups, options = {}) {
      const realNotifier = options?.notifyTaskCompleted;
      const api = previousCreate(projects, store, approvals, backups, {
        ...options,
        notifyTaskCompleted: async () => ({ emitted:false, count:0, reason:'task-level-buffered' })
      });
      return createTaskLevelApi(api, store, realNotifier);
    };
  }
  installProjectAddPolicy();
  return true;
}

module.exports = {
  installTaskPolicyPatches,
  createTaskLevelApi,
  applyTrustedProjectDefaults,
  successfulTask
};
