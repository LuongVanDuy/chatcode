const assert = require('assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const { createStore } = require('../core/store');
const { createBackupService } = require('../core/backups');

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatcode-git-lazy-'));
  const root = path.join(temp, 'workspace');
  const userData = path.join(temp, 'user-data');
  await fsp.mkdir(path.join(root, 'src'), { recursive:true });
  const baseline = 'export const value = 1;\n';
  await fsp.writeFile(path.join(root, 'src', 'app.js'), baseline, 'utf8');
  await fsp.writeFile(path.join(root, 'package.json'), JSON.stringify({ name:'git-lazy-fixture' }, null, 2), 'utf8');

  const app = { getPath(name) { if (name !== 'userData') throw new Error(`Unexpected path ${name}`); return userData; } };
  require('../core/runtime-bootstrap').installRuntimePatches();
  const { createProjectService } = require('../core/projects');
  const { createApprovalService } = require('../core/approvals');
  const { createSafeToolApi } = require('../core/safety-tools');

  const store = createStore(app, 47820);
  const state = store.ensure();
  state.projects = [{
    id:'lazy', name:'Lazy Git Project', root,
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
  await projects.reindex('lazy');

  assert.equal(typeof projects.toolApi.gitStatusExplicit, 'function', 'real Git status must be preserved behind an explicit method');
  assert.equal(typeof projects.toolApi.gitDiffExplicit, 'function', 'real Git diff must be preserved behind an explicit method');
  const lazyStatus = await projects.toolApi.gitStatus('lazy');
  const lazyDiff = await projects.toolApi.gitDiff('lazy', false);
  assert.equal(lazyStatus.skipped, true);
  assert.equal(lazyDiff.skipped, true);
  assert.equal(lazyStatus.code, 'GIT_LAZY');

  let explicitCalls = 0;
  projects.toolApi.gitStatusExplicit = async project => {
    explicitCalls++;
    return { ok:true, code:0, stdout:`explicit-status:${project}`, stderr:'' };
  };
  projects.toolApi.gitDiffExplicit = async (project, staged = false) => {
    explicitCalls++;
    return { ok:true, code:0, stdout:`explicit-diff:${project}:${staged ? 'staged' : 'worktree'}`, stderr:'' };
  };

  const approvals = createApprovalService(store);
  const backups = createBackupService(app, store);
  const api = createSafeToolApi(projects, store, approvals, backups, { notifyTaskCompleted:() => ({ emitted:false, count:0, reason:'test' }) });

  const prepared = await api.prepareTask('lazy', 'Change the local JavaScript value from 1 to 2', 6);
  assert.equal(explicitCalls, 0, 'prepare_task must not reach explicit Git');
  assert.equal(prepared.baseline.git, null);
  assert.equal(prepared.context.git, null);

  const patch = [
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,1 +1,1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    ''
  ].join('\n');
  const completed = await api.completeTask(prepared.task_id, patch, []);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.git, null);
  assert.equal(explicitCalls, 0, 'complete_task/apply_patch/finish_work must not reach explicit Git');

  const status = await api.workStatus(prepared.task_id);
  assert.equal(status.current?.git ?? null, null);
  assert.equal(explicitCalls, 0, 'work_status must not reach explicit Git');

  const rolled = await api.rollbackWork(prepared.task_id);
  assert.equal(rolled.ok, true);
  assert.equal(rolled.final?.git ?? null, null);
  assert.equal(explicitCalls, 0, 'rollback_work must restore from session snapshots without explicit Git');
  assert.equal(await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8'), baseline);

  const legacyInspect = await api.inspectProject('lazy', 'Inspect JavaScript source only', 6);
  assert.equal(legacyInspect.git, null);
  assert.equal(explicitCalls, 0, 'inspect_project must not reach explicit Git');

  const explicitStatus = await api.gitStatusExplicit('lazy');
  const explicitDiff = await api.gitDiffExplicit('lazy', false);
  assert.equal(explicitCalls, 2, 'Git process boundary must activate only for explicit Git reads');
  assert.match(explicitStatus.stdout, /explicit-status:lazy/);
  assert.match(explicitDiff.stdout, /explicit-diff:lazy:worktree/);

  await api.shutdownTerminalJobs();
  approvals.shutdown();
  projects.shutdown();
  await fsp.rm(temp, { recursive:true, force:true });
  console.log('Git Lazy smoke test: PASS (normal workflow 0 explicit Git calls; explicit Git still available on demand)');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
