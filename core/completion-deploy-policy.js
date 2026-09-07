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
    next_action:'Thay đổi local đã verify nhưng FTP deploy chưa hoàn tất. Giữ nguyên file local, kiểm tra ftp_deploy và retry deploy; không báo task hoàn tất trên website.'
  };
}

function createCompletionDeployPolicyApi(api) {
  if (!api || typeof api.completeTask !== 'function' || api.__completionDeployPolicyWrapped) return api;
  api.__completionDeployPolicyWrapped = true;
  const originalComplete = api.completeTask.bind(api);
  api.completeTask = async (...args) => completionWithDeployStatus(await originalComplete(...args));
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
  ftpResultFromCompletion,
  completionWithDeployStatus,
  createCompletionDeployPolicyApi,
  installCompletionDeployPolicyPatches
};
