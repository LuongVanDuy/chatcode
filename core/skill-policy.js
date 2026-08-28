const { chatError } = require('./errors');
const {
  WORDPRESS_BRICKS_SKILL_ID,
  hasBricksProjectEvidence,
  skillsForTask
} = require('./skill-runtime');
const { isBuiltinRef } = require('./builtin-skills-project');

const POLICY_TTL_MS = 60 * 1000;
const PRIME_TTL_MS = 30 * 60 * 1000;
const LEGACY_CONTEXT_TTL_MS = 10 * 60 * 1000;
const PREPARED_TASK_TTL_MS = 6 * 60 * 60 * 1000;
const SKILL_ENTRY = 'skills/wordpress-bricks/SKILL.md';

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function isWordPressBricksSkillEntry(value) {
  return normalizeRel(value).toLowerCase() === SKILL_ENTRY.toLowerCase();
}

function isWordPressBricksSkillPath(value) {
  const rel = normalizeRel(value).toLowerCase();
  return rel === SKILL_ENTRY.toLowerCase() || rel.startsWith('skills/wordpress-bricks/resources/');
}

function mandatoryPolicyShape(skills = []) {
  return {
    mandatory:true,
    skill_id:WORDPRESS_BRICKS_SKILL_ID,
    modern_workflow:'prepare_task -> complete_task',
    legacy_workflow:`read target project context, then read ${SKILL_ENTRY} from CHATCODE-GPT before mutation`,
    attached:skills.some(skill => skill?.id === WORDPRESS_BRICKS_SKILL_ID)
  };
}

function createSkillPolicyApi(api) {
  const original = {};
  for (const name of [
    'inspectProject','prepareTask','completeTask','workStatus','applyPatch','applyAndVerify',
    'writeFile','deleteFile','renameFile','runTask','exec','listFiles','search','readFile','readFiles'
  ]) {
    if (typeof api[name] === 'function') original[name] = api[name].bind(api);
  }

  if (!original.inspectProject) return api;

  const policyCache = new Map();
  const projectPrime = new Map();
  const preparedTasks = new Map();
  let recentLegacyProject = null;
  let internalMutationDepth = 0;

  function now() { return Date.now(); }
  function primeKey(ref) { return String(ref || '').trim().toLowerCase(); }
  function prunePreparedTasks() {
    const cutoff = now() - PREPARED_TASK_TTL_MS;
    for (const [id, task] of preparedTasks) if ((task?.at || 0) < cutoff) preparedTasks.delete(id);
  }
  function markProjectPrimed(...refs) {
    const at = now();
    for (const ref of refs) {
      const key = primeKey(ref);
      if (key) projectPrime.set(key, at);
    }
  }
  function projectIsPrimed(...refs) {
    const cutoff = now() - PRIME_TTL_MS;
    return refs.some(ref => {
      const key = primeKey(ref);
      if (!key) return false;
      const at = projectPrime.get(key) || 0;
      if (at < cutoff) {
        if (at) projectPrime.delete(key);
        return false;
      }
      return true;
    });
  }
  function rememberLegacyProject(ref) {
    if (isBuiltinRef(ref)) return;
    const key = primeKey(ref);
    if (key) recentLegacyProject = { ref:String(ref || ''), key, at:now() };
  }
  function bindLegacySkillToRecentProject() {
    if (!recentLegacyProject || now() - recentLegacyProject.at > LEGACY_CONTEXT_TTL_MS) return false;
    markProjectPrimed(recentLegacyProject.ref);
    recentLegacyProject = null;
    return true;
  }

  async function detectPolicy(ref) {
    if (isBuiltinRef(ref)) return { required:false, inspect:null };
    const key = primeKey(ref);
    const cached = policyCache.get(key);
    if (cached && now() - cached.at <= POLICY_TTL_MS) return cached.value;
    const inspect = await original.inspectProject(ref, 'Detect mandatory WordPress + Bricks skill policy from project evidence', 4);
    const evidence = hasBricksProjectEvidence(inspect);
    const value = { required:evidence.active, inspect };
    policyCache.set(key, { at:now(), value });
    const id = primeKey(inspect?.project?.id);
    const name = primeKey(inspect?.project?.name);
    if (id) policyCache.set(id, { at:now(), value });
    if (name) policyCache.set(name, { at:now(), value });
    return value;
  }

  function requiredError(ref, operation) {
    return chatError(
      'SKILL_REQUIRED',
      'Project WordPress + Bricks bắt buộc sử dụng skill wordpress-bricks trước khi thực hiện thay đổi.',
      {
        project:String(ref || ''),
        operation,
        skill_id:WORDPRESS_BRICKS_SKILL_ID,
        modern_workflow:'Gọi prepare_task(project, request) trước, sau đó complete_task(task_id, patch, verify_commands).',
        legacy_workflow:`Đọc context của đúng project đích, sau đó đọc ${SKILL_ENTRY} trong CHATCODE-GPT và resource liên quan trước khi mutation.`
      }
    );
  }

  async function requirePrimedProject(ref, operation) {
    if (internalMutationDepth > 0 || isBuiltinRef(ref)) return null;
    const policy = await detectPolicy(ref);
    if (!policy.required) return policy;
    const inspect = policy.inspect;
    if (projectIsPrimed(ref, inspect?.project?.id, inspect?.project?.name)) return policy;
    throw requiredError(ref, operation);
  }

  if (original.listFiles) {
    api.listFiles = async (ref, ...args) => {
      const result = await original.listFiles(ref, ...args);
      rememberLegacyProject(ref);
      return result;
    };
  }

  if (original.search) {
    api.search = async (ref, ...args) => {
      const result = await original.search(ref, ...args);
      rememberLegacyProject(ref);
      return result;
    };
  }

  if (original.readFile) {
    api.readFile = async (ref, rel, ...rest) => {
      const result = await original.readFile(ref, rel, ...rest);
      if (isBuiltinRef(ref)) {
        if (isWordPressBricksSkillEntry(rel)) bindLegacySkillToRecentProject();
      } else {
        rememberLegacyProject(ref);
      }
      return result;
    };
  }

  if (original.readFiles) {
    api.readFiles = async (ref, paths, ...rest) => {
      const result = await original.readFiles(ref, paths, ...rest);
      if (isBuiltinRef(ref)) {
        if ((Array.isArray(paths) ? paths : []).some(isWordPressBricksSkillEntry)) bindLegacySkillToRecentProject();
      } else {
        rememberLegacyProject(ref);
      }
      return result;
    };
  }

  api.inspectProject = async (ref, query, limit) => {
    const inspect = await original.inspectProject(ref, query, limit);
    const evidence = hasBricksProjectEvidence(inspect);
    if (!evidence.active) return inspect;
    const skills = skillsForTask(inspect, query);
    if (!skills.some(skill => skill?.id === WORDPRESS_BRICKS_SKILL_ID && skill?.mandatory === true)) {
      throw chatError('SKILL_REQUIRED', 'Không thể attach skill wordpress-bricks bắt buộc cho project Bricks.', { project:inspect?.project?.name || ref });
    }
    markProjectPrimed(ref, inspect?.project?.id, inspect?.project?.name);
    const value = { required:true, inspect };
    for (const key of [primeKey(ref), primeKey(inspect?.project?.id), primeKey(inspect?.project?.name)].filter(Boolean)) {
      policyCache.set(key, { at:now(), value });
    }
    return { ...inspect, skills, skill_policy:mandatoryPolicyShape(skills) };
  };

  if (original.prepareTask) {
    api.prepareTask = async (ref, request, limit) => {
      prunePreparedTasks();
      const result = await original.prepareTask(ref, request, limit);
      const evidence = hasBricksProjectEvidence(result?.context || {});
      if (!evidence.active) return result;
      const skills = Array.isArray(result?.skills) ? result.skills : [];
      const attached = skills.some(skill => skill?.id === WORDPRESS_BRICKS_SKILL_ID && skill?.mandatory === true);
      if (!attached) throw requiredError(ref, 'prepare_task');
      const taskId = String(result?.task_id || result?.work_session_id || '');
      if (taskId) preparedTasks.set(taskId, {
        project_ref:String(ref || ''),
        project_id:String(result?.context?.project?.id || ''),
        project_name:String(result?.context?.project?.name || ''),
        at:now()
      });
      markProjectPrimed(ref, result?.context?.project?.id, result?.context?.project?.name);
      return { ...result, skill_policy:mandatoryPolicyShape(skills) };
    };
  }

  function preparedMatchesProject(prepared, ref, inspect) {
    if (!prepared) return false;
    const preparedKeys = new Set([
      primeKey(prepared.project_ref),
      primeKey(prepared.project_id),
      primeKey(prepared.project_name)
    ].filter(Boolean));
    return [ref, inspect?.project?.id, inspect?.project?.name]
      .map(primeKey)
      .filter(Boolean)
      .some(key => preparedKeys.has(key));
  }

  if (original.completeTask) {
    api.completeTask = async (taskId, ...args) => {
      prunePreparedTasks();
      const id = String(taskId || '');
      const prepared = preparedTasks.get(id) || null;
      if (!prepared && original.workStatus) {
        const status = await original.workStatus(id);
        const policy = await detectPolicy(status?.project_id || status?.project || '');
        if (policy.required) throw requiredError(status?.project || status?.project_id || '', 'complete_task without prepare_task');
      }
      internalMutationDepth++;
      try {
        const result = await original.completeTask(taskId, ...args);
        if (result?.status === 'completed' || result?.status === 'rolled_back') preparedTasks.delete(id);
        return result;
      } finally {
        internalMutationDepth--;
      }
    };
  }

  if (original.applyPatch) {
    api.applyPatch = async (ref, patch, sessionId = '', ...rest) => {
      if (internalMutationDepth > 0) return original.applyPatch(ref, patch, sessionId, ...rest);
      prunePreparedTasks();
      const policy = await detectPolicy(ref);
      if (policy.required) {
        const prepared = preparedTasks.get(String(sessionId || ''));
        const preparedForProject = preparedMatchesProject(prepared, ref, policy.inspect);
        const primed = projectIsPrimed(ref, policy.inspect?.project?.id, policy.inspect?.project?.name);
        if (!preparedForProject && !primed) throw requiredError(ref, 'apply_patch');
      }
      internalMutationDepth++;
      try {
        return await original.applyPatch(ref, patch, sessionId, ...rest);
      } finally {
        internalMutationDepth--;
      }
    };
  }

  if (original.applyAndVerify) {
    api.applyAndVerify = async (ref, ...args) => {
      await requirePrimedProject(ref, 'apply_and_verify');
      internalMutationDepth++;
      try {
        return await original.applyAndVerify(ref, ...args);
      } finally {
        internalMutationDepth--;
      }
    };
  }

  for (const name of ['writeFile','deleteFile','renameFile','runTask']) {
    if (!original[name]) continue;
    api[name] = async (ref, ...args) => {
      await requirePrimedProject(ref, name);
      return original[name](ref, ...args);
    };
  }

  if (original.exec) {
    api.exec = async (ref, command, opts = {}) => {
      if (internalMutationDepth > 0) return original.exec(ref, command, opts);
      prunePreparedTasks();
      const policy = await detectPolicy(ref);
      if (policy.required) {
        const sessionId = String(opts?.work_session_id || '');
        const prepared = preparedTasks.get(sessionId);
        const preparedForProject = preparedMatchesProject(prepared, ref, policy.inspect);
        const primed = projectIsPrimed(ref, policy.inspect?.project?.id, policy.inspect?.project?.name);
        if (!preparedForProject && !primed) throw requiredError(ref, 'exec');
      }
      return original.exec(ref, command, opts);
    };
  }

  return api;
}

function installSkillPolicyPatches() {
  const safety = require('./safety-tools');
  if (safety.__skillPolicyPatched) return;
  safety.__skillPolicyPatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function skillPolicySafeToolApi(...args) {
    return createSkillPolicyApi(previousCreate(...args));
  };
}

module.exports = {
  POLICY_TTL_MS,
  PRIME_TTL_MS,
  LEGACY_CONTEXT_TTL_MS,
  PREPARED_TASK_TTL_MS,
  SKILL_ENTRY,
  isWordPressBricksSkillEntry,
  isWordPressBricksSkillPath,
  mandatoryPolicyShape,
  createSkillPolicyApi,
  installSkillPolicyPatches
};
