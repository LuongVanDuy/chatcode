const assert = require('assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { createStore } = require('../core/store');
const { createSupportService, installChildProcessAudit } = require('../core/support');
const { createBackupService } = require('../core/backups');
const { normalizeError } = require('../core/errors');

function git(cwd, args) { return execFileSync('git', args, { cwd, windowsHide:true, encoding:'utf8' }); }

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatcode-editing-'));
  const root = path.join(temp, 'workspace');
  const userData = path.join(temp, 'user-data');
  await fsp.mkdir(path.join(root, 'src'), { recursive:true });
  const baselineApp = "export function total(a, b) {\r\n  return a + b;\r\n}\r\n";
  await fsp.writeFile(path.join(root, 'src', 'app.js'), baselineApp, 'utf8');
  await fsp.writeFile(path.join(root, 'delete-me.txt'), 'DELETE_ME\n', 'utf8');
  git(root, ['init']);
  git(root, ['config','user.email','chatcode@example.invalid']);
  git(root, ['config','user.name','ChatCode CI']);
  git(root, ['add','.']);
  git(root, ['commit','-m','baseline']);

  const app = { getPath(name) { if (name !== 'userData') throw new Error(`Unexpected path ${name}`); return userData; } };
  installChildProcessAudit(createSupportService(app));
  require('../core/runtime-bootstrap').installRuntimePatches();
  const { createProjectService } = require('../core/projects');
  const { createApprovalService } = require('../core/approvals');
  const { createSafeToolApi } = require('../core/safety-tools');

  const store = createStore(app, 47820);
  const state = store.ensure();
  state.projects = [{
    id:'editing', name:'Editing Project', root,
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
  const approvals = createApprovalService(store);
  const backups = createBackupService(app, store);
  const api = createSafeToolApi(projects, store, approvals, backups, { notifyTaskCompleted:() => ({ emitted:false, count:0, reason:'test' }) });
  await projects.initialize();

  for (const name of ['startWork','applyPatch','workStatus','finishWork','rollbackWork']) assert.equal(typeof api[name], 'function', `${name} missing`);

  const session = await api.startWork('editing', 'Refactor total and add helper');
  assert.equal(session.status, 'active');
  assert.equal(session.baseline.git.is_repository, true);
  assert.equal(session.changed_files.length, 0);

  const patch = [
    'diff --git a/src/app.js b/src/app.js',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,3 +1,4 @@',
    ' export function total(a, b) {',
    '-  return a + b;',
    '+  const result = a + b;',
    '+  return result;',
    ' }',
    'diff --git a/src/new.js b/src/new.js',
    '--- /dev/null',
    '+++ b/src/new.js',
    '@@ -0,0 +1,2 @@',
    '+export function stageThreeCreated() {',
    '+  return "created";',
    'diff --git a/delete-me.txt b/delete-me.txt',
    '--- a/delete-me.txt',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-DELETE_ME',
    ''
  ].join('\n');

  const applied = await api.applyPatch('editing', patch, session.work_session_id);
  assert.equal(applied.ok, true);
  assert.equal(applied.files.length, 3);
  assert.equal(applied.files.find(x => x.path === 'src/app.js').operation, 'modify');
  assert.equal(applied.files.find(x => x.path === 'src/new.js').operation, 'create');
  assert.equal(applied.files.find(x => x.path === 'delete-me.txt').operation, 'delete');
  assert.ok(applied.recovery_points.length >= 2, 'Existing modified/deleted files should expose recovery snapshots when enabled.');
  assert.equal(fs.existsSync(path.join(root, 'delete-me.txt')), false);
  assert.equal(await fsp.readFile(path.join(root, 'src', 'new.js'), 'utf8'), 'export function stageThreeCreated() {\n  return "created";\n');
  const changedApp = await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8');
  assert.match(changedApp, /const result = a \+ b/);
  assert.ok(changedApp.includes('\r\n'), 'Unified patch must preserve CRLF of existing file.');

  const symbols = await api.findSymbols('editing', 'stageThreeCreated');
  assert.ok(symbols.some(x => x.name === 'stageThreeCreated'), 'Brain must see a symbol created by apply_patch immediately.');

  const terminal = await api.exec('editing', `node -e "console.log('SESSION_EXEC_OK')"`, { work_session_id:session.work_session_id });
  assert.equal(terminal.status, 'completed');
  const status = await api.workStatus(session.work_session_id);
  assert.ok(status.changed_files.includes('src/app.js'));
  assert.ok(status.changed_files.includes('src/new.js'));
  assert.ok(status.commands.some(x => String(x.command).includes('SESSION_EXEC_OK')), 'exec linked to work_session_id must be recorded.');
  assert.match(status.current.git.diff, /stageThreeCreated|const result/);

  const finished = await api.finishWork(session.work_session_id, [`node -e "process.exit(require('./src/app.js') ? 0 : 1)"`]);
  assert.equal(finished.verification_passed, true);
  assert.equal(finished.status, 'completed');
  assert.ok(finished.final.git.diff.length > 0);

  const rollback = await api.rollbackWork(session.work_session_id);
  assert.equal(rollback.ok, true, JSON.stringify(rollback.errors));
  assert.equal(await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8'), baselineApp);
  assert.equal(await fsp.readFile(path.join(root, 'delete-me.txt'), 'utf8'), 'DELETE_ME\n');
  assert.equal(fs.existsSync(path.join(root, 'src', 'new.js')), false);
  assert.equal(git(root, ['status','--porcelain']).trim(), '', 'Rollback must restore Git-clean baseline.');

  // Rollback remains available even when disk Recovery Snapshot is disabled.
  let nextState = store.read();
  nextState.settings.backupBeforeChanges = false;
  store.write(nextState);
  const noBackup = await api.startWork('editing', 'Rollback without global snapshots');
  const patchNoBackup = [
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,3 +1,3 @@',
    ' export function total(a, b) {',
    '-  return a + b;',
    '+  return a - b;',
    ' }',
    '--- /dev/null',
    '+++ b/src/temp-session.js',
    '@@ -0,0 +1,1 @@',
    '+export const temporaryStageThree = true;',
    ''
  ].join('\n');
  const noBackupApplied = await api.applyPatch('editing', patchNoBackup, noBackup.work_session_id);
  assert.equal(noBackupApplied.recovery_points.length, 0);
  const noBackupRollback = await api.rollbackWork(noBackup.work_session_id);
  assert.equal(noBackupRollback.ok, true);
  assert.equal(await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8'), baselineApp);
  assert.equal(fs.existsSync(path.join(root, 'src', 'temp-session.js')), false);
  assert.equal(git(root, ['status','--porcelain']).trim(), '');

  // Conflict must fail before any file is mutated.
  const conflictBefore = await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8');
  const badPatch = [
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,3 +1,3 @@',
    ' export function total(a, b) {',
    '-  return DOES_NOT_EXIST;',
    '+  return 0;',
    ' }',
    ''
  ].join('\n');
  await assert.rejects(() => api.applyPatch('editing', badPatch), error => normalizeError(error).code === 'PATCH_CONFLICT');
  assert.equal(await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8'), conflictBefore);

  await api.shutdownTerminalJobs();
  approvals.shutdown();
  projects.shutdown();
  await fsp.rm(temp, { recursive:true, force:true });
  console.log('Codex-style editing smoke test: PASS');
})().catch(error => { console.error(error); process.exit(1); });
