const { chatError } = require('./errors');

const MAX_CORRECTIVE_PASSES = 1;
const MAX_DIAGNOSTIC_ROUNDS = 1;
const MAX_RECOVERY_TASKS = 200;

function ftpResultFromCompletion(result) {
  return result?.ftp_deploy || result?.session?.ftp_deploy || null;
}

function completionWithDeployStatus(result) {
  const ftp = ftpResultFromCompletion(result);
  if (!ftp) return result;
  const deployOk = ftp.ok === true && ftp.status !== 'failed';
  if (deployOk) return { ...result, ftp_deploy:ftp };
  return {
    ...result,
    ok:false,
    status:'deploy_failed',
    ftp_deploy:ftp,
    agent_contract:{ ...(result?.agent_contract || {}), result:'deploy_failed' },
    next_action:'Thay đổi local đã verify nhưng FTP deploy chưa hoàn tất. Báo đúng lỗi deploy; không prepare lại, patch source lại hoặc mở manual FTP sidequest.'
  };
}

function recoveryShape(state = {}) {
  const correctiveUsed = Math.max(0, Number(state.corrective_passes_used) || 0);
  const diagnosticUsed = Math.max(0, Number(state.diagnostic_rounds_used) || 0);
  return {
    diagnostic_round_limit:MAX_DIAGNOSTIC_ROUNDS,
    diagnostic_rounds_used:diagnosticUsed,
    diagnostic_rounds_remaining:Math.max(0, MAX_DIAGNOSTIC_ROUNDS - diagnosticUsed),
    diagnostic_open:!!state.diagnostic_open,
    corrective_patch_round_limit:MAX_CORRECTIVE_PASSES,
    corrective_patches_used:correctiveUsed,
    corrective_patches_remaining:Math.max(0, MAX_CORRECTIVE_PASSES - correctiveUsed),
    exhausted:!!state.exhausted,
    rule:'one task id; one initial completion; after concrete failure at most one scoped diagnostic and one corrective complete_task; then stop'
  };
}

function normalizeProjectKey(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanGuidance(lines = []) {
  return (Array.isArray(lines) ? lines : []).filter(line => !/\bDEEP\b/i.test(String(line || '')));
}

function createCompletionDeployPolicyApi(api) {
  if (!api || typeof api.completeTask !== 'function' || api.__completionDeployPolicyWrapped) return api;
  api.__completionDeployPolicyWrapped = true;

  const recovery = new Map();
  const activeByProject = new Map();
  const projectKeysByTask = new Map();
  const internalTasks = new Set();

  function remember(taskId, state) {
    const id = String(taskId || '');
    if (!id) return;
    recovery.set(id, state);
    while (recovery.size > MAX_RECOVERY_TASKS) {
      const oldest = recovery.keys().next().value;
      clearActive(oldest);
    }
  }

  function taskProjectKeys(rawRef, prepared = {}) {
    return new Set([
      normalizeProjectKey(rawRef),
      normalizeProjectKey(prepared?.project_id),
      normalizeProjectKey(prepared?.project),
      normalizeProjectKey(prepared?.context?.project?.id),
      normalizeProjectKey(prepared?.context?.project?.name)
    ].filter(Boolean));
  }

  function bindActive(taskId, rawRef, prepared) {
    const id = String(taskId || '');
    const keys = taskProjectKeys(rawRef, prepared);
    const snapshot = { task_id:id, prepared:{ ...prepared } };
    for (const key of keys) activeByProject.set(key, snapshot);
    projectKeysByTask.set(id, keys);
  }

  function clearActive(taskId) {
    const id = String(taskId || '');
    for (const key of projectKeysByTask.get(id) || []) {
      if (activeByProject.get(key)?.task_id === id) activeByProject.delete(key);
    }
    internalTasks.delete(id);
    projectKeysByTask.delete(id);
    recovery.delete(id);
  }

  function activeForProject(ref) {
    return activeByProject.get(normalizeProjectKey(ref)) || null;
  }

  function sidequestBlocked(method, ref) {
    const active = activeForProject(ref);
    if (!active || !recovery.has(active.task_id)) return null;
    if (internalTasks.has(active.task_id)) return { allowed:true, internal:true, active, state:recovery.get(active.task_id) };
    const state = recovery.get(active.task_id);
    if (method === 'exec' && state.diagnostic_open && state.diagnostic_rounds_used < MAX_DIAGNOSTIC_ROUNDS && !state.exhausted) {
      state.diagnostic_rounds_used += 1;
      state.diagnostic_open = false;
      remember(active.task_id, state);
      return { allowed:true, active, state };
    }
    return { allowed:false, active, state };
  }

  function installSidequestGate(method) {
    if (typeof api[method] !== 'function') return;
    const raw = api[method].bind(api);
    api[method] = async (ref, ...args) => {
      const gate = sidequestBlocked(method, ref);
      if (!gate || gate.allowed) return raw(ref, ...args);
      const state = gate.state;
      throw chatError('TASK_SCOPE_VIOLATION', `Low-level ${method} bị chặn vì project đang có bounded task active.`, {
        task_id:gate.active.task_id,
        recovery_budget:recoveryShape(state),
        next_action:state.exhausted
          ? 'STOP và báo failure hoặc rollback_work với cùng task_id.'
          : state.verification_failures > 0
            ? 'Dùng corrective complete_task với cùng task_id. Chỉ exec được mở đúng một lần khi diagnostic_open=true.'
            : 'Không sidequest trước completion. Gọi complete_task với cùng task_id; completion tự patch/verify/deploy changed files.'
      });
    };
  }

  if (typeof api.prepareTask === 'function') {
    const originalPrepare = api.prepareTask.bind(api);
    api.prepareTask = async (...args) => {
      const projectRef = args[0];
      const active = activeForProject(projectRef);
      if (active && recovery.has(active.task_id)) {
        const state = recovery.get(active.task_id);
        return {
          ...active.prepared,
          status:'active_task_reused',
          reused_active_task:true,
          requested_request:String(args[1] || '').trim(),
          recovery_budget:recoveryShape(state),
          next_action:state.exhausted
            ? 'Task hiện tại đã hết budget. Không prepare lại; báo failure hoặc rollback_work với cùng task_id.'
            : 'Không mở work session mới. Tiếp tục bằng complete_task với cùng task_id.',
          agent_contract:{
            ...(active.prepared?.agent_contract || {}),
            next_tool:state.exhausted ? 'rollback_work_or_report' : 'complete_task',
            guidance:[
              ...cleanGuidance(active.prepared?.agent_contract?.guidance),
              'Project đã có task active. prepare_task được reuse, không được tạo session/re-plan mới.'
            ]
          }
        };
      }

      const prepared = await originalPrepare(...args);
      if (prepared?.status !== 'ready' || !prepared?.task_id) return prepared;
      const id = String(prepared.task_id);
      const state = {
        verification_failures:0,
        diagnostic_rounds_used:0,
        diagnostic_open:false,
        corrective_passes_used:0,
        exhausted:false
      };
      remember(id, state);
      bindActive(id, projectRef, prepared);
      const guidance = cleanGuidance(prepared?.agent_contract?.guidance);
      return {
        ...prepared,
        recovery_budget:recoveryShape(state),
        agent_contract:{
          ...(prepared.agent_contract || {}),
          guidance:[
            ...guidance,
            'Mọi coding task dùng cùng một bounded flow. Risk/capability chỉ quyết định dữ liệu được phép chạm, không mở thêm execution mode.',
            'Không gọi prepare_task lần hai cho cùng task. complete_task sở hữu patch, scoped verify và configured changed-files deploy.',
            'Trước concrete failure: không manual exec/write/apply_patch/Git sidequest. Sau failure chỉ mở tối đa một scoped exec diagnostic và một corrective complete_task.',
            'PASS thì STOP ngay.'
          ]
        }
      };
    };
  }

  const originalComplete = api.completeTask.bind(api);
  api.completeTask = async (...args) => {
    const id = String(args[0] || '');
    const bounded = recovery.has(id);
    const state = bounded ? recovery.get(id) : null;

    if (bounded && state.exhausted) {
      throw chatError('TASK_SCOPE_VIOLATION', 'Recovery budget của task đã hết.', {
        task_id:id,
        recovery_budget:recoveryShape(state),
        next_action:'STOP. Báo concrete failure hoặc rollback_work; không prepare/exec/patch/deploy thêm.'
      });
    }

    const corrective = bounded && state.verification_failures > 0;
    if (corrective) {
      if (state.corrective_passes_used >= MAX_CORRECTIVE_PASSES) {
        state.exhausted = true;
        remember(id, state);
        throw chatError('TASK_SCOPE_VIOLATION', 'Corrective patch budget đã hết.', {
          task_id:id,
          recovery_budget:recoveryShape(state),
          next_action:'STOP và báo failure hoặc rollback_work.'
        });
      }
      state.corrective_passes_used += 1;
      state.diagnostic_open = false;
      remember(id, state);
    }

    let rawResult;
    if (bounded) internalTasks.add(id);
    try {
      rawResult = await originalComplete(...args);
    } catch (error) {
      if (!bounded) throw error;
      state.verification_failures += 1;
      state.diagnostic_open = state.diagnostic_rounds_used < MAX_DIAGNOSTIC_ROUNDS;
      if (corrective || state.corrective_passes_used >= MAX_CORRECTIVE_PASSES) {
        state.exhausted = true;
        state.diagnostic_open = false;
      }
      remember(id, state);
      if (error && typeof error === 'object') {
        error.details = {
          ...(error.details || {}),
          task_id:id,
          recovery_budget:recoveryShape(state),
          next_action:state.exhausted
            ? 'STOP. Corrective attempt also failed; report or rollback.'
            : 'Concrete completion failure recorded. Optionally use one scoped exec diagnostic, then one corrective complete_task with the same task_id.'
        };
      }
      throw error;
    } finally {
      if (bounded) internalTasks.delete(id);
    }

    const result = completionWithDeployStatus(rawResult);
    const status = String(rawResult?.status || result?.status || '');

    if (bounded && status === 'needs_fix') {
      state.verification_failures += 1;
      state.diagnostic_open = state.diagnostic_rounds_used < MAX_DIAGNOSTIC_ROUNDS;
      if (corrective || state.corrective_passes_used >= MAX_CORRECTIVE_PASSES) {
        state.exhausted = true;
        state.diagnostic_open = false;
      }
      remember(id, state);
      return state.exhausted
        ? {
            ...result,
            ok:false,
            status:'recovery_exhausted',
            recovery_budget:recoveryShape(state),
            next_action:'Corrective pass vẫn fail. STOP; báo concrete verification failure hoặc rollback_work.'
          }
        : {
            ...result,
            recovery_budget:recoveryShape(state),
            next_action:'Concrete failure. Nếu cần, dùng đúng một scoped exec diagnostic; sau đó một corrective complete_task với cùng task_id.'
          };
    }

    if (result?.status === 'deploy_failed') {
      state.exhausted = true;
      state.diagnostic_open = false;
      remember(id, state);
      return { ...result, recovery_budget:recoveryShape(state) };
    }

    if (['completed','rolled_back'].includes(status)) clearActive(id);
    return bounded ? { ...result, recovery_budget:recoveryShape(state) } : result;
  };

  if (typeof api.rollbackWork === 'function') {
    const originalRollback = api.rollbackWork.bind(api);
    api.rollbackWork = async (taskId, ...args) => {
      const id = String(taskId || '');
      internalTasks.add(id);
      try {
        const result = await originalRollback(taskId, ...args);
        clearActive(id);
        return result;
      } finally {
        internalTasks.delete(id);
      }
    };
  }

  // Hard sidequest gate. Reads/status remain available; mutation/terminal/Git paths
  // must go through complete_task while a prepared task is healthy.
  for (const method of ['exec','writeFile','deleteFile','renameFile','applyPatch','applyAndVerify','runTask','gitStage','gitCommit','gitStatus','gitDiff']) {
    installSidequestGate(method);
  }

  if (typeof api.startWork === 'function') {
    const originalStartWork = api.startWork.bind(api);
    api.startWork = async (ref, ...args) => {
      const active = activeForProject(ref);
      if (active && recovery.has(active.task_id)) {
        throw chatError('TASK_SCOPE_VIOLATION', 'Project đã có prepared task active; không được mở Work Session thứ hai.', {
          task_id:active.task_id,
          recovery_budget:recoveryShape(recovery.get(active.task_id)),
          next_action:'Reuse cùng task_id qua complete_task hoặc rollback_work.'
        });
      }
      return originalStartWork(ref, ...args);
    };
  }

  return api;
}

function installCompletionDeployPolicyPatches() {
  const safety = require('./safety-tools');
  if (safety.__completionDeployPolicyPatched) return;
  safety.__completionDeployPolicyPatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function completionDeployPolicySafeToolApi(...args) {
    return createCompletionDeployPolicyApi(previousCreate(...args));
  };
}

module.exports = {
  MAX_CORRECTIVE_PASSES,
  MAX_DIAGNOSTIC_ROUNDS,
  ftpResultFromCompletion,
  completionWithDeployStatus,
  recoveryShape,
  createCompletionDeployPolicyApi,
  installCompletionDeployPolicyPatches
};