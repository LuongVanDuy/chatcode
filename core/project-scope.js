const path = require('path');
const { chatError } = require('./errors');
const { isBuiltinRef } = require('./builtin-skills-project');

const PROJECT_SCOPE_TTL_MS = 6 * 60 * 60 * 1000;
const MULTI_PROJECT_INTENT_RE = /\b(copy|clone|migrate|migration|transfer|sync|synchronize|compare|reference|refer|import|export|sao chep|di chuyen|chuyen du lieu|dong bo|so sanh|tham khao|hoc theo|giong|lay .* tu|tu .* sang|chuyen .* sang)\b/i;
const PROJECT_SWITCH_INTENT_RE = /\b(du an|project|truy cap|ket noi|mo|switch|chuyen sang|lam|sua|build|trien khai|update|tiep theo)\b/i;

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

  function now() { return Date.now(); }
  function activeScope() {
    if (!scope) return null;
    if (now() - scope.updated_at > PROJECT_SCOPE_TTL_MS) {
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

  function clearScopeForProject(project) {
    const current = activeScope();
    if (current && targetMatches(current, project)) scope = null;
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
      expires_at:new Date(current.updated_at + PROJECT_SCOPE_TTL_MS).toISOString()
    };
  }

  function violation(current, attempted, operation) {
    return chatError(
      'PROJECT_SCOPE_VIOLATION',
      `Task hiện tại đã khóa vào project "${current?.target?.name || current?.target?.id || ''}". Không được tự truy cập project khác.`,
      {
        target_project:scopeProjectShape(current?.target || {}),
        attempted_project:scopeProjectShape(attempted || {}),
        operation,
        reference_projects:(current?.references || []).map(scopeProjectShape),
        rule:'Project đang active vẫn bị khóa. Sau khi task/work session hoàn tất hoặc rollback, prepare_task trên project mới được phép thiết lập target mới; khi session còn active phải có intent chuyển project rõ ràng.'
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

  async function establishFromPrepare(ref, request) {
    if (isBuiltinRef(ref)) return activeScope();
    const projects = await allProjects();
    const target = await resolveProject(ref, projects);
    if (!target) return activeScope();
    const current = activeScope();
    if (current && !targetMatches(current, target)) {
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
    const current = activeScope();
    if (!current) {
      scope = buildScope(target, request, projects, 'inspect_project');
      return scope;
    }
    if (!targetMatches(current, target)) {
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

  const targetMethods = ['applyAndVerify','startWork','applyPatch','writeFile','deleteFile','renameFile','runTask','exec','gitStage','gitCommit'];
  for (const name of targetMethods) {
    if (!original[name]) continue;
    api[name] = async (ref, ...args) => {
      await ensureProject(ref, name, 'write');
      return original[name](ref, ...args);
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
      const ref = status?.project_id || status?.project || '';
      if (ref) await ensureProject(ref, 'work_status', 'read');
      return status;
    };
  }

  if (original.completeTask) {
    api.completeTask = async (taskId, ...args) => {
      const session = await guardSession(taskId, 'complete_task', 'write');
      const result = await original.completeTask(taskId, ...args);
      if (/^(?:completed|finished|rolled_back)$/i.test(String(result?.status || ''))) {
        const ref = session?.project_id || session?.project || '';
        if (ref) clearScopeForProject(await resolveProject(ref));
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
        const ref = session?.project_id || session?.project || '';
        if (ref) clearScopeForProject(await resolveProject(ref));
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
