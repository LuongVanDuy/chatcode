const GIT_LAZY_CODE = 'GIT_LAZY';

function lazyGitResult(operation) {
  return {
    ok:false,
    skipped:true,
    git_enabled:false,
    code:GIT_LAZY_CODE,
    operation:String(operation || 'git'),
    stdout:'',
    stderr:'',
    reason:'Git is lazy by default. Use an explicit Git tool or UI action to inspect repository state.'
  };
}

function sanitizeGit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = { ...value };
  if (Object.prototype.hasOwnProperty.call(out, 'git')) out.git = null;
  if (Object.prototype.hasOwnProperty.call(out, 'git_diff')) out.git_diff = '';
  if (out.baseline && typeof out.baseline === 'object') out.baseline = { ...out.baseline, git:null };
  if (out.context && typeof out.context === 'object') out.context = { ...out.context, git:null };
  if (out.current && typeof out.current === 'object') out.current = { ...out.current, git:null };
  if (out.final && typeof out.final === 'object') out.final = { ...out.final, git:null };
  if (out.session && typeof out.session === 'object') out.session = sanitizeGit(out.session);
  if (out.patch && typeof out.patch === 'object') out.patch = sanitizeGit(out.patch);
  if (out.rollback && typeof out.rollback === 'object') out.rollback = sanitizeGit(out.rollback);
  if (out.telemetry && typeof out.telemetry === 'object') out.telemetry = { ...out.telemetry, git_ms:0 };
  return out;
}

function installProjectGitLazyPatch() {
  const projectModule = require('./projects');
  if (projectModule.__gitLazyPatched) return;
  projectModule.__gitLazyPatched = true;
  const previousCreate = projectModule.createProjectService;

  projectModule.createProjectService = function gitLazyProjectService(...args) {
    const service = previousCreate(...args);
    const api = service.toolApi;
    if (!api.gitStatusExplicit && typeof api.gitStatus === 'function') api.gitStatusExplicit = api.gitStatus.bind(api);
    if (!api.gitDiffExplicit && typeof api.gitDiff === 'function') api.gitDiffExplicit = api.gitDiff.bind(api);
    api.gitStatus = async () => lazyGitResult('status');
    api.gitDiff = async () => lazyGitResult('diff');
    return service;
  };
}

function installSafetyGitLazyPatch() {
  const safety = require('./safety-tools');
  if (safety.__gitLazyPatched) return;
  safety.__gitLazyPatched = true;
  const previousCreate = safety.createSafeToolApi;

  safety.createSafeToolApi = function gitLazySafeToolApi(projects, ...rest) {
    const api = previousCreate(projects, ...rest);
    const base = projects.toolApi;

    api.gitStatusExplicit = (...args) => {
      if (typeof base.gitStatusExplicit !== 'function') return api.gitStatus(...args);
      return base.gitStatusExplicit(...args);
    };
    api.gitDiffExplicit = (...args) => {
      if (typeof base.gitDiffExplicit !== 'function') return api.gitDiff(...args);
      return base.gitDiffExplicit(...args);
    };

    const normalWorkflowMethods = [
      'inspectProject','applyAndVerify','startWork','applyPatch','workStatus','finishWork','rollbackWork','prepareTask','completeTask'
    ];
    for (const name of normalWorkflowMethods) {
      if (typeof api[name] !== 'function') continue;
      const original = api[name].bind(api);
      api[name] = async (...args) => sanitizeGit(await original(...args));
    }
    return api;
  };
}

function installGitLazyPatches() {
  installProjectGitLazyPatch();
  installSafetyGitLazyPatch();
  return true;
}

module.exports = {
  GIT_LAZY_CODE,
  lazyGitResult,
  sanitizeGit,
  installGitLazyPatches
};
