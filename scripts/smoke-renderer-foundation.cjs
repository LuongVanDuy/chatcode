const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const preload = read('preload.js');
const runtime = read('renderer/current-runtime.js');
const browser = read('renderer/browser-workspace.js');
const v08 = read('renderer/v08-runtime.js');
const v09 = read('renderer/v09-runtime.js');
const v10 = read('renderer/v10-runtime.js');
const v10css = read('renderer/v10.css');
const css = read('renderer/ui-foundation.css');
const app = read('renderer/app.js');
const html = read('renderer/index.html');

assert.ok(preload.includes("await load('current-runtime.js', 'current-runtime')"));
assert.ok(preload.includes("await load('browser-workspace.js', 'browser-workspace')"));
for (const legacy of ['v07-runtime.js','v08-runtime.js','v081-runtime.js','v09-runtime.js','v091-runtime.js','v10-runtime.js','v10-stage3.js','v10-stage4.js','v102-runtime.js']) {
  assert.equal(preload.includes(legacy), false, `preload must not directly know legacy runtime ${legacy}`);
  assert.ok(runtime.includes(`'${legacy}'`), `current runtime must retain compatibility module ${legacy}`);
}
assert.ok(browser.includes("route.id = 'route-browser'"));
assert.ok(browser.includes("button.dataset.route = 'browser'"));
assert.ok(browser.includes("api.browserSetVisible(active)"));
assert.ok(runtime.includes("foundation: 'ui-foundation.css'"));
assert.ok(runtime.includes("document.body.dataset.uiStage = '3'"));
assert.ok(runtime.includes("new CustomEvent('chatcode:renderer-ready'"));

// v1.0.43 full Codex visual grammar: terminal hierarchy, not card-wall desktop UI.
for (const token of [
  '--ui-bg:#1a1a1a', '--ui-input:#353535', '--ui-text:#ededed', '--ui-muted:#7a7a7a',
  '--ui-border:#3a3a3a', '--ui-accent:#5cc2e0', '--ui-model:#f6e2b7', '--ui-cwd:#abdfa7',
  '--ui-success:#4ea96f', '--ui-warning:#e0af68', '--ui-danger:#f7768e'
]) assert.ok(css.includes(token), `missing Codex token ${token}`);
assert.ok(css.includes('--ui-font:"Cascadia Code"'), 'Codex UI must be mono-first');
assert.ok(css.includes('.sidebar{width:210px'), 'Codex shell must use narrow text navigation');
assert.ok(css.includes('body[data-ui-stage="3"] .topbar{display:none!important}'), 'desktop app topbar must be retired in Codex shell');
assert.ok(css.includes('.brand:before{content:">_"'), 'brand must use Codex launch marker');
assert.ok(css.includes('.nav-link:before{content:"›"'), 'navigation must use command selection marker');
assert.ok(css.includes('.project-item.active:before{content:"›"'), 'active project must use Codex selection marker');
assert.ok(css.includes('body[data-ui-stage="3"] .card'), 'legacy cards must be flattened by the current UI stage');
assert.ok(css.includes('body[data-ui-stage="3"] .health-grid{display:flex!important;flex-direction:column!important'), 'health must render as terminal rows, not metric cards');
assert.ok(css.includes('.hero:before{content:">_"'), 'dashboard must use launch-block grammar');
assert.ok(css.includes('.connection-banner:before{content:">_"'), 'connection surface must use launch-block grammar');
assert.ok(css.includes('.project-head:before{content:">_"'), 'project surface must use launch-block grammar');
assert.ok(css.includes('.tabs button.active:before{color:var(--ui-text)}'), 'active project command must expose ›');
assert.ok(css.includes('.activity-icon:before{content:"•"'), 'activity must use Codex exec bullet');
assert.ok(css.includes('.activity-row strong{color:var(--ui-accent)'), 'activity command text must use Codex cyan');
assert.ok(css.includes('.preset-grid{counter-reset:codexPreset'), 'permissions must use numbered Codex chooser rows');
assert.ok(css.includes('.preset-grid button:after{content:counter(codexPreset) "."'), 'permissions must render numeric choices');
assert.ok(css.includes('@keyframes codex-working-shine'), 'progress feedback must use Codex Working shimmer');
assert.ok(css.includes('.status-button.progress span{background:linear-gradient'), 'progress status must use grayscale shimmer');
assert.ok(css.includes('.browser-tab.active:before{color:var(--ui-text)}'), 'Browser Workspace must share Codex tab selection grammar');
assert.ok(css.includes('.browser-address{height:29px!important'), 'Browser address field must use compact terminal toolbar');
assert.equal(/https?:\/\//i.test(css), false, 'renderer must not depend on remote assets');
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
assert.ok(css.includes(':focus-visible'));

// v1.0.41 UI slimming contract remains intact.
for (const retired of ['data-route="activity"','id="route-activity"','id="modeQuick"','id="quickFields"','data-project-tab="tasks"','data-project-tab="git"','id="project-tab-tasks"','id="project-tab-git"','id="usageChart"','id="dashboardActivity"']) {
  assert.equal(html.includes(retired), false, `retired UI surface must not return: ${retired}`);
}
for (const retiredBinding of ["$('modeQuick')","$('taskButton')","$('gitStatusButton')","$('gitDiffButton')","$('activityFilter')","$('clearActivity')"]) {
  assert.equal(app.includes(retiredBinding), false, `retired UI binding must not return: ${retiredBinding}`);
}
assert.ok(app.includes("mode:'custom'"), 'connection UI must save only custom-domain mode');
assert.equal(v09.includes('supportJournal'), false, 'Support Journal panel must remain retired');
assert.equal(v09.includes('saveSupportNote'), false, 'Support Journal actions must remain retired');
for (const preservedCapability of ['runTask:', 'gitStatus:', 'gitDiff:', 'supportEvents:', 'usageSnapshot:']) {
  assert.ok(preload.includes(preservedCapability), `core bridge capability must remain available: ${preservedCapability}`);
}

// Renderer-only redesign must not disturb compatibility behavior.
assert.ok(runtime.includes("document.getElementById('v07SafetyNav')?.remove()"));
assert.ok(runtime.includes("panel.id = 'settingsSafetyPanel'"));
assert.ok(runtime.includes('[data-project-tab="files"],[data-project-tab="search"]'));
assert.equal(v08.includes('insertAdjacentHTML'), false, 'Project Brain must stay headless');
assert.ok(runtime.includes("details.id = 'uiPermissionAdvanced'"));
assert.ok(runtime.includes("['v10TerminalRuntime', 'v10WorkSessions', 'v10FastAgentPath']"));
assert.ok(v10css.includes('.project-tab#project-tab-permissions:not(.active){display:none!important}'));
assert.ok(v10css.includes('.project-tab#project-tab-permissions.active{display:flex!important}'));
assert.equal(v10.includes('location.reload()'), false, 'workspace mode changes must not reload renderer');
assert.ok(v10.includes('await render();\n    await refreshTerminalJobs();'));

function projectFlowSource() {
  const wanted = new Set(['selectProject','setProjectTab','loadProjectOverview']);
  return app.split(/\r?\n/).filter(line => {
    const match = line.match(/^(?:async\s+)?function\s+(\w+)/);
    return match && wanted.has(match[1]);
  }).join('\n');
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function projectHarness(apiOverrides = {}) {
  const calls = { index:[], git:[], renderedIndex:[], renderedGit:[], activity:0, files:0, routes:[] };
  const state = { projects:[{ id:'A', name:'A' }, { id:'B', name:'B' }], current:null, projectTab:'overview', index:new Map() };
  const context = {
    state,
    api:{
      projectIndexStatus:async id => { calls.index.push(id); return { id, fileCount:1 }; },
      gitStatus:async id => { calls.git.push(id); return { ok:true, stdout:id }; },
      ...apiOverrides
    },
    document:{ querySelectorAll:() => [] },
    renderProjectHeader:() => {},
    routeTo:route => { calls.routes.push(route); },
    loadFiles:async () => { calls.files++; },
    renderProjectIndex:idx => { calls.renderedIndex.push(idx.id); },
    renderGitSummary:git => { calls.renderedGit.push(git.stdout); },
    renderProjectActivity:() => { calls.activity++; },
    toast:error => { throw new Error(String(error)); },
    console, Promise, Map
  };
  vm.createContext(context);
  vm.runInContext(projectFlowSource(), context);
  return { context, state, calls };
}
async function testProjectOverviewSingleLoad() {
  const h = projectHarness();
  await h.context.selectProject('A');
  assert.deepEqual(h.calls.index, ['A']);
  assert.deepEqual(h.calls.git, ['A']);
  assert.deepEqual(h.calls.renderedIndex, ['A']);
  assert.deepEqual(h.calls.renderedGit, ['A']);
  assert.deepEqual(h.calls.routes, ['project']);
  await h.context.setProjectTab('files');
  assert.equal(h.calls.files, 1);
  await h.context.setProjectTab('overview');
  assert.deepEqual(h.calls.index, ['A','A']);
  assert.deepEqual(h.calls.git, ['A','A']);
}
async function testProjectOverviewRaceGuard() {
  const index = { A:deferred(), B:deferred() };
  const git = { A:deferred(), B:deferred() };
  const h = projectHarness({
    projectIndexStatus:id => { h.calls.index.push(id); return index[id].promise; },
    gitStatus:id => { h.calls.git.push(id); return git[id].promise; }
  });
  const selectingA = h.context.selectProject('A');
  await Promise.resolve();
  const selectingB = h.context.selectProject('B');
  await Promise.resolve();
  index.B.resolve({ id:'B', fileCount:2 }); git.B.resolve({ ok:true, stdout:'B' }); await selectingB;
  index.A.resolve({ id:'A', fileCount:1 }); git.A.resolve({ ok:true, stdout:'A' }); await selectingA;
  assert.equal(h.state.current.id, 'B');
  assert.deepEqual(h.calls.renderedIndex, ['B']);
  assert.deepEqual(h.calls.renderedGit, ['B']);
  assert.equal(h.state.index.get('B')?.id, 'B');
  assert.equal(h.state.index.has('A'), false);
}

(async () => {
  await testProjectOverviewSingleLoad();
  await testProjectOverviewRaceGuard();
  console.log('Renderer foundation PASS: full Codex terminal workspace + v1.0.41 behavior baseline.');
})().catch(error => { console.error(error); process.exitCode = 1; });
