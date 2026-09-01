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

function createProjectScopeApi(api) {
  const methodNames = [
    'listProjects','listFiles','search','readFile','readFiles','projectBrain','findSymbols','findReferences','relatedFiles','projectContext',
    'prepareTask','completeTask','inspectProject','applyAndVerify','operationStatus','startWork','applyPatch','workStatus','finishWork','rollbackWork',
    'writeFile','deleteFile','renameFile','runTask','exec','jobStatus','jobStop','gitStatus','gitDiff','gitStatusExplicit','gitDiffExplicit','gitStage','gitCommit'
  ];
  const original = {};
  for (const name of methodNames) if (typeof api[name] === 'function') original[name] = api[name].bind(api);
  if (!original.listProjects) return api;

  let scope = null;
  let terminalHolderSeq = 0;
  const activeWorkSessions = new Map();
  const activeTerminalJobs = new Map();
  const activeForegroundTerminals = new Map();

  function now() { return Date.now(); }

  function holderMatchesProject(holder, project) {
    return !!holder && !!project && (projectMatchesRef(holder, project.id) || projectMatchesRef(holder, project.name));
  }

  function holderDetails(project = scope?.target || null) {
    const activeWorkSessionIds = [...activeWorkSessions.entries()]
      .filter(([, holder]) => holderMatchesProject(holder, project))
      .map(([id]) => id);
    const activeJobIds = [...activeTerminalJobs.entries()]
      .filter(([, holder]) => holderMatchesProject(holder, project))
      .map(([id]) => id);
    const activeForegroundTerminalIds = [...activeForegroundTerminals.entries()]
      .filter(([, holder]) => holderMatchesProject(holder, project))
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

  function activeScope() {
    if (!scope) return null;
    if (now() - scope.updated_at > PROJECT_SCOPE_TTL_MS) {
      if (hasActiveHolders(scope.target)) {
        scope.updated_at = now();
        return scope;
      }
      scope = null;
      return null;
    }
    return scope;
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
    if (scope && targetMatches(scope, project) && !hasActiveHolders(project)) scope = null;
  }

  function shape(current = activeScope()) {
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

  function violation(current, attempted, operation) {
    const holders = holderDetails(current?.target || null);
    return chatError(
      'PROJECT_SCOPE_VIOLATION',
      `Task hiện tại đã khóa vào project "${current?.target?.name || current?.target?.id || ''}". Không được tự truy cập project khác.`,
      {
        target_project:scopeProjectShape(current?.target || {}),
        attempted_project:scopeProjectShape(attempted || {}),
        operation,
        reference_projects:(current?.references || []).map(scopeProjectShape),
        ...holders,
        rule:holders.scope_holder_type
          ? 'Project scope đang được giữ bởi holder còn active. Hãy finish/rollback work session hoặc chờ/dừng terminal job trước khi chuyển target.'
          : 'Project scope chưa có holder active. prepare_task chỉ được chuyển target khi user thể hiện intent chuyển project rõ ràng.'
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
        rule:'Session mutation không được tự khóa project. Hãy bắt đầu task mới bằng prepare_task trên target project trước khi complete/finish session của project đó. rollback_work của session đã hoàn tất vẫn được phép khi chưa có target mới.'
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
        rule:'Mutation chỉ được phép trên target project. Muốn sửa project tham chiếu, hãy mở prepare_task riêng cho project đó.'
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

  async function establishFromPrepare(ref, request) {
    if (isBuiltinRef(ref)) return activeScope();
    const projects = await allProjects();
    const target = await resolveProject(ref, projects);
    if (!target) return activeScope();
    if (scope?.target) await refreshTerminalHolders(scope.target);
    const current = activeScope();
    if (current && !targetMatches(current, target)) {
      if (hasActiveHolders(current.target)) throw violation(current, target, 'prepare_task');
      const normalized = normalizeText(request);
      const explicitTarget = textMentionsProject(request, target);
      if (!explicitTarget || !PROJECT_SWITCH_INTENT_RE.test(normalized)) throw violation(current, target, 'prepare_task');
    }
    scope = buildScope(target, request, projects, 'prepare_task');
    return scope;
  }

  async function establishFromInspect(ref, request) {
    if (isBuiltinRef(ref)) return activeScope();
    const projects = await allProjects();
    const target = await resolveProject(ref, projects);
    if (!target) return activeScope();
    if (scope?.target) await refreshTerminalHolders(scope.target);
    const current = activeScope();
    if (!current) {
      scope = buildScope(target, request, projects, 'inspect_project');
      return scope;
    }
    if (!targetMatches(current, target)) {
      if (hasActiveHolders(current.target)) throw violation(current, target, 'inspect_project');
      const normalized = normalizeText(request);
      const explicitTarget = textMentionsProject(request, target);
      if (!explicitTarget || !PROJECT_SWITCH_INTENT_RE.test(normalized)) throw violation(current, target, 'inspect_project');
      scope = buildScope(target, request, projects, 'inspect_project-switch');
      return scope;
    }
    if (MULTI_PROJECT_INTENT_RE.test(normalizeText(request))) scope = buildScope(target, request, projects, current.source);
    else scope.updated_at = now();
    return scope;
  }

  async function ensureProject(ref, operation, mode = 'read') {
    if (isBuiltinRef(ref)) return { builtin:true };
    const projects = await allProjects();
    const attempted = await resolveProject(ref, projects);
    if (!attempted) return null;
    let current = activeScope();
    if (!current) {
      scope = { target:scopeProjectShape(attempted), references:[], source:`implicit:${operation}`, updated_at:now() };
      current = scope;
      return attempted;
    }
    current.updated_at = now();
    if (targetMatches(current, attempted)) return attempted;
    const isReference = current.references.some(project => projectMatchesRef(project, attempted.id) || projectMatchesRef(project, attempted.name));
    if (isReference) {
      if (mode === 'read') return attempted;
      throw referenceWriteViolation(current, attempted, operation);
    }
    throw violation(current, attempted, operation);
  }

  async function guardSession(sessionId, operation, mode = 'read', allowWithoutScope = false) {
    if (!original.workStatus) return null;
    const status = await original.workStatus(String(sessionId || ''));
    const ref = status?.project_id || status?.project || '';
    if (!ref) return status;
    const projects = await allProjects();
    const attempted = await resolveProject(ref, projects);
    if (mode === 'write' && !activeScope()) {
      if (allowWithoutScope) return status;
      throw missingSessionScopeViolation(attempted, operation);
    }
    await ensureProject(ref, operation, mode);
    return status;
  }

  api.listProjects = async (...args) => {
    const projects = await original.listProjects(...args);
    const current = activeScope();
    if (!current || !Array.isArray(projects)) return projects;
    return projects.filter(project => {
      if (isBuiltinRef(project?.id) || isBuiltinRef(project?.name)) return true;
      return scopeContainsProject(current, project, true);
    });
  };

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
      const project = await ensureProject(ref, 'startWork', 'write');
      const result = await original.startWork(ref, ...args);
      const sessionId = String(result?.work_session_id || result?.session_id || result?.id || '');
      if (sessionId && project) activeWorkSessions.set(sessionId, scopeProjectShape(project));
      return result;
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
    api.jobStatus = async (jobId, ...args) => {
      const result = await original.jobStatus(jobId, ...args);
      const id = String(jobId || '');
      const project = activeTerminalJobs.get(id);
      if (project && TERMINAL_FINAL_RE.test(String(result?.status || ''))) {
        activeTerminalJobs.delete(id);
        maybeReleaseScopeForProject(project);
      }
      return result;
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
      await establishFromInspect(ref, query);
      const result = await original.inspectProject(ref, query, ...rest);
      return { ...result, project_scope:shape() };
    };
  }

  if (original.prepareTask) {
    api.prepareTask = async (ref, request, ...rest) => {
      await establishFromPrepare(ref, request);
      const result = await original.prepareTask(ref, request, ...rest);
      const project = await resolveProject(ref);
      const sessionId = String(result?.work_session_id || result?.task_id || '');
      if (sessionId && project && !WORK_FINAL_RE.test(String(result?.status || ''))) {
        activeWorkSessions.set(sessionId, scopeProjectShape(project));
      }
      const projectScope = shape();
      const guidance = Array.isArray(result?.agent_contract?.guidance) ? result.agent_contract.guidance : [];
      return {
        ...result,
        project_scope:projectScope,
        context:result?.context ? { ...result.context, project_scope:projectScope } : result?.context,
        agent_contract:result?.agent_contract ? {
          ...result.agent_contract,
          guidance:[
            `Project scope đã khóa vào ${projectScope?.target?.name || ref}. Không list/search/read project khác nếu nó không nằm trong reference_projects do user yêu cầu rõ ràng.`,
            'Reference project chỉ được đọc; mọi mutation phải ở target project.',
            ...guidance
          ]
        } : result?.agent_contract
      };
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

  if (original.completeTask) {
    api.completeTask = async (taskId, ...args) => {
      const session = await guardSession(taskId, 'complete_task', 'write');
      const result = await original.completeTask(taskId, ...args);
      if (WORK_FINAL_RE.test(String(result?.status || ''))) {
        const id = String(taskId || '');
        const ref = session?.project_id || session?.project || '';
        const project = activeWorkSessions.get(id) || (ref ? await resolveProject(ref) : null);
        activeWorkSessions.delete(id);
        if (project) maybeReleaseScopeForProject(project);
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
        activeWorkSessions.delete(id);
        if (project) maybeReleaseScopeForProject(project);
      }
      return result;
    };
  }

  api.projectScope = () => shape();
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
