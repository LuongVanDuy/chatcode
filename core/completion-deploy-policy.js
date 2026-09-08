const { chatError } = require('./errors');

const MAX_CORRECTIVE_PASSES = 1;
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
    next_action:'Thay đổi local đã verify nhưng FTP deploy chưa hoàn tất. Chỉ xử lý đúng lỗi ftp_deploy đã trả về; không chạy lại discovery, patch source hoặc full regression.'
  };
}

function recoveryShape(state = {}) {
  const correctiveUsed = Math.max(0, Number(state.corrective_passes_used) || 0);
  return {
    diagnostic_round_limit:1,
    corrective_patch_round_limit:MAX_CORRECTIVE_PASSES,
    corrective_patches_used:correctiveUsed,
    corrective_patches_remaining:Math.max(0, MAX_CORRECTIVE_PASSES - correctiveUsed),
    exhausted:!!state.exhausted,
    rule:'one scoped diagnostic only when concrete verification evidence requires it; then at most one corrective complete_task pass'
  };
}

function createCompletionDeployPolicyApi(api) {
  if (!api || typeof api.completeTask !== 'function' || api.__completionDeployPolicyWrapped) return api;
  api.__completionDeployPolicyWrapped = true;
  const recovery = new Map();

  function remember(taskId, state) {
    const id = String(taskId || '');
    if (!id) return;
    recovery.set(id, state);
    while (recovery.size > MAX_RECOVERY_TASKS) recovery.delete(recovery.keys().next().value);
  }

  if (typeof api.prepareTask === 'function') {
    const originalPrepare = api.prepareTask.bind(api);
    api.prepareTask = async (...args) => {
      const prepared = await originalPrepare(...args);
      if (prepared?.status !== 'ready' || !prepared?.task_id) return prepared;
      const id = String(prepared.task_id);
      const state = { verification_failures:0, corrective_passes_used:0, exhausted:false };
      remember(id, state);
      const bounded = !!prepared?.task_card?.execution?.latency_guard;
      return {
        ...prepared,
        recovery_budget:bounded ? recoveryShape(state) : null,
        agent_contract:{
          ...(prepared.agent_contract || {}),
          guidance:[
            ...(prepared?.agent_contract?.guidance || []),
            'complete_task finalization already owns configured changed-files-only FTP deploy. Do not run manual FTP/SFTP/curl upload while this task is healthy.',
            ...(bounded ? [
              'Bounded task flow: after a concrete verification failure, use at most one scoped diagnostic if needed and one corrective complete_task pass. Do not start broad browser/DB/Git/snapshot investigations.',
              'If scoped verification and configured deploy pass, STOP immediately. Do not add extra acceptance rounds just to be safe.'
            ] : [])
          ]
        }
      };
    };
  }

  const originalComplete = api.completeTask.bind(api);
  api.completeTask = async (...args) => {
    const id = String(args[0] || '');
    const state = recovery.get(id) || { verification_failures:0, corrective_passes_used:0, exhausted:false };
    const bounded = !!state && recovery.has(id);

    if (bounded && state.exhausted) {
      throw chatError('TASK_SCOPE_VIOLATION', 'Recovery budget của task đã hết. Không áp dụng thêm patch tự động.', {
        task_id:id,
        recovery_budget:recoveryShape(state),
        next_action:'Dừng sidequest. Báo failure hiện tại cho người dùng hoặc rollback_work; chỉ tạo task mới khi có yêu cầu/decision mới.'
      });
    }

    const corrective = bounded && state.verification_failures > 0;
    if (corrective) {
      if (state.corrective_passes_used >= MAX_CORRECTIVE_PASSES) {
        state.exhausted = true;
        remember(id, state);
        throw chatError('TASK_SCOPE_VIOLATION', 'Corrective patch budget đã hết. Không áp dụng patch tiếp theo.', {
          task_id:id,
          recovery_budget:recoveryShape(state),
          next_action:'Dừng task và báo concrete failure hoặc rollback_work. Không tiếp tục write_file/exec/manual FTP để vòng qua budget.'
        });
      }
      state.corrective_passes_used += 1;
      remember(id, state);
    }

    const rawResult = await originalComplete(...args);
    const result = completionWithDeployStatus(rawResult);
    const status = String(rawResult?.status || result?.status || '');

    if (bounded && status === 'needs_fix') {
      state.verification_failures += 1;
      if (corrective || state.corrective_passes_used >= MAX_CORRECTIVE_PASSES) state.exhausted = true;
      remember(id, state);
      if (state.exhausted) {
        return {
          ...result,
          ok:false,
          status:'recovery_exhausted',
          recovery_budget:recoveryShape(state),
          next_action:'Corrective pass vẫn fail. STOP: không diagnostic/patch/deploy thêm. Báo concrete verification failure cho người dùng hoặc rollback_work.'
        };
      }
      return {
        ...result,
        recovery_budget:recoveryShape(state),
        next_action:'Có concrete verification failure. Nếu cần, dùng đúng 1 scoped diagnostic để xác định nguyên nhân; sau đó dùng 1 corrective unified diff với cùng task_id. Không manual FTP/Git/browser/DB/snapshot sidequest.'
      };
    }

    if (['completed','rolled_back'].includes(status) || result?.status === 'deploy_failed') recovery.delete(id);
    return bounded ? { ...result, recovery_budget:recoveryShape(state) } : result;
  };

  if (typeof api.rollbackWork === 'function') {
    const originalRollback = api.rollbackWork.bind(api);
    api.rollbackWork = async (taskId, ...args) => {
      const result = await originalRollback(taskId, ...args);
      recovery.delete(String(taskId || ''));
      return result;
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
  ftpResultFromCompletion,
  completionWithDeployStatus,
  recoveryShape,
  createCompletionDeployPolicyApi,
  installCompletionDeployPolicyPatches
};