const assert = require('assert/strict');
const {
  ftpResultFromCompletion,
  completionWithDeployStatus,
  createCompletionDeployPolicyApi
} = require('../core/completion-deploy-policy');

(async () => {
  const ftpOk = { ok:true, status:'completed', uploaded:['style.css'] };
  const completed = completionWithDeployStatus({ ok:true, status:'completed', session:{ ftp_deploy:ftpOk } });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(ftpResultFromCompletion(completed), ftpOk);

  const ftpFailed = { ok:false, status:'failed', failures:[{ file:'style.css', error:'530 Login incorrect' }] };
  const failed = completionWithDeployStatus({ ok:true, status:'completed', session:{ ftp_deploy:ftpFailed } });
  assert.equal(failed.status, 'deploy_failed');
  assert.equal(failed.ok, false);

  let prepareCalls = 0;
  let completeCalls = 0;
  let execCalls = 0;
  let patchCalls = 0;
  let rollbackCalls = 0;

  const api = createCompletionDeployPolicyApi({
    prepareTask:async (project, request) => {
      prepareCalls++;
      return {
        ok:true,
        status:'ready',
        task_id:`task-${prepareCalls}`,
        project_id:project,
        request,
        context:{ project:{ id:project, name:project } },
        task_card:{ execution:{ path:'BOUNDED', latency_guard:{ diagnostic_round_limit:1, corrective_patch_round_limit:1 } } },
        agent_contract:{ guidance:['legacy DEEP sentence must disappear'] }
      };
    },
    completeTask:async taskId => {
      completeCalls++;
      // Internal completion must be able to use gated low-level methods.
      await api.applyPatch('mimo.duyanhweb.org', 'internal');
      await api.exec('mimo.duyanhweb.org', 'internal verify');
      if (completeCalls <= 2) return { ok:false, status:'needs_fix', task_id:taskId };
      return { ok:true, status:'completed', task_id:taskId, session:{} };
    },
    applyPatch:async () => { patchCalls++; return { ok:true }; },
    exec:async () => { execCalls++; return { status:'completed', exit_code:0 }; },
    writeFile:async () => ({ ok:true }),
    gitStatus:async () => ({ ok:true }),
    startWork:async () => ({ work_session_id:'manual' }),
    rollbackWork:async () => { rollbackCalls++; return { ok:true, status:'rolled_back' }; }
  });

  const first = await api.prepareTask('mimo.duyanhweb.org', 'Migrate persisted Bricks classes');
  assert.equal(first.task_id, 'task-1');
  assert.equal(first.recovery_budget.corrective_patch_round_limit, 1);
  assert.ok(first.agent_contract.guidance.every(line => !/DEEP/i.test(line)), 'DEEP guidance must not leak to agent');

  const repeated = await api.prepareTask('mimo.duyanhweb.org', 'Runtime still shows old classes; diagnose again');
  assert.equal(repeated.status, 'active_task_reused');
  assert.equal(repeated.task_id, first.task_id);
  assert.equal(prepareCalls, 1, 'repeat prepare must not create another session');

  await assert.rejects(
    api.exec('mimo.duyanhweb.org', 'manual curl before completion'),
    error => error?.code === 'TASK_SCOPE_VIOLATION' && /Low-level exec/.test(error.message)
  );
  await assert.rejects(
    api.applyPatch('mimo.duyanhweb.org', 'manual patch'),
    error => error?.code === 'TASK_SCOPE_VIOLATION' && /Low-level applyPatch/.test(error.message)
  );
  await assert.rejects(
    api.startWork('mimo.duyanhweb.org', 'second session'),
    error => error?.code === 'TASK_SCOPE_VIOLATION' && /Work Session thứ hai/.test(error.message)
  );

  const firstFailure = await api.completeTask(first.task_id, 'patch-1');
  assert.equal(firstFailure.status, 'needs_fix');
  assert.equal(firstFailure.recovery_budget.diagnostic_open, true);
  assert.equal(patchCalls, 1, 'internal completion patch must bypass sidequest gate');
  assert.equal(execCalls, 1, 'internal completion verify must bypass sidequest gate');

  const diagnostic = await api.exec('mimo.duyanhweb.org', 'one scoped diagnostic');
  assert.equal(diagnostic.status, 'completed');
  assert.equal(execCalls, 2);
  await assert.rejects(
    api.exec('mimo.duyanhweb.org', 'second diagnostic'),
    error => error?.code === 'TASK_SCOPE_VIOLATION'
  );

  const correctiveFailure = await api.completeTask(first.task_id, 'patch-2');
  assert.equal(correctiveFailure.status, 'recovery_exhausted');
  assert.equal(correctiveFailure.recovery_budget.exhausted, true);
  assert.equal(completeCalls, 2, 'initial + one corrective only');

  const exhaustedPrepare = await api.prepareTask('mimo.duyanhweb.org', 'prepare again');
  assert.equal(exhaustedPrepare.status, 'active_task_reused');
  assert.match(exhaustedPrepare.next_action, /hết budget/);
  assert.equal(prepareCalls, 1);

  await assert.rejects(
    api.completeTask(first.task_id, 'patch-3'),
    error => error?.code === 'TASK_SCOPE_VIOLATION' && /Recovery budget/.test(error.message)
  );

  await api.rollbackWork(first.task_id);
  assert.equal(rollbackCalls, 1);
  const next = await api.prepareTask('mimo.duyanhweb.org', 'new user task');
  assert.equal(next.task_id, 'task-2', 'rollback must release active project lock');
  assert.equal(prepareCalls, 2);

  console.log('Completion policy PASS: one active task, hard sidequest gate, one diagnostic, one corrective pass, internal completion bypass.');
})().catch(error => { console.error(error); process.exit(1); });