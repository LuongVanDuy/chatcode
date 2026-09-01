const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RECENT_ACTIVITY_LIMIT = 400;
const DAILY_USAGE_LIMIT = 120;
const SAFETY_ACTIONS = ['write', 'rename', 'delete', 'task', 'gitStage', 'gitCommit'];
const DEFAULT_SAFETY = Object.freeze({
  write: 'allow',
  rename: 'ask',
  delete: 'ask',
  task: 'ask',
  gitStage: 'allow',
  gitCommit: 'ask'
});
const FULL_PERMISSIONS = Object.freeze({ write:true, manageFiles:true, tasks:true, gitWrite:true });
const PROJECT_RULE_LIMIT = 24;

function normalizeProjectRules(raw = []) {
  const byKey = new Map();
  for (const item of Array.isArray(raw) ? raw.slice(-PROJECT_RULE_LIMIT * 2) : []) {
    const key = String(item?.key || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0,64);
    const value = String(item?.value || '').trim().slice(0,600);
    if (!key || !value || /password|secret|token|api[-_.\s]?key|credential|https?:\/\/|www\./i.test(`${key} ${value}`)) continue;
    byKey.set(key, { key, value, updatedAt:String(item?.updatedAt || new Date().toISOString()) });
  }
  return [...byKey.values()].slice(-PROJECT_RULE_LIMIT);
}

function emptyCounters() {
  return { calls: 0, read: 0, write: 0, task: 0, git: 0, manage: 0, other: 0, errors: 0, bytesIn: 0, bytesOut: 0, durationMs: 0 };
}

function defaultState(port) {
  return {
    projects: [],
    connection: { token: '', tokenRotatedAt: '', port, mode: 'custom', domain: '', tunnelTokenEnc: '' },
    settings: {
      closeToTray: true,
      launchAtLogin: false,
      activityNotifications: true,
      autoReconnect: true,
      healthIntervalSec: 30,
      approvalTimeoutSec: 60,
      backupBeforeChanges: true,
      autoUpdateCheck: true
    },
    updates: { lastCheckAt: '', lastInstalledVersion: '', lastError: '' },
    usage: { total: emptyCounters(), daily: {}, recent: [] }
  };
}

function normalizeDomain(value) {
  let text = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/\.$/, '');
  if (!text) return '';
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text)) {
    throw new Error('Domain không hợp lệ. Ví dụ: mcp.example.com');
  }
  return text;
}

function normalizeCounters(raw = {}) {
  const out = emptyCounters();
  for (const key of Object.keys(out)) out[key] = Math.max(0, Number(raw?.[key]) || 0);
  return out;
}

function normalizeUsage(raw = {}) {
  const daily = {};
  for (const key of Object.keys(raw.daily || {}).sort().slice(-DAILY_USAGE_LIMIT)) daily[key] = normalizeCounters(raw.daily[key]);
  const recent = Array.isArray(raw.recent) ? raw.recent.slice(0, RECENT_ACTIVITY_LIMIT).map(item => ({
    id: String(item.id || crypto.randomUUID()),
    at: String(item.at || new Date().toISOString()),
    tool: String(item.tool || 'unknown'),
    category: String(item.category || 'other'),
    project: String(item.project || ''),
    projectId: String(item.projectId || ''),
    target: String(item.target || '').slice(0, 220),
    ok: item.ok !== false,
    durationMs: Math.max(0, Number(item.durationMs) || 0),
    bytesIn: Math.max(0, Number(item.bytesIn) || 0),
    bytesOut: Math.max(0, Number(item.bytesOut) || 0),
    error: String(item.error || '').slice(0, 500)
  })) : [];
  return { total: normalizeCounters(raw.total), daily, recent };
}

function normalizePermissions(raw = {}) {
  return {
    write: !!raw?.write,
    manageFiles: !!raw?.manageFiles,
    tasks: !!raw?.tasks,
    gitWrite: !!raw?.gitWrite
  };
}

function normalizeSafetyRules(raw = {}) {
  const out = {};
  for (const action of SAFETY_ACTIONS) {
    const value = String(raw?.[action] || DEFAULT_SAFETY[action]);
    out[action] = ['allow', 'ask', 'deny'].includes(value) ? value : DEFAULT_SAFETY[action];
  }
  return out;
}

function normalizeSafety(raw = {}) {
  const rules = normalizeSafetyRules(raw);
  const workspaceMode = raw?._workspaceMode === 'trusted' ? 'trusted' : 'safe';
  const safePermissions = normalizePermissions(raw?._safePermissions || {});
  const safeSafety = normalizeSafetyRules(raw?._safeSafety || rules);
  const out = {
    ...rules,
    _workspaceMode: workspaceMode,
    _allowSecrets: workspaceMode === 'trusted' && !!raw?._allowSecrets,
    _safePermissions: safePermissions,
    _safeSafety: safeSafety
  };
  if (workspaceMode === 'trusted') {
    for (const action of SAFETY_ACTIONS) out[action] = 'allow';
  }
  return out;
}

function createStore(app, port) {
  const file = () => path.join(app.getPath('userData'), 'personal-chatcode.json');

  function normalize(raw) {
    const base = defaultState(port);
    const state = { ...base, ...(raw || {}) };
    state.projects = Array.isArray(state.projects) ? state.projects.map(project => {
      const rawPermissions = normalizePermissions(project.permissions);
      const safety = normalizeSafety(project.safety);
      const workspaceMode = safety._workspaceMode;
      const hasSavedPermissions = project.safety?._safePermissions && typeof project.safety._safePermissions === 'object';
      const safePermissions = hasSavedPermissions ? normalizePermissions(safety._safePermissions) : rawPermissions;
      const hasSavedSafety = project.safety?._safeSafety && typeof project.safety._safeSafety === 'object';
      const safeSafety = hasSavedSafety ? normalizeSafetyRules(safety._safeSafety) : normalizeSafetyRules(project.safety);
      safety._safePermissions = safePermissions;
      safety._safeSafety = safeSafety;
      const permissions = workspaceMode === 'trusted' ? { ...FULL_PERMISSIONS } : rawPermissions;
      return {
        ...project,
        projectRules:normalizeProjectRules(project.projectRules),
        workspaceMode,
        trusted: { allowSecrets:workspaceMode === 'trusted' && !!safety._allowSecrets, allowGitPush:false },
        safePermissions,
        safeSafety,
        permissions,
        safety
      };
    }) : [];

    state.connection = { ...base.connection, ...(state.connection || {}) };
    if (!state.connection.token) {
      state.connection.token = crypto.randomBytes(24).toString('hex');
      state.connection.tokenRotatedAt = new Date().toISOString();
    }
    state.connection.tokenRotatedAt = String(state.connection.tokenRotatedAt || '');
    state.connection.port = port;
    state.connection.mode = state.connection.mode === 'quick' ? 'quick' : 'custom';
    try { state.connection.domain = normalizeDomain(state.connection.domain); } catch { state.connection.domain = ''; }
    state.connection.tunnelTokenEnc = String(state.connection.tunnelTokenEnc || '');

    state.settings = {
      closeToTray: state.settings?.closeToTray !== false,
      launchAtLogin: !!state.settings?.launchAtLogin,
      activityNotifications: state.settings?.activityNotifications !== false,
      autoReconnect: state.settings?.autoReconnect !== false,
      healthIntervalSec: Math.min(120, Math.max(15, Number(state.settings?.healthIntervalSec) || 30)),
      approvalTimeoutSec: Math.min(90, Math.max(30, Number(state.settings?.approvalTimeoutSec) || 60)),
      backupBeforeChanges: state.settings?.backupBeforeChanges !== false,
      autoUpdateCheck: state.settings?.autoUpdateCheck !== false
    };
    state.updates = { ...base.updates, ...(state.updates || {}) };
    state.usage = normalizeUsage(state.usage);
    return state;
  }

  function read() {
    try { return normalize(JSON.parse(fs.readFileSync(file(), 'utf8'))); }
    catch { return normalize(defaultState(port)); }
  }

  function write(state) {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(normalize(state), null, 2), 'utf8');
  }

  function ensure() {
    const state = read();
    write(state);
    return state;
  }

  function connectionConfig(state = read()) {
    return {
      mode: state.connection.mode,
      domain: state.connection.domain,
      hasTunnelToken: !!state.connection.tunnelTokenEnc,
      localPort: port,
      tokenRotatedAt: state.connection.tokenRotatedAt
    };
  }

  function settings(state = read()) {
    return {
      closeToTray: !!state.settings.closeToTray,
      launchAtLogin: !!state.settings.launchAtLogin,
      activityNotifications: !!state.settings.activityNotifications,
      autoReconnect: !!state.settings.autoReconnect,
      healthIntervalSec: state.settings.healthIntervalSec,
      approvalTimeoutSec: state.settings.approvalTimeoutSec,
      backupBeforeChanges: !!state.settings.backupBeforeChanges,
      autoUpdateCheck: !!state.settings.autoUpdateCheck
    };
  }

  function getProject(ref) {
    const projects = read().projects;
    const needle = String(ref || '').trim().toLowerCase();
    const project = projects.find(item => item.id === ref) || projects.find(item => String(item.name || '').toLowerCase() === needle);
    if (!project) throw new Error(`Không tìm thấy dự án: ${ref}`);
    return project;
  }

  return {
    read, write, ensure, normalizeDomain, connectionConfig, settings, getProject,
    emptyCounters, normalizeUsage, normalizeCounters, normalizeSafety, normalizePermissions, normalizeProjectRules,
    safetyActions: SAFETY_ACTIONS, defaultSafety: DEFAULT_SAFETY, fullPermissions:FULL_PERMISSIONS
  };
}

module.exports = { createStore };
