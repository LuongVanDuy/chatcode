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
  assert.doesNotMatch(failed.next_action, /full regression/i);

  const noFtp = { ok:true, status:'completed', session:{} };
  assert.equal(completionWithDeployStatus(noFtp), noFtp, 'projects without FTP config must keep existing completion behavior');

  let calls = 0;
  const deployApi = createCompletionDeployPolicyApi({
    completeTask:async () => {
      calls++;
      return { ok:true, status:'completed', session:{ ftp_deploy:ftpFailed }, agent_contract:{ result:'done' } };
    }
  });
  const wrapped = await deployApi.completeTask('task-1');
  assert.equal(calls, 1);
  assert.equal(wrapped.status, 'deploy_failed');
  assert.equal(wrapped.ok, false);

  let recoveryCalls = 0;
  let rolledBack = false;
  const recoveryApi = createCompletionDeployPolicyApi({
    prepareTask:async () => ({
      ok:true,
      status:'ready',
      task_id:'bounded-1',
      task_card:{ execution:{ latency_guard:{ diagnostic_round_limit:1, corrective_patch_round_limit:1 } } },
      agent_contract:{ guidance:[] }
    }),
    completeTask:async () => {
      recoveryCalls++;
      return { ok:false, status:'needs_fix', verification_passed:false, verification:[{ ok:false, command:'test' }] };
    },
    rollbackWork:async () => { rolledBack = true; return { ok:true, status:'rolled_back' }; }
  });

  const prepared = await recoveryApi.prepareTask('p1', 'Build a native Bricks page');
  assert.equal(prepared.recovery_budget.corrective_patch_round_limit, 1);
  assert.equal(prepared.recovery_budget.corrective_patches_remaining, 1);
  assert.ok(prepared.agent_contract.guidance.some(line => /complete_task finalization already owns configured changed-files-only FTP deploy/.test(line)));

  const firstFailure = await recoveryApi.completeTask('bounded-1', 'patch-1');
  assert.equal(firstFailure.status, 'needs_fix');
  assert.equal(firstFailure.recovery_budget.corrective_patches_remaining, 1);
  assert.match(firstFailure.next_action, /1 scoped diagnostic/);

  const correctiveFailure = await recoveryApi.completeTask('bounded-1', 'patch-2');
  assert.equal(correctiveFailure.status, 'recovery_exhausted');
  assert.equal(correctiveFailure.recovery_budget.corrective_patches_remaining, 0);
  assert.equal(correctiveFailure.recovery_budget.exhausted, true);
  assert.equal(recoveryCalls, 2, 'initial + one corrective pass only');

  await assert.rejects(
    recoveryApi.completeTask('bounded-1', 'patch-3'),
    error => error?.code === 'TASK_SCOPE_VIOLATION' && /Recovery budget/.test(error.message)
  );
  assert.equal(recoveryCalls, 2, 'third pass must be blocked before mutation');

  await recoveryApi.rollbackWork('bounded-1');
  assert.equal(rolledBack, true);

  console.log('Completion deploy policy PASS: deploy status is authoritative and bounded tasks allow only one corrective pass.');
})().catch(error => { console.error(error); process.exit(1); });