const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const { createStore } = require('../core/store');
const { createProjectService } = require('../core/projects');
const { createApprovalService } = require('../core/approvals');
const { createSafeToolApi } = require('../core/safety-tools');

const SAFE_ACTIONS = ['write','rename','delete','task','gitStage','gitCommit'];

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatcode-trusted-'));
  const userData = path.join(temp, 'user-data');
  const root = path.join(temp, 'workspace');
  await fsp.mkdir(root, { recursive:true });
  await fsp.writeFile(path.join(root, 'base.txt'), 'BASE', 'utf8');
  await fsp.writeFile(path.join(root, '.env'), 'SECRET=before', 'utf8');

  const app = { getPath(name) { if (name !== 'userData') throw new Error(`Unexpected path ${name}`); return userData; } };
  const store = createStore(app, 47820);
  const initial = store.ensure();
  initial.projects = [{
    id:'trusted-test', name:'Trusted Test', root,
    permissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false },
    safety:store.normalizeSafety({})
  }];
  store.write(initial);

  const projects = createProjectService(store);
  const approvals = createApprovalService(store);
  let snapshotCount = 0;
  const backups = {
    async snapshot(project, rel) { snapshotCount++; return { id:`snapshot-${snapshotCount}`, projectId:project.id, path:rel }; }
  };
  const api = createSafeToolApi(projects, store, approvals, backups, { notifyTaskCompleted:() => ({ emitted:false, count:0, reason:'test' }) });

  let denied = null;
  try { await api.writeFile('trusted-test', 'safe-blocked.txt', 'NO'); } catch (error) { denied = error; }
  assert.equal(denied?.code, 'PERMISSION_DENIED', 'Safe mode must keep existing permission enforcement.');

  let state = store.read();
  let project = state.projects[0];
  const savedPermissions = { ...project.permissions };
  const savedSafety = Object.fromEntries(SAFE_ACTIONS.map(action => [action, project.safety[action]]));
  project.safety = store.normalizeSafety({
    ...Object.fromEntries(SAFE_ACTIONS.map(action => [action, 'allow'])),
    _workspaceMode:'trusted', _allowSecrets:false,
    _safePermissions:savedPermissions, _safeSafety:savedSafety
  });
  store.write(state);

  project = store.getProject('trusted-test');
  assert.equal(project.workspaceMode, 'trusted');
  assert.deepEqual(project.permissions, { write:true, manageFiles:true, tasks:true, gitWrite:true });
  assert.deepEqual(project.safePermissions, savedPermissions, 'Safe permissions must survive Trusted mode.');

  const write = await api.writeFile('trusted-test', 'trusted.txt', 'TRUSTED_OK');
  assert.equal(write.ok, true);
  assert.equal(write.approval?.status, 'not_required');
  assert.equal(write.approval?.mode, 'trusted_workspace');
  assert.equal(approvals.list().length, 0, 'Trusted mutation must not enter Approval Center.');

  const task = await api.runTask('trusted-test', `node -e "console.log('TRUSTED_TASK_OK')"`);
  assert.equal(task.ok, true);
  assert.match(task.stdout, /TRUSTED_TASK_OK/);
  assert.equal(task.approval?.mode, 'trusted_workspace');
  assert.equal(approvals.list().length, 0);

  let secretBlocked = null;
  try { await api.readFile('trusted-test', '.env'); } catch (error) { secretBlocked = error; }
  assert.equal(secretBlocked?.code, 'SENSITIVE_PATH_BLOCKED', 'Secrets stay blocked until separately enabled.');

  state = store.read();
  state.projects[0].safety = store.normalizeSafety({ ...state.projects[0].safety, _workspaceMode:'trusted', _allowSecrets:true });
  store.write(state);
  project = store.getProject('trusted-test');
  assert.equal(project.trusted.allowSecrets, true);
  assert.equal((await api.readFile('trusted-test', '.env')).content, 'SECRET=before');
  const secretWrite = await api.writeFile('trusted-test', '.env', 'SECRET=after');
  assert.equal(secretWrite.ok, true);
  assert.equal(secretWrite.snapshot_created, true);
  assert.equal((await api.readFile('trusted-test', '.env')).content, 'SECRET=after');

  let traversal = null;
  try { await api.writeFile('trusted-test', '../outside.txt', 'NO'); } catch (error) { traversal = error; }
  assert.equal(traversal?.code, 'PATH_OUTSIDE_PROJECT', 'Trusted mode must never escape project root.');
  assert.equal(fs.existsSync(path.join(temp, 'outside.txt')), false);

  await api.renameFile('trusted-test', 'trusted.txt', 'trusted-renamed.txt');
  assert.equal(fs.existsSync(path.join(root, 'trusted-renamed.txt')), true);
  await api.deleteFile('trusted-test', 'trusted-renamed.txt');
  assert.equal(fs.existsSync(path.join(root, 'trusted-renamed.txt')), false);
  assert.equal(approvals.list().length, 0);
  assert.equal(typeof api.gitPush, 'undefined', 'Git push must remain unavailable in Trusted stage 1.');

  state = store.read();
  project = state.projects[0];
  project.safety = store.normalizeSafety({ ...project.safeSafety, _workspaceMode:'safe', _allowSecrets:false, _safePermissions:project.safePermissions, _safeSafety:project.safeSafety });
  project.permissions = { ...project.safePermissions };
  store.write(state);
  project = store.getProject('trusted-test');
  assert.equal(project.workspaceMode, 'safe');
  assert.deepEqual(project.permissions, savedPermissions);

  denied = null;
  try { await api.writeFile('trusted-test', 'safe-again.txt', 'NO'); } catch (error) { denied = error; }
  assert.equal(denied?.code, 'PERMISSION_DENIED', 'Returning to Safe must restore previous permission enforcement.');

  approvals.shutdown();
  projects.shutdown();
  await fsp.rm(temp, { recursive:true, force:true });
  console.log('Trusted Workspace smoke test: PASS');
})().catch(error => { console.error(error); process.exit(1); });
