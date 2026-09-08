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

function normalizeProjectKey(value) {
  return String(value || '').trim().toLowerCase();
}

function createCompletionDeployPolicyApi(api) {
  if (!api || typeof api.completeTask !== 'function' || api.__completionDeployPolicyWrapped) return api;
  api.__completionDeployPolicyWrapped = true;
  const recovery = new Map();
  const activeByProject = new Map();
  const projectByTask = new Map();

  function remember(taskId, state) {
    const id = String(taskId || '');
    if (!id) return;
    recovery.set(id, state);
    while (recovery.size > MAX_RECOVERY_TASKS) recovery.delete(recovery.keys().next().value);
  }

  function clearActive(taskId) {
    const id = String(taskId || '');
    const key = projectByTask.get(id);
    if (key && activeByProject.get(key)?.task_id === id) activeByProject.delete(key);
    projectByTask.delete(id);
    recovery.delete(id);
  }

  if (typeof api.prepareTask === 'function') {
    const originalPrepare = api.prepareTask.bind(api);
    api.prepareTask = async (...args) => {
      const projectKey = normalizeProjectKey(args[0]);
      const active = projectKey ? activeByProject.get(projectKey) : null;
      if (active && recovery.has(active.task_id)) {
        const state = recovery.get(active.task_id);
        return {
          ...active.prepared,
          status:'active_task_reused',
          reused_active_task:true,
          requested_request:String(args[1] || '').trim(),
          recovery_budget:recoveryShape(state),
          next_action:state?.exhausted
            ? 'Task hiện tại đã hết recovery budget. Không prepare lại. Báo failure hoặc rollback_work với cùng task_id.'
            : 'Project đang có task active. Không mở work session mới; tiếp tục bằng complete_task với cùng task_id, hoặc rollback_work nếu muốn hủy task cũ.',
          agent_contract:{
            ...(active.prepared?.agent_contract || {}),
            next_tool:state?.exhausted ? 'rollback_work_or_report' : 'complete_task',
            guidance:[
              ...(active.prepared?.agent_contract?.guidance || []),
              'prepare_task đã được gọi cho project này và task vẫn active. Không prepare/re-plan lại; reuse cùng task_id để tránh orchestration loop.'
            ]
          }
        };
      }

      const prepared = await originalPrepare(...args);
      if (prepared?.status !== 'ready' || !prepared?.task_id) return prepared;
      const id = String(prepared.task_id);
      const state = { verification_failures:0, corrective_passes_used:0, exhausted:false };
      remember(id, state);
      if (projectKey) {
        const stablePrepared = { ...prepared };
        activeByProject.set(projectKey, { task_id:id, prepared:stablePrepared });
        projectByTask.set(id, projectKey);
      }
      return {
        ...prepared,
        recovery_budget:recoveryShape(state),
        agent_contract:{
          ...(prepared.agent_contract || {}),
          guidance:[
            ...(prepared?.agent_contract?.guidance || []),
            'Mọi coding task đều dùng bounded flow, kể cả persisted data/production-risk work. Không có task nào được tự mở vòng orchestration vô hạn.',
            'complete_task finalization already owns configured changed-files-only FTP deploy. Do not run manual FTP/SFTP/curl upload while this task is healthy.',
            'Sau concrete verification failure, dùng tối đa một scoped diagnostic nếu thật sự cần rồi một corrective complete_task pass. Không mở broad browser/DB/Git/snapshot investigation.',
            'Nếu scoped verification và configured deploy PASS, STOP ngay. Không prepare lại hoặc thêm acceptance rounds chỉ để kiểm cho chắc.'
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
      throw chatError('TASK_SCOPE_VIOLATION', 'Recovery budget của task đã hết. Không áp dụng thêm patch tự động.', {
        task_id:id,
        recovery_budget:recoveryShape(state),
        next_action:'Dừng sidequest. Báo failure hiện tại cho người dùng hoặc rollback_work; chỉ tạo task mới sau khi task active đã kết thúc.'
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
          next_action:'Corrective pass vẫn fail. STOP: không diagnostic/patch/deploy/prepare thêm. Báo concrete verification failure hoặc rollback_work.'
        };
      }
      return {
        ...result,
        recovery_budget:recoveryShape(state),
        next_action:'Có concrete verification failure. Nếu cần, dùng đúng 1 scoped diagnostic để xác định nguyên nhân; sau đó dùng 1 corrective unified diff với cùng task_id. Không prepare lại, manual FTP, Git, browser, DB hoặc snapshot sidequest.'
      };
    }

    if (['completed','rolled_back'].includes(status) || result?.status === 'deploy_failed') clearActive(id);
    return bounded ? { ...result, recovery_budget:recoveryShape(state) } : result;
  };

  if (typeof api.rollbackWork === 'function') {
    const originalRollback = api.rollbackWork.bind(api);
    api.rollbackWork = async (taskId, ...args) => {
      const result = await originalRollback(taskId, ...args);
      clearActive(taskId);
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