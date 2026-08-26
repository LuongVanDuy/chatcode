const assert = require('assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { createStore } = require('../core/store');
const { createProjectService } = require('../core/projects');
const { createApprovalService } = require('../core/approvals');
const { createBackupService } = require('../core/backups');
const { createSafeToolApi } = require('../core/safety-tools');

function run(command, args, cwd) { return new Promise((resolve, reject) => execFile(command, args, { cwd, windowsHide:true }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout))); }
async function waitFor(fn, timeout = 5000) { const started = Date.now(); while (Date.now() - started < timeout) { const value = fn(); if (value?.status === 'completed' || value?.status === 'failed' || value?.status === 'denied') return value; await new Promise(r => setTimeout(r, 40)); } throw new Error('Timed out waiting for fast-path job'); }

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatcode-fastpath-'));
  const root = path.join(dir, 'project'); await fsp.mkdir(path.join(root, 'src'), { recursive:true });
  await fsp.writeFile(path.join(root, 'package.json'), JSON.stringify({ name:'fast-demo', dependencies:{ react:'^19.0.0', vite:'^7.0.0' } }), 'utf8');
  await fsp.writeFile(path.join(root, 'src', 'app.js'), `export function checkoutAddress(value) { return value.trim(); }\n`, 'utf8');
  await run('git', ['init'], root); await run('git', ['config','user.email','ci@example.com'], root); await run('git', ['config','user.name','ChatCode CI'], root); await run('git', ['add','.'], root); await run('git', ['commit','-m','initial'], root);

  const app = { getPath: () => dir }; const store = createStore(app, 47820); const state = store.ensure();
  state.projects = [{ id:'p1', name:'fast-demo', root, permissions:{ write:true, manageFiles:true, tasks:true, gitWrite:true }, safety:{ write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow' } }]; store.write(state);
  const projects = createProjectService(store); await projects.reindex('p1');
  const approvals = createApprovalService(store); const backups = createBackupService(app, store); const safe = createSafeToolApi(projects, store, approvals, backups);

  const inspect = await safe.inspectProject('p1', 'fix checkout address issue', 6);
  assert.equal(inspect.ok, true); assert.equal(inspect.git.is_repository, true); assert.ok(inspect.relevant_files.some(x => x.path === 'src/app.js' && /checkoutAddress/.test(x.content)), 'inspect_project missing relevant content');
  assert.ok(inspect.telemetry.total_ms >= 0 && inspect.telemetry.brain_refresh_ms >= 0 && inspect.telemetry.git_ms >= 0, 'inspect telemetry missing');

  const apply = await safe.applyAndVerify('p1', [
    { op:'write', path:'src/chatcode-alpha.js', content:`export function chatcodeAdd(a,b){ return a+b; }\nexport const MARK='FASTPATH_OK';\n` },
    { op:'write', path:'src/chatcode-beta.js', content:`import { chatcodeAdd } from './chatcode-alpha.js';\nexport function run(){ return chatcodeAdd(20,22); }\n` }
  ], [`node -e "console.log('FASTPATH_TASK_OK')"`]);
  assert.equal(apply.status, 'completed'); assert.equal(apply.changes.length, 2); assert.equal(apply.tasks.length, 1); assert.match(apply.tasks[0].stdout, /FASTPATH_TASK_OK/); assert.equal(apply.tasks[0].notification_count, 1);
  assert.ok(apply.telemetry.write_to_searchable_ms >= 0 && apply.telemetry.brain_refresh_ms >= 0, 'apply telemetry missing');
  assert.match(apply.git_diff, /chatcode-alpha|chatcode-beta/);

  const symbols = await safe.findSymbols('p1', 'chatcodeAdd'); assert.ok(symbols.some(x => x.path === 'src/chatcode-alpha.js'), 'Brain did not refresh after fast write');
  const related = await safe.relatedFiles('p1', 'src/chatcode-alpha.js'); assert.ok(related.some(x => x.path === 'src/chatcode-beta.js'), 'dependency graph missing after fast write');

  const overwrite = await safe.applyAndVerify('p1', [{ op:'patch', path:'src/chatcode-alpha.js', edits:[{ find:'return a+b;', replace:'return Number(a)+Number(b);' }] }], []);
  assert.equal(overwrite.status, 'completed'); assert.equal(overwrite.changes[0].snapshot_created, true, 'overwrite snapshot missing'); assert.ok(overwrite.changes[0].snapshot_id, 'snapshot id missing');

  const nextState = store.read(); nextState.projects[0].safety.rename = 'ask'; store.write(nextState);
  const pending = await safe.applyAndVerify('p1', [{ op:'rename', from:'src/chatcode-beta.js', to:'src/chatcode-beta-renamed.js' }], []);
  assert.equal(pending.status, 'pending'); assert.equal(pending.approval.required, true); assert.equal(pending.approval.status, 'pending'); assert.ok(pending.approval.approval_ids.length === 1); assert.equal(approvals.list().length, 1);
  approvals.respond(approvals.list()[0].id, 'allow-once');
  const completed = await waitFor(() => safe.operationStatus(pending.job_id)); assert.equal(completed.status, 'completed');
  await fsp.stat(path.join(root, 'src', 'chatcode-beta-renamed.js')); await assert.rejects(() => fsp.stat(path.join(root, 'src', 'chatcode-beta.js')));

  const cleanupState = store.read(); cleanupState.projects[0].safety.delete = 'allow'; store.write(cleanupState);
  const cleanup = await safe.applyAndVerify('p1', [{ op:'delete', path:'src/chatcode-alpha.js' }, { op:'delete', path:'src/chatcode-beta-renamed.js' }], []);
  assert.equal(cleanup.status, 'completed'); assert.ok(cleanup.telemetry.delete_stale_cleanup_ms >= 0);
  const stale = await safe.findSymbols('p1', 'chatcodeAdd'); assert.equal(stale.length, 0, 'Brain stale symbol after delete');

  projects.shutdown(); approvals.shutdown(); await fsp.rm(dir, { recursive:true, force:true });
  console.log('Fast-path smoke passed: inspect/apply/patch/snapshot/pending approval/auto-resume/Brain refresh/task/diff OK');
})().catch(error => { console.error(error); process.exit(1); });