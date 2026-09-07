const assert = require('assert/strict');
const {
  ftpResultFromCompletion,
  completionWithDeployStatus,
  createCompletionDeployPolicyApi
} = require('../core/completion-deploy-policy');

(async () => {
  const ftpOk = { ok:true, status:'completed', uploaded:['style.css'] };
  const completed = completionWithDeployStatus({ ok:true, status:'completed', session:{ ftp_deploy:ftpOk }, agent_contract:{ result:'done' } });
  assert.equal(completed.ok, true);
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.ftp_deploy, ftpOk);
  assert.deepEqual(ftpResultFromCompletion(completed), ftpOk);

  const ftpFailed = { ok:false, status:'failed', failures:[{ file:'style.css', error:'530 Login incorrect' }] };
  const failed = completionWithDeployStatus({ ok:true, status:'completed', session:{ ftp_deploy:ftpFailed }, agent_contract:{ result:'done' } });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'deploy_failed');
  assert.equal(failed.agent_contract.result, 'deploy_failed');
  assert.deepEqual(failed.ftp_deploy, ftpFailed);
  assert.match(failed.next_action, /FTP deploy chưa hoàn tất/);

  const noFtp = { ok:true, status:'completed', session:{} };
  assert.equal(completionWithDeployStatus(noFtp), noFtp, 'projects without FTP config must keep existing completion behavior');

  let calls = 0;
  const api = createCompletionDeployPolicyApi({
    completeTask:async () => {
      calls++;
      return { ok:true, status:'completed', session:{ ftp_deploy:ftpFailed }, agent_contract:{ result:'done' } };
    }
  });
  const wrapped = await api.completeTask('task-1');
  assert.equal(calls, 1);
  assert.equal(wrapped.status, 'deploy_failed');
  assert.equal(wrapped.ok, false);

  console.log('Completion deploy policy PASS: Fast Agent cannot report done when verified local changes fail FTP deploy.');
})().catch(error => { console.error(error); process.exit(1); });
