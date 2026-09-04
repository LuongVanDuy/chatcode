const path = require('path');
const { chatError } = require('./errors');
const { isBuiltinRef } = require('./builtin-skills-project');

const PROJECT_SCOPE_TTL_MS = 6 * 60 * 60 * 1000;
const MULTI_PROJECT_INTENT_RE = /\b(copy|clone|migrate|migration|transfer|sync|synchronize|compare|reference|refer|import|export|sao chep|di chuyen|chuyen du lieu|dong bo|so sanh|tham khao|hoc theo|giong|lay .* tu|tu .* sang|chuyen .* sang)\b/i;
const PROJECT_SWITCH_INTENT_RE = /\b(du an|project|truy cap|ket noi|mo|switch|chuyen sang|lam|sua|build|trien khai|update|tiep theo)\b/i;
const TERMINAL_FINAL_RE = /^(?:completed|failed|timeout|timed_out|stopped|cancelled|canceled)$/i;
const WORK_FINAL_RE = /^(?:completed|finished|rolled_back|failed|cancelled|canceled)$/i;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function exactKey(value) {
  return String(value || '').trim().toLowerCase();
}

function projectAliases(project = {}) {
  const raw = [project.id, project.name, project.root ? path.basename(String(project.root)) : ''].filter(Boolean);
  const aliases = new Set();
  for (const value of raw) {
    const text = String(value || '').trim();
    if (!text) continue;
    aliases.add(normalizeText(text));
    const withoutDomain = text
      .replace(/\.com\.vn$/i, '')
      .replace(/\.net\.vn$/i, '')
      .replace(/\.org\.vn$/i, '')
      .replace(/\.vn$/i, '')
      .replace(/\.(com|net|org)$/i, '');
    aliases.add(normalizeText(withoutDomain));
  }
  return [...aliases].filter(value => value.length >= 3);
}

function textMentionsProject(text, project) {
  const haystack = ` ${normalizeText(text)} `;
  return projectAliases(project).some(alias => haystack.includes(` ${alias} `));
}

function projectMatchesRef(project, ref) {
  const needle = exactKey(ref);
  return !!needle && [project?.id, project?.name].map(exactKey).some(value => value && value === needle);
}

function isRealProject(project) {
  return project && !isBuiltinRef(project.id) && !isBuiltinRef(project.name);
}

function scopeProjectShape(project = {}) {
  return { id:String(project.id || ''), name:String(project.name || project.id || '') };
}

function scopeKey(project = {}) {
  return exactKey(project.id || project.name);
}

function createProjectScopeApi(api) {
  const methodNames = [
    'listProjects','listFiles','search','readFile','readFiles','projectBrain','findSymbols','findReferences','relatedFiles','projectContext',
    'prepareTask','completeTask','inspectProject','applyAndVerify','operationStatus','startWork','applyPatch','workStatus','finishWork','rollbackWork',
    'writeFile','deleteFile','renameFile','runTask','exec','jobStatus','jobStop','gitStatus','gitDiff','gitStatusExplicit','gitDiffExplicit','gitStage','gitCommit'
  ];
  const original = {};
  for (const name of methodNames) if (typeof api[name] === 'function') original[name] = api[name].bind(api);
  if (!original.listProjects) return api;

  // Project scope used to be one process-global lock. That made unrelated ChatGPT
  // conversations block each other. Keep independent target lanes instead: each
  // project can own work/terminal holders concurrently while session-bound calls
  // still resolve back to the project that created them.
  const scopes = new Map();
  let terminalHolderSeq = 0;
  const activeWorkSessions = new Map();
  const activeTerminalJobs = new Map();
  const activeForegroundTerminals = new Map();

  function now() { return Date.now(); }

  function holderMatchesProject(holder, project) {
    return !!holder && !!project && (projectMatchesRef(holder, project.id) || projectMatchesRef(holder, project.name));
  }

  function holderDetails(project = null) {
    const activeWorkSessionIds = [...activeWorkSessions.entries()]
      .filter(([, holder]) => !project || holderMatchesProject(holder, project))
      .map(([id]) => id);
    const activeJobIds = [...activeTerminalJobs.entries()]
      .filter(([, holder]) => !project || holderMatchesProject(holder, project))
      .map(([id]) => id);
    const activeForegroundTerminalIds = [...activeForegroundTerminals.entries()]
      .filter(([, holder]) => !project || holderMatchesProject(holder, project))
      .map(([id]) => id);
    const scopeHolderType = activeWorkSessionIds.length
      ? 'work_session'
      : activeJobIds.length
        ? 'terminal_job'
        : activeForegroundTerminalIds.length
          ? 'terminal_foreground'
          : '';
    return {
      active_work_session_ids:activeWorkSessionIds,
      active_job_ids:activeJobIds,
      active_foreground_terminal_count:activeForegroundTerminalIds.length,
      scope_holder_type:scopeHolderType
    };
  }

  function hasActiveHolders(project) {
    const details = holderDetails(project);
    return details.active_work_session_ids.length > 0
      || details.active_job_ids.length > 0
      || details.active_foreground_terminal_count > 0;
  }

  function pruneScopes() {
    const currentTime = now();
    for (const [key, current] of scopes.entries()) {
      if (currentTime - current.updated_at <= PROJECT_SCOPE_TTL_MS) continue;
      if (hasActiveHolders(current.target)) {
        current.updated_at = currentTime;
        continue;
      }
      scopes.delete(key);
    }
  }

  function activeScopes() {
    pruneScopes();
    return [...scopes.values()];
  }

  function scopeForProject(project) {
    if (!project) return null;
    return activeScopes().find(current => targetMatches(current, project)) || null;
  }

  function referenceScopesForProject(project) {
    if (!project) return [];
    return activeScopes().filter(current => current.references.some(ref => projectMatchesRef(ref, project.id) || projectMatchesRef(ref, project.name)));
  }

  function saveScope(current) {
    const key = scopeKey(current?.target);
    if (key) scopes.set(key, current);
    return current;
  }

  async function allProjects() {
    const value = await original.listProjects();
    return Array.isArray(value) ? value : [];
  }

  async function resolveProject(ref, projects = null) {
    if (isBuiltinRef(ref)) return { id:String(ref), name:String(ref), builtin:true };
    const list = projects || await allProjects();
    return list.find(project => projectMatchesRef(project, ref)) || null;
  }

  function scopeContainsProject(current, project, includeReferences = true) {
    if (!current || !project) return false;
    if (projectMatchesRef(current.target, project.id) || projectMatchesRef(current.target, project.name)) return true;
    return includeReferences && current.references.some(ref => projectMatchesRef(ref, project.id) || projectMatchesRef(ref, project.name));
  }

  function targetMatches(current, project) {
    return !!current && !!project && (projectMatchesRef(current.target, project.id) || projectMatchesRef(current.target, project.name));
  }

  function maybeReleaseScopeForProject(project) {
    if (!project || hasActiveHolders(project)) return;
    for (const [key, current] of scopes.entries()) {
      if (targetMatches(current, project)) scopes.delete(key);
    }
  }

  function shape(current) {
    if (!current) return { locked:false };
    return {
      locked:true,
      target:scopeProjectShape(current.target),
      multi_project:current.references.length > 0,
      reference_projects:current.references.map(scopeProjectShape),
      reference_access:current.references.length ? 'read-only' : 'none',
      source:current.source,
      ...holderDetails(current.target),
      expires_at:new Date(current.updated_at + PROJECT_SCOPE_TTL_MS).toISOString()
    };
  }

  function aggregateShape() {
    const lanes = activeScopes().map(shape);
    if (!lanes.length) return { locked:false, concurrent:false, scope_count:0, lanes:[] };
    if (lanes.length === 1) return { ...lanes[0], concurrent:false, scope_count:1, lanes };
    return {
      locked:true,
      concurrent:true,
      scope_count:lanes.length,
      target:null,
      targets:lanes.map(lane => lane.target),
      lanes,
      ...holderDetails()
    };
  }

  function sessionViolation(expected, attempted, operation, sessionId) {
    return chatError(
      'PROJECT_SCOPE_VIOLATION',
      `Session "${sessionId}" thuộc project "${expected?.name || expected?.id || ''}", không thể chạy trên project "${attempted?.name || attempted?.id || ''}".`,
      {
        target_project:scopeProjectShape(expected || {}),
        attempted_project:scopeProjectShape(attempted || {}),
        operation,
        session_id:String(sessionId || ''),
        ...holderDetails(expected || null),
        rule:'Work Session/task/terminal holder luôn bị ràng buộc vào project đã tạo ra nó; project khác có thể chạy song song bằng holder riêng.'
      }
    );
  }

  function missingSessionScopeViolation(attempted, operation) {
    return chatError(
      'PROJECT_SCOPE_VIOLATION',
      `Không có project scope đang active cho ${operation}.`,
      {
        target_project:null,
        attempted_project:scopeProjectShape(attempted || {}),
        operation,
        reference_projects:[],
        active_work_session_ids:[],
        active_job_ids:[],
        active_foreground_terminal_count:0,
        scope_holder_type:'',
        rule:'Session mutation không được tự khóa project từ một session cũ/không được ChatCode theo dõi. Hãy bắt đầu task mới bằng prepare_task hoặc start_work trên project đó.'
      }
    );
  }

  function referenceWriteViolation(current, attempted, operation) {
    return chatError(
      'PROJECT_SCOPE_READ_ONLY',
      `Project tham chiếu "${attempted?.name || attempted?.id || ''}" chỉ được đọc trong task hiện tại.`,
      {
        target_project:scopeProjectShape(current?.target || {}),
        reference_project:scopeProjectShape(attempted || {}),
        operation,
        rule:'Mutation chỉ được phép trên target project của lane này. Muốn sửa project tham chiếu song song, hãy mở prepare_task/start_work riêng cho project đó để tạo lane độc lập.'
      }
    );
  }

  function buildScope(target, request, projects, source) {
    const normalized = normalizeText(request);
    const mentioned = projects.filter(project => isRealProject(project) && !projectMatchesRef(project, target.id) && textMentionsProject(request, project));
    const allowReferences = mentioned.length > 0 && MULTI_PROJECT_INTENT_RE.test(normalized);
    return {
      target:scopeProjectShape(target),
      references:allowReferences ? mentioned.map(scopeProjectShape) : [],
      source,
      updated_at:now()
    };
  }

  function mergeReferences(current, next) {
    const merged = new Map();
    for (const ref of [...(current?.references || []), ...(next?.references || [])]) {
      const key = scopeKey(ref);
      if (key) merged.set(key, scopeProjectShape(ref));
    }
    return [...merged.values()];
  }

  async function refreshTerminalHolders(project) {
    if (!project || !original.jobStatus) return;
    const jobs = [...activeTerminalJobs.entries()].filter(([, holder]) => holderMatchesProject(holder, project));
    for (const [jobId] of jobs) {
      try {
        const status = await original.jobStatus(jobId);
        if (TERMINAL_FINAL_RE.test(String(status?.status || ''))) activeTerminalJobs.delete(jobId);
      } catch (error) {
        const code = String(error?.code || error?.details?.code || '');
        if (code === 'FILE_NOT_FOUND') activeTerminalJobs.delete(jobId);
      }
    }
    maybeReleaseScopeForProject(project);
  }

  async function establishTargetLane(ref, request, source) {
    if (isBuiltinRef(ref)) return null;
    const projects = await allProjects();
    const target = await resolveProject(ref, projects);
    if (!target) return null;
    await refreshTerminalHolders(target);
    const existing = scopeForProject(target);
    const next = buildScope(target, request, projects, source);
    if (!existing) return saveScope(next);
    existing.references = mergeReferences(existing, next);
    existing.source = source || existing.source;
    existing.updated_at = now();
    return existing;
  }

  async function establishFromPrepare(ref, request) {
    return establishTargetLane(ref, request, 'prepare_task');
  }

  async function establishFromInspect(ref, request) {
    return establishTargetLane(ref, request, 'inspect_project');
  }

  async function ensureProject(ref, operation, mode = 'read') {
    if (isBuiltinRef(ref)) return { builtin:true };
    const projects = await allProjects();
    const attempted = await resolveProject(ref, projects);
    if (!attempted) return null;

    const targetLane = scopeForProject(attempted);
    if (targetLane) {
      targetLane.updated_at = now();
      return attempted;
    }

    const referenceLane = referenceScopesForProject(attempted)[0] || null;
    if (referenceLane && mode !== 'read') throw referenceWriteViolation(referenceLane, attempted, operation);
    if (mode === 'read') return attempted;

    saveScope({ target:scopeProjectShape(attempted), references:[], source:`implicit:${operation}`, updated_at:now() });
    return attempted;
  }

  async function guardSession(sessionId, operation, mode = 'read', allowWithoutScope = false) {
    if (!original.workStatus) return null;
    const id = String(sessionId || '');
    const status = await original.workStatus(id);
    const ref = status?.project_id || status?.project || '';
    if (!ref) return status;
    const projects = await allProjects();
    const attempted = await resolveProject(ref, projects);
    const holder = activeWorkSessions.get(id) || null;
    if (holder && attempted && !holderMatchesProject(holder, attempted)) throw sessionViolation(holder, attempted, operation, id);

    let current = attempted ? scopeForProject(attempted) : null;
    if (mode === 'write' && !current) {
      if (holder && attempted && holderMatchesProject(holder, attempted)) {
        current = saveScope({ target:scopeProjectShape(attempted), references:[], source:`session-recover:${operation}`, updated_at:now() });
      } else if (allowWithoutScope) {
        return status;
      } else {
        throw missingSessionScopeViolation(attempted, operation);
      }
    }
    if (ref) await ensureProject(ref, operation, mode);
    return status;
  }

  // Never hide other projects globally. Concurrent conversations need to discover and
  // open independent project lanes even while another project has active holders.
  api.listProjects = (...args) => original.listProjects(...args);

  const readMethods = ['listFiles','search','readFile','readFiles','projectBrain','findSymbols','findReferences','relatedFiles','projectContext','gitStatus','gitDiff','gitStatusExplicit','gitDiffExplicit'];
  for (const name of readMethods) {
    if (!original[name]) continue;
    api[name] = async (ref, ...args) => {
      await ensureProject(ref, name, 'read');
      return original[name](ref, ...args);
    };
  }

  const targetMethods = ['applyAndVerify','applyPatch','writeFile','deleteFile','renameFile','runTask','gitStage','gitCommit'];
  for (const name of targetMethods) {
    if (!original[name]) continue;
    api[name] = async (ref, ...args) => {
      await ensureProject(ref, name, 'write');
      return original[name](ref, ...args);
    };
  }

  if (original.startWork) {
    api.startWork = async (ref, ...args) => {
      const lane = await establishTargetLane(ref, args[0] || '', 'start_work');
      const project = lane?.target ? await resolveProject(lane.target.id) : await ensureProject(ref, 'startWork', 'write');
      try {
        const result = await original.startWork(ref, ...args);
        const sessionId = String(result?.work_session_id || result?.session_id || result?.id || '');
        if (sessionId && project) activeWorkSessions.set(sessionId, scopeProjectShape(project));
        return result;
      } catch (error) {
        if (project) maybeReleaseScopeForProject(project);
        throw error;
      }
    };
  }

  if (original.exec) {
    api.exec = async (ref, ...args) => {
      const project = await ensureProject(ref, 'exec', 'write');
      const options = args[1] || {};
      const background = !!options.background;
      const launchId = `terminal-foreground-${++terminalHolderSeq}`;
      if (project) activeForegroundTerminals.set(launchId, scopeProjectShape(project));
      try {
        const result = await original.exec(ref, ...args);
        const jobId = String(result?.job_id || '');
        if (background && jobId && /^(?:running|stopping)$/i.test(String(result?.status || '')) && project) {
          activeTerminalJobs.set(jobId, scopeProjectShape(project));
        }
        return result;
      } finally {
        activeForegroundTerminals.delete(launchId);
        if (project) maybeReleaseScopeForProject(project);
      }
    };
  }

  if (original.jobStatus) {
    api.jobStatus = (jobId, ...args) => {
      const settle = result => {
        const id = String(jobId || '');
        const project = activeTerminalJobs.get(id);
        if (project && TERMINAL_FINAL_RE.test(String(result?.status || ''))) {
          activeTerminalJobs.delete(id);
          maybeReleaseScopeForProject(project);
        }
        return result;
      };
      const result = original.jobStatus(jobId, ...args);
      return result && typeof result.then === 'function' ? result.then(settle) : settle(result);
    };
  }

  if (original.jobStop) {
    api.jobStop = async (jobId, ...args) => {
      const id = String(jobId || '');
      const project = activeTerminalJobs.get(id);
      const result = await original.jobStop(jobId, ...args);
      if (project && TERMINAL_FINAL_RE.test(String(result?.status || ''))) {
        activeTerminalJobs.delete(id);
        maybeReleaseScopeForProject(project);
      }
      return result;
    };
  }

  if (original.inspectProject) {
    api.inspectProject = async (ref, query, ...rest) => {
      const lane = await establishFromInspect(ref, query);
      try {
        const result = await original.inspectProject(ref, query, ...rest);
        return { ...result, project_scope:shape(lane) };
      } catch (error) {
        if (lane?.target) maybeReleaseScopeForProject(lane.target);
        throw error;
      }
    };
  }

  if (original.prepareTask) {
    api.prepareTask = async (ref, request, ...rest) => {
      const lane = await establishFromPrepare(ref, request);
      try {
        const result = await original.prepareTask(ref, request, ...rest);
        const project = await resolveProject(ref);
        const holderIds = [...new Set([
          String(result?.task_id || ''),
          String(result?.work_session_id || '')
        ].filter(Boolean))];
        if (project && !WORK_FINAL_RE.test(String(result?.status || ''))) {
          for (const id of holderIds) activeWorkSessions.set(id, scopeProjectShape(project));
        }
        const projectScope = shape(lane || scopeForProject(project));
        const guidance = Array.isArray(result?.agent_contract?.guidance) ? result.agent_contract.guidance : [];
        return {
          ...result,
          project_scope:projectScope,
          context:result?.context ? { ...result.context, project_scope:projectScope } : result?.context,
          agent_contract:result?.agent_contract ? {
            ...result.agent_contract,
            guidance:[
              `Project lane của task này là ${projectScope?.target?.name || ref}. Task/project khác có thể chạy song song nhưng session này chỉ được mutate target lane của chính nó.`,
              'Reference project chỉ được đọc trong lane hiện tại; muốn sửa reference song song, mở prepare_task/start_work riêng cho project đó.',
              ...guidance
            ]
          } : result?.agent_contract
        };
      } catch (error) {
        if (lane?.target) maybeReleaseScopeForProject(lane.target);
        throw error;
      }
    };
  }

  if (original.workStatus) {
    api.workStatus = async (sessionId, ...rest) => {
      const status = await original.workStatus(sessionId, ...rest);
      const id = String(sessionId || '');
      const ref = status?.project_id || status?.project || '';
      const project = activeWorkSessions.get(id);
      if (project && WORK_FINAL_RE.test(String(status?.status || ''))) {
        activeWorkSessions.delete(id);
        maybeReleaseScopeForProject(project);
        return status;
      }
      if (ref) await ensureProject(ref, 'work_status', 'read');
      return status;
    };
  }

  function releaseSessionHolder(id, project, extraIds = []) {
    const ids = [...new Set([String(id || ''), ...extraIds.map(value => String(value || ''))].filter(Boolean))];
    for (const holderId of ids) activeWorkSessions.delete(holderId);
    if (project) maybeReleaseScopeForProject(project);
  }

  if (original.completeTask) {
    api.completeTask = async (taskId, ...args) => {
      const session = await guardSession(taskId, 'complete_task', 'write');
      const result = await original.completeTask(taskId, ...args);
      if (WORK_FINAL_RE.test(String(result?.status || ''))) {
        const id = String(taskId || '');
        const ref = session?.project_id || session?.project || '';
        const project = activeWorkSessions.get(id) || (ref ? await resolveProject(ref) : null);
        releaseSessionHolder(id, project, [result?.task_id, result?.work_session_id]);
      }
      return result;
    };
  }

  for (const name of ['finishWork','rollbackWork']) {
    if (!original[name]) continue;
    api[name] = async (sessionId, ...args) => {
      const session = await guardSession(sessionId, name, 'write', name === 'rollbackWork');
      const result = await original[name](sessionId, ...args);
      if (result?.ok !== false) {
        const id = String(sessionId || '');
        const ref = session?.project_id || session?.project || '';
        const project = activeWorkSessions.get(id) || (ref ? await resolveProject(ref) : null);
        releaseSessionHolder(id, project, [result?.task_id, result?.work_session_id, result?.id]);
      }
      return result;
    };
  }

  api.projectScope = ref => {
    if (ref) {
      const current = activeScopes().find(item => projectMatchesRef(item.target, ref));
      return shape(current || null);
    }
    return aggregateShape();
  };
  return api;
}

function installProjectScopePatches() {
  const safety = require('./safety-tools');
  if (safety.__projectScopePatched) return;
  safety.__projectScopePatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function projectScopedSafeToolApi(...args) {
    return createProjectScopeApi(previousCreate(...args));
  };
}

module.exports = {
  PROJECT_SCOPE_TTL_MS,
  MULTI_PROJECT_INTENT_RE,
  PROJECT_SWITCH_INTENT_RE,
  normalizeText,
  projectAliases,
  textMentionsProject,
  createProjectScopeApi,
  installProjectScopePatches
};