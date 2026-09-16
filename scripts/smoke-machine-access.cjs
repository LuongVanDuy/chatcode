const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const { createStore } = require('../core/store');
const { createSupportService, installChildProcessAudit } = require('../core/support');
const { guardianStop, guardianResume, guardianSnapshot } = require('../core/machine-access');

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatcode-machine-'));
  const userData = path.join(temp, 'user-data');
  const root = path.join(temp, 'project');
  const outside = path.join(temp, 'outside');
  await fsp.mkdir(root, { recursive:true });
  await fsp.mkdir(outside, { recursive:true });
  await fsp.writeFile(path.join(root, 'inside.txt'), 'inside', 'utf8');
  await fsp.writeFile(path.join(outside, 'outside.txt'), 'outside', 'utf8');
  await fsp.writeFile(path.join(outside, '.env'), 'SECRET=machine', 'utf8');

  const app = { getPath(name) { if (name !== 'userData') throw new Error(`Unexpected path ${name}`); return userData; } };
  installChildProcessAudit(createSupportService(app));
  require('../core/runtime-bootstrap').installRuntimePatches();
  const { createProjectService } = require('../core/projects');
  const { createApprovalService } = require('../core/approvals');
  const { createSafeToolApi } = require('../core/safety-tools');

  const store = createStore(app, 47820);
  const state = store.ensure();
  state.projects = [{
    id:'machine-test', name:'Machine Test', root,
    permissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false },
    safety:store.normalizeSafety({
      _workspaceMode:'machine',
      _allowSecrets:true,
      _safePermissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false }
    })
  }];
  store.write(state);

  const project = store.getProject('machine-test');
  assert.equal(project.workspaceMode, 'machine');
  assert.deepEqual(project.permissions, { write:true, manageFiles:true, tasks:true, gitWrite:true });
  assert.equal(project.trusted.allowSecrets, true);

  const projects = createProjectService(store);
  const approvals = createApprovalService(store);
  const backups = { async snapshot() { return null; } };
  const api = createSafeToolApi(projects, store, approvals, backups, { notifyTaskCompleted:() => ({ emitted:false, count:0, reason:'test' }) });

  const listed = await api.listProjects();
  const exposed = listed.find(item => item.id === 'machine-test');
  assert.equal(exposed.full_machine_access, true);
  assert.equal(exposed.machine_scope, 'all_os_visible_filesystems');

  const outsidePath = path.join(outside, 'outside.txt');
  const read = await api.readFile('machine-test', outsidePath);
  assert.equal(read.content, 'outside');
  assert.equal(read.path, outsidePath);
  assert.equal((await api.readFile('machine-test', path.join(outside, '.env'))).content, 'SECRET=machine');

  const newOutside = path.join(outside, 'created.txt');
  const write = await api.writeFile('machine-test', newOutside, 'created');
  assert.equal(write.ok, true);
  assert.equal(write.approval?.mode, 'full_machine_access');
  assert.equal(await fsp.readFile(newOutside, 'utf8'), 'created');
  assert.equal(approvals.list().length, 0);

  const nested = path.join(outside, 'nested', 'renamed.txt');
  await api.renameFile('machine-test', newOutside, nested);
  assert.equal(fs.existsSync(nested), true);
  const files = await api.listFiles('machine-test', 100, outside);
  assert(files.some(file => path.resolve(file) === path.resolve(outsidePath)));
  assert(files.some(file => path.resolve(file) === path.resolve(nested)));
  const search = await api.search('machine-test', 'outside', outside);
  assert(search.some(item => path.resolve(item.path) === path.resolve(outsidePath)));

  guardianStop('smoke-test');
  assert.equal(guardianSnapshot().stopped, true);
  let stopped = null;
  try { await api.writeFile('machine-test', path.join(outside, 'blocked.txt'), 'no'); } catch (error) { stopped = error; }
  assert.equal(stopped?.code, 'GUARDIAN_STOPPED');
  assert.equal(fs.existsSync(path.join(outside, 'blocked.txt')), false);

  guardianResume();
  assert.equal(guardianSnapshot().stopped, false);
  await api.writeFile('machine-test', path.join(outside, 'after-resume.txt'), 'yes');
  assert.equal(fs.existsSync(path.join(outside, 'after-resume.txt')), true);

  const batchTarget = path.join(outside, 'batch.txt');
  const batch = await api.applyAndVerify('machine-test', [{ op:'write', path:batchTarget, content:'batch-ok' }], []);
  assert.equal(batch.ok, true);
  assert.equal(batch.workspace_mode, 'machine');
  assert.equal(batch.machine_scope, 'all_os_visible_filesystems');
  assert.equal(await fsp.readFile(batchTarget, 'utf8'), 'batch-ok');

  await api.deleteFile('machine-test', nested);
  assert.equal(fs.existsSync(nested), false);

  await api.shutdownTerminalJobs();
  approvals.shutdown();
  projects.shutdown();
  await fsp.rm(temp, { recursive:true, force:true });
  console.log('Full Machine Access smoke test: PASS');
})().catch(error => { console.error(error); process.exit(1); });
