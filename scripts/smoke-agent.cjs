const assert = require('assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { createStore } = require('../core/store');
const { createBackupService } = require('../core/backups');

function git(cwd, args) { return execFileSync('git', args, { cwd, windowsHide:true, encoding:'utf8' }); }

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatcode-agent-'));
  const root = path.join(temp, 'workspace');
  const userData = path.join(temp, 'user-data');
  await fsp.mkdir(path.join(root, 'src'), { recursive:true });
  const baseline = `export function checkoutAddress(value) { return value.trim(); }\n`;
  await fsp.writeFile(path.join(root, 'src', 'app.js'), baseline, 'utf8');
  await fsp.writeFile(path.join(root, 'package.json'), JSON.stringify({ name:'agent-demo', scripts:{ test:'node -e "process.exit(0)"' }, dependencies:{ react:'^19.0.0' } }, null, 2), 'utf8');
  git(root, ['init']);
  git(root, ['config','user.email','chatcode@example.invalid']);
  git(root, ['config','user.name','ChatCode CI']);
  git(root, ['add','.']);
  git(root, ['commit','-m','baseline']);

  const app = { getPath(name) { if (name !== 'userData') throw new Error(`Unexpected path ${name}`); return userData; } };
  require('../core/runtime-bootstrap').installRuntimePatches();
  const { createProjectService } = require('../core/projects');
  const { createApprovalService } = require('../core/approvals');
  const { createSafeToolApi } = require('../core/safety-tools');

  const store = createStore(app, 47820);
  const state = store.ensure();
  state.projects = [{
    id:'agent', name:'Agent Project', root,
    permissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false },
    safety:store.normalizeSafety({
      write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow',
      _workspaceMode:'trusted', _allowSecrets:false,
      _safePermissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false }
    })
  }];
  state.settings.backupBeforeChanges = true;
  store.write(state);

  const projects = createProjectService(store);
  await projects.reindex('agent');
  const approvals = createApprovalService(store);
  const backups = createBackupService(app, store);
  const api = createSafeToolApi(projects, store, approvals, backups, { notifyTaskCompleted:() => ({ emitted:false, count:0, reason:'test' }) });

  assert.equal(typeof api.prepareTask, 'function');
  assert.equal(typeof api.completeTask, 'function');

  const originalInspect = api.inspectProject;
  api.inspectProject = async () => { throw new Error('inspection unavailable'); };
  const beforeFailedPrepare = api.listWorkSessions('agent').length;
  await assert.rejects(() => api.prepareTask('agent', 'Inspection failure'), /inspection unavailable/);
  assert.equal(api.listWorkSessions('agent').length, beforeFailedPrepare, 'failed inspection must not open a ghost session');
  api.inspectProject = originalInspect;

  // Normal coding task: exactly prepare -> complete, with no Git context.
  const prepared = await api.prepareTask('agent', 'Fix checkout address so null values do not crash', 8);
  const repeated = await Promise.all(Array.from({ length:3 }, () => api.prepareTask('agent', 'Fix checkout address so null values do not crash', 8)));
  assert.ok(repeated.every(r => r.task_id === prepared.task_id));
  assert.equal(api.listWorkSessions('agent').filter(s => s.status === 'active').length, 1);
  assert.equal(prepared.status, 'ready');
  assert.ok(prepared.task_id);
  assert.equal(prepared.agent_contract.preferred_calls, 2);
  assert.equal(prepared.baseline.git, null, 'prepare_task must not inspect Git by default');
  assert.equal(prepared.context.git, null, 'normal Agent context must omit Git state');
  assert.equal(prepared.baseline.brain, null, 'prepare_task should reuse inspection Brain context instead of duplicating it in baseline');
  assert.deepEqual(prepared.project_rules, []);
  assert.equal(prepared.context.primary_language, 'JavaScript');
  assert.ok(prepared.context.relevant_files.some(item => item.path === 'src/app.js' && /checkoutAddress/.test(item.content)), 'prepare_task must include relevant source content');
  assert.ok(prepared.verification_hints.some(item => item.command === 'npm run test'), 'prepare_task should expose package-script verification hint');

  const patch = [
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,1 +1,1 @@',
    '-export function checkoutAddress(value) { return value.trim(); }',
    '+export function checkoutAddress(value) { return String(value ?? "").trim(); }',
    ''
  ].join('\n');
  const verify = `node -e "const fs=require('fs');process.exit(fs.readFileSync('src/app.js','utf8').includes('String(value')?0:1)"`;
  const completed = await api.completeTask(prepared.task_id, patch, [verify]);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.verification_passed, true);
  assert.equal(completed.agent_contract.completed_in_call, 2);
  assert.ok(completed.changed_files.includes('src/app.js'));
  assert.equal(completed.git, null, 'complete_task must not inspect Git by default');
  assert.equal((await api.workStatus(prepared.task_id)).status, 'completed');

  const firstRollback = await api.rollbackWork(prepared.task_id);
  assert.equal(firstRollback.ok, true);
  assert.equal(await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8'), baseline);
  assert.equal(git(root, ['status','--porcelain']).trim(), '');

  const replanning = await api.prepareTask('agent', 'Update src/app.js', 6);
  const replanned = await api.prepareTask('agent', 'Fix src/app.js using newly identified dependency', 6, { taskId:replanning.task_id });
  assert.equal(replanned.task_id, replanning.task_id, 're-plan must preserve baseline and session id');
  const originalRequestRetry = await api.prepareTask('agent', 'Update src/app.js', 6);
  assert.equal(originalRequestRetry.task_id, replanned.task_id);
  assert.deepEqual(originalRequestRetry.task_card, replanned.task_card, 'old request must reuse the latest contract after re-plan');
  const stoppedWork = await api.finishWork(replanned.task_id, [], { cancel:true });
  assert.equal(stoppedWork.status, 'cancelled');
  assert.equal(await fsp.readFile(path.join(root, 'src/app.js'), 'utf8'), baseline);

  const verifyOnly = await api.startWork('agent', 'Failed finish can be corrected');
  const failedFinish = await api.finishWork(verifyOnly.work_session_id, ['node -e "process.exit(1)"']);
  assert.equal(failedFinish.ok, false);
  assert.equal((await api.workStatus(verifyOnly.work_session_id)).status, 'active');
  assert.ok(api.projectScope('agent').active_work_session_ids.includes(verifyOnly.work_session_id));
  await api.finishWork(verifyOnly.work_session_id, [], { cancel:true });

  // Verification failure stays active and can be corrected with the same task id.
  const repair = await api.prepareTask('agent', 'Change checkout normalization and verify behavior', 6);
  const firstAttemptPatch = [
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,1 +1,1 @@',
    '-export function checkoutAddress(value) { return value.trim(); }',
    '+export function checkoutAddress(value) { return String(value).trim(); }',
    ''
  ].join('\n');
  const failed = await api.completeTask(repair.task_id, firstAttemptPatch, [`node -e "process.exit(1)"`]);
  assert.equal(failed.status, 'needs_fix');
  assert.equal(failed.verification_passed, false);
  assert.equal((await api.workStatus(repair.task_id)).status, 'active');

  const correctivePatch = [
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,1 +1,1 @@',
    '-export function checkoutAddress(value) { return String(value).trim(); }',
    '+export function checkoutAddress(value) { return String(value ?? "").trim(); }',
    ''
  ].join('\n');
  const repaired = await api.completeTask(repair.task_id, correctivePatch, [verify]);
  assert.equal(repaired.status, 'completed');
  assert.equal(repaired.verification_passed, true);
  assert.ok((await api.workStatus(repair.task_id)).commands.length >= 2, 'verification attempts must stay linked to the work session');

  const secondRollback = await api.rollbackWork(repair.task_id);
  assert.equal(secondRollback.ok, true);
  assert.equal(await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8'), baseline);
  assert.equal(git(root, ['status','--porcelain']).trim(), '');

  // Omitted commands infer a real syntax check and explicit user decisions persist per project.
  const rememberedTask = await api.prepareTask('agent', 'Keep checkout normalization and remember the project convention', 6);
  const remembered = await api.completeTask(rememberedTask.task_id, firstAttemptPatch, [], {
    rememberProjectRules:[
      { key:'checkout-null-policy', value:'Normalize missing checkout values to an empty string.' },
      { key:'api-token', value:'must-not-persist' },
      { key:'live-url', value:'https://example.invalid/private' }
    ]
  });
  assert.equal(remembered.status, 'completed');
  assert.ok(remembered.verification.some(item => item.command === 'node --check "src/app.js"' && item.ok), 'changed JavaScript should receive an inferred syntax check');
  const persistedRules = store.getProject('agent').projectRules || [];
  assert.ok(persistedRules.some(item => item.key === 'checkout-null-policy'), 'confirmed rule must persist even when completion response keeps context relevant-only');
  assert.equal(persistedRules.some(item => item.key === 'api-token' || item.key === 'live-url'), false, 'secrets and URLs must not enter durable project memory');

  const recalled = await api.prepareTask('agent', 'Adjust the same checkout behavior', 6);
  assert.ok(recalled.project_rules.some(item => item.key === 'checkout-null-policy'), 'confirmed project rules must be returned by later relevant prepare_task calls');
  await api.rollbackWork(recalled.task_id);
  await api.rollbackWork(rememberedTask.task_id);
  assert.equal(await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8'), baseline);
  assert.equal(git(root, ['status','--porcelain']).trim(), '');

  // Optional rollback-on-failure should restore baseline immediately.
  const autoRollback = await api.prepareTask('agent', 'Try risky change with rollback on failed verification', 6);
  const rolled = await api.completeTask(autoRollback.task_id, firstAttemptPatch, [`node -e "process.exit(2)"`], { rollbackOnFailure:true });
  assert.equal(rolled.status, 'rolled_back');
  assert.equal(rolled.verification_passed, false);
  assert.equal(await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8'), baseline);
  assert.equal(git(root, ['status','--porcelain']).trim(), '');

  // A stop arriving at finalization must never turn into completed or deploy.
  const cancelAtFinish = await api.prepareTask('agent', 'Stop checkout update at finalization', 6);
  const realFinish = api.finishWork;
  api.finishWork = async (id, commands, options) => {
    if (id === cancelAtFinish.task_id && options?.reuseFinal) await realFinish(id, [], { cancel:true });
    return realFinish(id, commands, options);
  };
  const cancelledCompletion = await api.completeTask(cancelAtFinish.task_id, firstAttemptPatch, []);
  api.finishWork = realFinish;
  assert.equal(cancelledCompletion.status, 'cancelled');
  assert.equal(cancelledCompletion.ok, false);
  assert.match(await fsp.readFile(path.join(root, 'src/app.js'), 'utf8'), /String\(value\)/, 'stop preserves already applied edits');

  await api.shutdownTerminalJobs();
  approvals.shutdown();
  projects.shutdown();
  await fsp.rm(temp, { recursive:true, force:true });
  console.log('Fast Agent Path smoke test: PASS (2-call normal path + repair loop + rollback-on-failure + lazy Git)');
})().catch(error => { console.error(error); process.exit(1); });
