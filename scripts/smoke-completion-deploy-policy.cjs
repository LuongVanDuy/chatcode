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
  assert.match(failed.next_action, /không chạy lại.*full regression/i);

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

  let prepareCalls = 0;
  let lifecycleCompleteCalls = 0;
  const lifecycleApi = createCompletionDeployPolicyApi({
    prepareTask:async (project, request) => {
      prepareCalls++;
      return {
        ok:true,
        status:'ready',
        task_id:`${project}-task-${prepareCalls}`,
        request,
        task_card:{ execution:{ path:'DEEP', latency_guard:null } },
        agent_contract:{ guidance:[] }
      };
    },
    completeTask:async () => {
      lifecycleCompleteCalls++;
      return { ok:true, status:'completed', session:{}, agent_contract:{ result:'done' } };
    },
    rollbackWork:async () => ({ ok:true, status:'rolled_back' })
  });

  const firstPrepare = await lifecycleApi.prepareTask('mimo.duyanhweb.org', 'Migrate persisted Bricks classes');
  assert.equal(firstPrepare.task_id, 'mimo.duyanhweb.org-task-1');
  assert.equal(firstPrepare.recovery_budget.corrective_patch_round_limit, 1, 'DEEP/high-risk task must also be bounded');
  assert.ok(firstPrepare.agent_contract.guidance.some(line => /Mọi coding task đều dùng bounded flow/.test(line)));

  const repeatedPrepare = await lifecycleApi.prepareTask('mimo.duyanhweb.org', 'Runtime still shows old classes; diagnose again');
  assert.equal(repeatedPrepare.status, 'active_task_reused');
  assert.equal(repeatedPrepare.task_id, firstPrepare.task_id);
  assert.equal(repeatedPrepare.reused_active_task, true);
  assert.equal(prepareCalls, 1, 'repeated prepare on one active project must not open another work session');
  assert.match(repeatedPrepare.next_action, /Không mở work session mới/);

  const otherProject = await lifecycleApi.prepareTask('longkhai.com', 'Build a section');
  assert.equal(otherProject.task_id, 'longkhai.com-task-2');
  assert.equal(prepareCalls, 2, 'different project can still prepare concurrently');

  await lifecycleApi.completeTask(firstPrepare.task_id, 'patch');
  assert.equal(lifecycleCompleteCalls, 1);
  const afterComplete = await lifecycleApi.prepareTask('mimo.duyanhweb.org', 'New user task after completion');
  assert.equal(afterComplete.task_id, 'mimo.duyanhweb.org-task-3');
  assert.equal(prepareCalls, 3, 'completed task must release project prepare lock');

  let recoveryCalls = 0;
  let rolledBack = false;
  const recoveryApi = createCompletionDeployPolicyApi({
    prepareTask:async () => ({
      ok:true,
      status:'ready',
      task_id:'bounded-1',
      task_card:{ execution:{ latency_guard:null } },
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

  const reusedExhausted = await recoveryApi.prepareTask('p1', 'Prepare again after corrective failure');
  assert.equal(reusedExhausted.status, 'active_task_reused');
  assert.equal(reusedExhausted.task_id, 'bounded-1');
  assert.match(reusedExhausted.next_action, /hết recovery budget/);

  await assert.rejects(
    recoveryApi.completeTask('bounded-1', 'patch-3'),
    error => error?.code === 'TASK_SCOPE_VIOLATION' && /Recovery budget/.test(error.message)
  );
  assert.equal(recoveryCalls, 2, 'third pass must be blocked before mutation');

  await recoveryApi.rollbackWork('bounded-1');
  assert.equal(rolledBack, true);

  console.log('Completion deploy policy PASS: all coding tasks are bounded and repeated prepare reuses the active task instead of opening a new session.');
})().catch(error => { console.error(error); process.exit(1); });