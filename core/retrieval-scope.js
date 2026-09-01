const { normalizeError } = require('./errors');
const { planWordPressRetrieval, queryFlags } = require('./wordpress-retrieval');

function nowMs() { return Number(process.hrtime.bigint() / 1000000n); }

function mergeCandidates(primary = [], expanded = []) {
  const out = [], seen = new Set();
  for (const item of [...primary, ...expanded]) {
    const path = String(item?.path || item?.file || '').replace(/\\/g, '/');
    if (!path || seen.has(path)) continue;
    seen.add(path); out.push(item);
  }
  return out;
}

function explicitExpansionFlags(query) {
  const flags = queryFlags(query);
  return Object.entries(flags).filter(([, enabled]) => enabled).map(([name]) => name);
}

async function readRelevantFiles(api, projectId, files = []) {
  return Promise.all((Array.isArray(files) ? files : []).map(async item => {
    try {
      const read = await api.readFile(projectId, item.path);
      const content = String(read.content || '');
      return { ...item, content:content.slice(0, 24000), content_truncated:content.length > 24000 };
    } catch (error) {
      return { ...item, error:normalizeError(error) };
    }
  }));
}

function createScopedInspect(api, store) {
  return async function inspectProject(ref, query, limit = 8) {
    const started = nowMs();
    const project = store.getProject(ref);
    const telemetry = { total_ms:0, filesystem_ms:0, brain_refresh_ms:0, git_ms:0, explicit_search_ms:0 };
    const rankedLimit = Math.min(16, Math.max(6, Number(limit) || 8));

    const brainStart = nowMs();
    const [context, overview] = await Promise.all([
      api.projectContext(project.id, query, rankedLimit),
      api.projectBrain(project.id)
    ]);
    telemetry.brain_refresh_ms = nowMs() - brainStart;

    let candidates = context.files || [];
    const expansionFlags = overview?.wordpress?.isWordPress ? explicitExpansionFlags(query) : [];
    let explicitSearchUsed = false;
    if (expansionFlags.length && typeof api.search === 'function') {
      const searchStart = nowMs();
      try {
        const expanded = await api.search(project.id, query);
        candidates = mergeCandidates(candidates, Array.isArray(expanded) ? expanded.slice(0, 40) : []);
        explicitSearchUsed = true;
      } catch {}
      telemetry.explicit_search_ms = nowMs() - searchStart;
    }

    const readLimit = overview?.wordpress?.isWordPress ? Math.min(6, rankedLimit) : Math.min(10, rankedLimit);
    const retrieval = planWordPressRetrieval(candidates, overview.wordpress || {}, query, readLimit);
    retrieval.scope = {
      ...(retrieval.scope || {}),
      explicit_expansion_search:explicitSearchUsed,
      explicit_expansion_flags:expansionFlags,
      explicit_expansion_candidate_count:Math.max(0, candidates.length - (context.files || []).length)
    };

    const fsStart = nowMs();
    const relevantFiles = await readRelevantFiles(api, project.id, retrieval.files);
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

module.exports = { mergeCandidates, explicitExpansionFlags, readRelevantFiles, createScopedInspect, installRetrievalScopePatches };
