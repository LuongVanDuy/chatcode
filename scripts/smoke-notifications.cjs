const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTaskLevelApi, applyTrustedProjectDefaults } = require('../core/task-policy');
const { createUsageService } = require('../core/usage');
const { createStore } = require('../core/store');

function counters(raw = {}) {
  const base = { calls:0, read:0, write:0, task:0, git:0, manage:0, other:0, errors:0, bytesIn:0, bytesOut:0, durationMs:0 };
  for (const key of Object.keys(base)) base[key] = Math.max(0, Number(raw[key]) || 0);
  return base;
}

async function testAuditDoesNotBecomeNotificationEvent() {
  let state = { projects:[{ id:'p1', name:'Demo' }], usage:{ total:counters(), daily:{}, recent:[] } };
  let callback = null;
  const store = {
    read:() => JSON.parse(JSON.stringify(state)),
    write:value => { state = JSON.parse(JSON.stringify(value)); },
    getProject:() => state.projects[0],
    emptyCounters:() => counters(),
    normalizeCounters:counters,
    normalizeUsage:raw => ({
      total:counters(raw?.total),
      daily:Object.fromEntries(Object.entries(raw?.daily || {}).map(([key,value]) => [key,counters(value)])),
      recent:Array.isArray(raw?.recent) ? raw.recent.slice() : []
    })
  };
  const usage = createUsageService(store, { onActivity:entry => { callback = entry; } });
  await usage.record({ tool:'exec', category:'task', projectId:'p1', target:'npm run build', ok:true, taskId:'task-1', workSessionId:'task-1', phase:'verify' });
  assert.equal(callback.category, 'task-audit', 'live task audit must not trigger main task notification');
  assert.equal(callback.taskId, 'task-1');
  assert.equal(callback.workSessionId, 'task-1');
  assert.equal(callback.phase, 'verify');
  const recent = usage.snapshot(1).recent[0];
  assert.equal(recent.category, 'task', 'persisted Activity category must stay task');
  assert.equal(recent.taskId, 'task-1', 'task trace id must survive persistence');
  assert.equal(recent.workSessionId, 'task-1', 'work session id must survive persistence');
  assert.equal(recent.phase, 'verify', 'task phase must survive persistence');
}

async function testTracePersistsThroughRealStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-usage-store-'));
  try {
    const app = { getPath:name => {
      assert.equal(name, 'userData');
      return dir;
    } };
    const store = createStore(app, 47820);
    store.ensure();
    const usage = createUsageService(store);
    await usage.record({ tool:'prepare_task', category:'task', target:'prepare', ok:true, taskId:'task-persist', workSessionId:'work-persist', phase:'prepare' });
    await usage.record({ tool:'exec', category:'task', target:'verify', ok:true, taskId:'task-2', workSessionId:'work-2', phase:'verify' });

    const reopened = createStore(app, 47820);
    const snapshot = createUsageService(reopened).snapshot(1);
    const first = snapshot.recent.find(item => item.taskId === 'task-persist');
    assert.ok(first, 'first activity must survive write/read normalization');
    assert.equal(first.workSessionId, 'work-persist');
    assert.equal(first.phase, 'prepare');
    assert.equal(snapshot.total.calls, 2, 'trace preservation must not change counters');

    const state = reopened.read();
    state.usage.recent.unshift({
      id:'long-trace', at:new Date().toISOString(), tool:'raw', category:'read', target:'fixture', ok:true,
      taskId:'t'.repeat(120), workSessionId:'w'.repeat(120), phase:'p'.repeat(80)
    });
    state.usage.recent.unshift({ id:'legacy-no-trace', at:new Date().toISOString(), tool:'legacy', category:'read', target:'legacy', ok:true });
    reopened.write(state);

    const finalStore = createStore(app, 47820);
    const finalState = finalStore.read();
    const long = finalState.usage.recent.find(item => item.id === 'long-trace');
    const legacy = finalState.usage.recent.find(item => item.id === 'legacy-no-trace');
    assert.equal(long.taskId.length, 80);
    assert.equal(long.workSessionId.length, 80);
    assert.equal(long.phase.length, 40);
    assert.ok(legacy, 'legacy activity without trace fields must remain readable');
    assert.equal('taskId' in legacy, false);
    assert.equal(finalState.usage.total.calls, 2, 'normalizing legacy/raw entries must not mutate counters');
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
}

async function testFastAgentOnlyNotifiesAtFinish() {
  const notifications = [];
  let status = 'active';
  const store = { getProject:() => ({ id:'p1', name:'Demo' }) };
  const api = {};
  api.runTask = async () => ({ ok:true, code:0, stdout:'ok', notification_emitted:false, notification_count:0 });
  api.workStatus = async () => ({ work_session_id:'s1', project:'Demo', project_id:'p1', goal:'Sửa checkout', status, changed_files:['checkout.php'] });
  api.finishWork = async () => {
    await api.runTask('p1', 'php -l checkout.php');
    status = 'completed';
    return { work_session_id:'s1', project:'Demo', project_id:'p1', goal:'Sửa checkout', status:'completed', changed_files:['checkout.php'] };
  };
  api.completeTask = async () => {
    await api.runTask('p1', 'npm run build');
    return api.finishWork('s1', []);
  };

  createTaskLevelApi(api, store, async payload => {
    notifications.push(payload);
    return { emitted:true, count:1, reason:'test' };
  });

  const done = await api.completeTask('s1');
  assert.equal(done.status, 'completed');
  assert.equal(notifications.length, 1, 'Fast Agent task must emit exactly one notification');
  assert.equal(notifications[0].command, 'Sửa checkout');
  assert.equal(notifications[0].changedFiles, 1);

  await api.finishWork('s1', []);
  assert.equal(notifications.length, 1, 're-reading/finishing completed session must not notify again');

  await api.runTask('p1', 'npm test');
  assert.equal(notifications.length, 2, 'standalone run_task is one standalone job and may notify once');
}

async function testNeedsFixDoesNotNotify() {
  const notifications = [];
  const store = { getProject:() => ({ id:'p1', name:'Demo' }) };
  const api = {
    runTask:async () => ({ ok:false, code:1 }),
    completeTask:async () => ({ ok:false, status:'needs_fix', task_id:'s2' })
  };
  createTaskLevelApi(api, store, async payload => { notifications.push(payload); return { emitted:true, count:1 }; });
  const result = await api.completeTask('s2');
  assert.equal(result.status, 'needs_fix');
  assert.equal(notifications.length, 0, 'needs_fix is not a final task and must stay silent');
}

function testNewProjectDefaultsTrusted() {
  let state = { projects:[{ id:'new', name:'New Project', permissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false }, safety:{} }] };
  const full = { write:true, manageFiles:true, tasks:true, gitWrite:true };
  const store = {
    fullPermissions:full,
    defaultSafety:{ write:'allow', rename:'ask', delete:'ask', task:'ask', gitStage:'allow', gitCommit:'ask' },
    read:() => JSON.parse(JSON.stringify(state)),
    write:value => { state = JSON.parse(JSON.stringify(value)); },
    normalizeSafety:raw => ({ ...raw, write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow' }),
    getProject:id => state.projects.find(project => project.id === id)
  };
  const project = applyTrustedProjectDefaults(store, 'new');
  assert.deepEqual(project.permissions, full);
  assert.equal(project.safety._workspaceMode, 'trusted');
  assert.equal(project.safety._allowSecrets, false, 'secrets remain explicit opt-in');
  assert.deepEqual(project.safety._safePermissions, full);
}

function testUiWiring() {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const currentRuntime = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'current-runtime.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'v102-runtime.js'), 'utf8');
  assert.match(preload, /current-runtime\.js/, 'preload must load the single current renderer entrypoint');
  assert.doesNotMatch(preload, /v102-runtime\.js/, 'preload must not directly own compatibility runtimes');
  assert.match(currentRuntime, /v102-runtime\.js/, 'current renderer compatibility boundary must retain v102 behavior');
  assert.match(runtime, /Mỗi yêu cầu ChatGPT tối đa một thông báo/);
  assert.match(runtime, /Trusted Workspace/);
}

(async () => {
  await testAuditDoesNotBecomeNotificationEvent();
  await testTracePersistsThroughRealStore();
  await testFastAgentOnlyNotifiesAtFinish();
  await testNeedsFixDoesNotNotify();
  testNewProjectDefaultsTrusted();
  testUiWiring();
  console.log('Task-level notification smoke passed: one task → one final notification; trace metadata survives real store normalization; new projects default Trusted/full.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
