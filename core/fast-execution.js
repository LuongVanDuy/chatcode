const { normalizeError } = require('./errors');

const RECENT_GIT_TTL_MS = 150;
const MAX_RECENT_GIT = 24;
const MAX_INFLIGHT_READS = 160;

function norm(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function projectKey(store, ref) {
  try { return String(store.getProject(ref)?.id || ref || '').toLowerCase(); }
  catch { return String(ref || '').toLowerCase(); }
}

function pruneRecent(map, max = MAX_RECENT_GIT) {
  while (map.size > max) map.delete(map.keys().next().value);
}

function snapshotStats(stats) {
  return {
    git_status_calls:stats.git_status_calls,
    git_status_coalesced:stats.git_status_coalesced,
    git_status_recent_hits:stats.git_status_recent_hits,
    read_file_calls:stats.read_file_calls,
    read_file_coalesced:stats.read_file_coalesced,
    parallel_read_batches:stats.parallel_read_batches
  };
}

function statsDelta(after, before) {
  const out = {};
  for (const key of Object.keys(after)) out[key] = Math.max(0, Number(after[key] || 0) - Number(before[key] || 0));
  return out;
}

function createFastExecutionApi(api, store) {
  if (!api || api.__fastExecutionWrapped) return api;
  api.__fastExecutionWrapped = true;

  const inflightReads = new Map();
  const inflightGit = new Map();
  const recentGit = new Map();
  const stats = {
    git_status_calls:0,
    git_status_coalesced:0,
    git_status_recent_hits:0,
    read_file_calls:0,
    read_file_coalesced:0,
    parallel_read_batches:0
  };

  if (typeof api.readFile === 'function') {
    const originalReadFile = api.readFile.bind(api);
    api.readFile = async (ref, rel, ...rest) => {
      stats.read_file_calls++;
      const key = `${projectKey(store, ref)}:${norm(rel)}`;
      const existing = inflightReads.get(key);
      if (existing) {
        stats.read_file_coalesced++;
        return existing;
      }
      const pending = Promise.resolve().then(() => originalReadFile(ref, rel, ...rest));
      if (inflightReads.size < MAX_INFLIGHT_READS) inflightReads.set(key, pending);
      try { return await pending; }
      finally { if (inflightReads.get(key) === pending) inflightReads.delete(key); }
    };
  }

  // The base readFiles implementation is intentionally conservative and sequential.
  // At the outer runtime boundary the reads are independent and already scope-checked,
  // so fan them out while preserving input order and per-file errors.
  if (typeof api.readFiles === 'function' && typeof api.readFile === 'function') {
    api.readFiles = async (ref, paths) => {
      const list = (Array.isArray(paths) ? paths : []).slice(0, 12);
      if (list.length > 1) stats.parallel_read_batches++;
      return Promise.all(list.map(async rel => {
        try { return await api.readFile(ref, rel); }
        catch (error) { return { path:norm(rel), error:normalizeError(error) }; }
      }));
    };
  }

  if (typeof api.gitStatus === 'function') {
    const originalGitStatus = api.gitStatus.bind(api);
    api.gitStatus = async (ref, ...rest) => {
      stats.git_status_calls++;
      const key = projectKey(store, ref);
      const running = inflightGit.get(key);
      if (running) {
        stats.git_status_coalesced++;
        return running;
      }
      const recent = recentGit.get(key);
      if (recent && Date.now() - recent.at <= RECENT_GIT_TTL_MS) {
        stats.git_status_recent_hits++;
        return recent.value;
      }
      const pending = Promise.resolve()
        .then(() => originalGitStatus(ref, ...rest))
        .then(value => {
          recentGit.set(key, { at:Date.now(), value });
          pruneRecent(recentGit);
          return value;
        });
      inflightGit.set(key, pending);
      try { return await pending; }
      finally { if (inflightGit.get(key) === pending) inflightGit.delete(key); }
    };
  }

  function invalidateGit(ref) {
    const key = projectKey(store, ref);
    recentGit.delete(key);
    inflightGit.delete(key);
  }

  for (const name of ['writeFile','deleteFile','renameFile','applyPatch','runTask']) {
    if (typeof api[name] !== 'function') continue;
    const original = api[name].bind(api);
    api[name] = async (ref, ...args) => {
      const result = await original(ref, ...args);
      invalidateGit(ref);
      return result;
    };
  }

  if (typeof api.exec === 'function') {
    const originalExec = api.exec.bind(api);
    api.exec = async (ref, ...args) => {
      const result = await originalExec(ref, ...args);
      invalidateGit(ref);
      return result;
    };
  }

  // Surface only aggregate counters; no file content, command text or credentials enter telemetry.
  if (typeof api.inspectProject === 'function') {
    const originalInspect = api.inspectProject.bind(api);
    api.inspectProject = async (...args) => {
      const before = snapshotStats(stats);
      const result = await originalInspect(...args);
      const after = snapshotStats(stats);
      return {
        ...result,
        telemetry:{
          ...(result?.telemetry || {}),
          fast_execution:statsDelta(after, before)
        }
      };
    };
  }

  if (typeof api.prepareTask === 'function') {
    const originalPrepare = api.prepareTask.bind(api);
    api.prepareTask = async (...args) => {
      const before = snapshotStats(stats);
      const result = await originalPrepare(...args);
      const after = snapshotStats(stats);
      return {
        ...result,
        telemetry:{
          ...(result?.telemetry || {}),
          fast_execution:statsDelta(after, before)
        }
      };
    };
  }

  api.__fastExecutionStats = () => snapshotStats(stats);
  return api;
}

function installFastExecutionPatches() {
  const safety = require('./safety-tools');
  if (safety.__fastExecutionPatched) return;
  safety.__fastExecutionPatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function fastExecutionSafeToolApi(projects, store, approvals, backups, options) {
    return createFastExecutionApi(previousCreate(projects, store, approvals, backups, options), store);
  };
}

module.exports = {
  RECENT_GIT_TTL_MS,
  createFastExecutionApi,
  installFastExecutionPatches,
  projectKey,
  statsDelta
};
