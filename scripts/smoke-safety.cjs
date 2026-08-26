const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { createStore } = require('../core/store');
const { createApprovalService } = require('../core/approvals');
const { createBackupService } = require('../core/backups');
const { createSafeToolApi } = require('../core/safety-tools');

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatcode-safety-'));
  const app = { getPath: () => dir };
  const store = createStore(app, 47820);
  const projectRoot = path.join(dir, 'project');
  await fsp.mkdir(projectRoot);
  await fsp.writeFile(path.join(projectRoot, 'a.txt'), 'old', 'utf8');
  const state = store.ensure();
  state.projects = [{ id: 'p1', name: 'demo', root: projectRoot, permissions: { write: true, manageFiles: true, tasks: true, gitWrite: true }, safety: { write: 'ask', rename: 'ask', delete: 'ask', task: 'ask', gitStage: 'allow', gitCommit: 'ask' } }];
  store.write(state);

  const approvals = createApprovalService(store);
  const request = approvals.request('p1', 'write', { target: 'a.txt' });
  if (approvals.list().length !== 1) throw new Error('Approval queue failed');
  approvals.respond(approvals.list()[0].id, 'allow-once');
  await request;

  const backups = createBackupService(app, store);
  const snapshot = await backups.snapshot(store.getProject('p1'), 'a.txt', path.join(projectRoot, 'a.txt'), 'overwrite');
  await fsp.writeFile(path.join(projectRoot, 'a.txt'), 'new', 'utf8');
  await backups.restore(snapshot.id, async (project, rel) => path.join(project.root, rel));
  if (await fsp.readFile(path.join(projectRoot, 'a.txt'), 'utf8') !== 'old') throw new Error('Recovery restore failed');

  let writes = 0;
  const projects = {
    toolApi: {
      listProjects: () => [], listFiles: () => [], search: () => [], readFile: () => {}, readFiles: () => {},
      writeFile: async () => { writes++; return { ok: true }; }, deleteFile: async () => ({ ok: true }), renameFile: async () => ({ ok: true }),
      runTask: async () => ({ ok: true }), gitStatus: async () => ({ ok: true }), gitDiff: async () => ({ ok: true }), gitStage: async () => ({ ok: true }), gitCommit: async () => ({ ok: true }), recordActivity: () => {}
    },
    secureResolve: async (project, rel, options = {}) => { const target = path.join(project.root, rel); if (options.mustExist) await fsp.stat(target); return target; }
  };
  const safe = createSafeToolApi(projects, store, approvals, backups);
  const call = safe.writeFile('p1', 'a.txt', 'x');
  await new Promise(resolve => setTimeout(resolve, 20));
  if (approvals.list().length !== 1) throw new Error('Safe write did not request approval');
  approvals.respond(approvals.list()[0].id, 'allow-session');
  await call;
  await safe.writeFile('p1', 'a.txt', 'y');
  if (writes !== 2 || approvals.list().length) throw new Error('Session approval failed');

  await fsp.rm(dir, { recursive: true, force: true });
  console.log('Safety smoke test passed: approval/session/recovery checks OK');
})().catch(error => { console.error(error); process.exit(1); });
