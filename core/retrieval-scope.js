const { normalizeError } = require('./errors');
const { planWordPressRetrieval } = require('./wordpress-retrieval');

function nowMs() { return Number(process.hrtime.bigint() / 1000000n); }

function createScopedInspect(api, store) {
  return async function inspectProject(ref, query, limit = 8) {
    const started = nowMs();
    const project = store.getProject(ref);
    const telemetry = { total_ms:0, filesystem_ms:0, brain_refresh_ms:0, git_ms:0 };
    const rankedLimit = Math.min(16, Math.max(6, Number(limit) || 8));

    const brainStart = nowMs();
    const [context, overview] = await Promise.all([
      api.projectContext(project.id, query, rankedLimit),
      api.projectBrain(project.id)
    ]);
    telemetry.brain_refresh_ms = nowMs() - brainStart;

    const readLimit = overview?.wordpress?.isWordPress ? Math.min(6, rankedLimit) : Math.min(10, rankedLimit);
    const retrieval = planWordPressRetrieval(context.files || [], overview.wordpress || {}, query, readLimit);
    const fsStart = nowMs();
    const relevantFiles = [];
    for (const item of retrieval.files) {
      try {
        const read = await api.readFile(project.id, item.path);
        const content = String(read.content || '');
        relevantFiles.push({ ...item, content:content.slice(0, 24000), content_truncated:content.length > 24000 });
      } catch (error) {
        relevantFiles.push({ ...item, error:normalizeError(error) });
      }
    }
    telemetry.filesystem_ms = nowMs() - fsStart;

    const gitStart = nowMs();
    const gitStatus = await api.gitStatus(project.id);
    telemetry.git_ms = nowMs() - gitStart;
    const git = gitStatus.ok
      ? { is_repository:true, status:gitStatus.stdout, stderr:gitStatus.stderr || '' }
      : (/not a git repository/i.test(gitStatus.stderr || '')
          ? { is_repository:false, error:{ code:'GIT_NOT_REPOSITORY', message:gitStatus.stderr || 'Not a Git repository' } }
          : { is_repository:false, error:{ code:'INTERNAL_ERROR', message:gitStatus.stderr || 'Git status failed' } });

    telemetry.total_ms = nowMs() - started;
    return {
      ok:true,
      project:{ id:project.id, name:project.name, permissions:project.permissions },
      query:String(query || ''),
      frameworks:overview.frameworks,
      framework_names:overview.framework_names,
      primary_language:overview.primary_language,
      entrypoints:overview.entrypoints,
      wordpress:overview.wordpress,
      retrieval_scope:retrieval.scope,
      relevant_files:relevantFiles,
      relevant_relations:context.relations,
      top_symbols:(overview.topSymbols || []).slice(0, 40),
      git,
      telemetry
    };
  };
}

function installRetrievalScopePatches() {
  const safety = require('./safety-tools');
  if (safety.__retrievalScopePatched) return;
  safety.__retrievalScopePatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function retrievalAwareSafeToolApi(projects, store, approvals, backups, options) {
    const api = previousCreate(projects, store, approvals, backups, options);
    api.inspectProject = createScopedInspect(api, store);
    return api;
  };
}

module.exports = { createScopedInspect, installRetrievalScopePatches };
