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

assert.ok(preload.includes("await load('current-runtime.js', 'current-runtime')"), 'preload must load the current renderer entrypoint');
assert.ok(preload.includes("await load('browser-workspace.js', 'browser-workspace')"), 'preload must load Browser Workspace after the current renderer entrypoint');
for (const legacy of ['v07-runtime.js','v08-runtime.js','v081-runtime.js','v09-runtime.js','v091-runtime.js','v10-runtime.js','v10-stage3.js','v10-stage4.js','v102-runtime.js']) {
  assert.equal(preload.includes(legacy), false, `preload must not directly know legacy runtime ${legacy}`);
  assert.ok(runtime.includes(`'${legacy}'`), `current runtime must retain compatibility module ${legacy} until it is proven removable`);
}
assert.ok(browser.includes("route.id = 'route-browser'"), 'Browser Workspace must mount as its own route');
assert.ok(browser.includes("button.dataset.route = 'browser'"), 'Browser Workspace must use the shared navigation route contract');
assert.ok(browser.includes("api.browserSetVisible(active)"), 'Browser Workspace must detach its native view when the route is inactive');
assert.ok(runtime.includes("foundation: 'ui-foundation.css'"));
assert.ok(runtime.includes("new CustomEvent('chatcode:renderer-ready'"));
assert.ok(runtime.includes('stage: 3'), 'current renderer must expose UI stage 3');
assert.ok(runtime.includes("document.body.dataset.uiStage = '3'"), 'Stage 3 chrome must mark the document');
assert.ok(runtime.includes("icon_system: 'lucide'"), 'current runtime must expose Lucide as the chrome icon system');
for (const icon of ['panels-top-left','plug-zap','activity','settings','folder-plus','stethoscope','clipboard-copy','refresh-cw','trash-2','search','play','git-branch','file-diff']) {
  assert.ok(runtime.includes(`'${icon}'`), `Stage 3 missing Lucide icon ${icon}`);
}

for (const token of ['--ui-bg:','--ui-sidebar:','--ui-surface:','--ui-text:','--ui-muted:','--ui-border:','--ui-accent:','--ui-radius-md:','--ui-font:']) {
  assert.ok(css.includes(token), `UI foundation missing ${token}`);
}
for (const target of [
  '--ui-bg:#191B20', '--ui-sidebar:#15171B', '--ui-surface:#20232A', '--ui-surface-2:#272B33',
  '--ui-surface-3:#303640', '--ui-active:#343D50', '--ui-text:#F2F4F8', '--ui-text-2:#C9D0DC',
  '--ui-muted:#A1ACBD', '--ui-faint:#A1ACBD', '--ui-border:#3E4654', '--ui-border-soft:#303640',
  '--ui-accent:#A9B8FF', '--ui-accent-strong:#C4CEFF', '--ui-success:#82D6A4', '--ui-warning:#F0C47A', '--ui-danger:#FF9C9C'
]) assert.ok(css.includes(target), `desktop readability token missing: ${target}`);
assert.ok(css.includes('color-scheme:dark'));
assert.ok(css.includes('--shadow:var(--ui-shadow)'));
assert.ok(css.includes('.sidebar{width:248px'), 'desktop sidebar must use the 248px baseline');
assert.ok(css.includes('@media(min-width:1100px) and (max-width:1279px){.sidebar{width:224px'), '1100-1279px shell must use the 224px sidebar');
assert.ok(css.includes('.topbar{height:68px'), 'desktop topbar must use the 68px readability baseline');
assert.ok(css.includes('.topbar h1{margin:0;color:var(--ui-text);font-size:20px;line-height:28px'), 'topbar page heading must remain readable');
assert.ok(css.includes('.nav-link{position:relative;min-height:40px'), 'navigation rows must provide a 40px hit area');
assert.ok(css.includes('font-size:14px;font-weight:500;cursor:pointer}.nav-link'), 'navigation labels must use the 14px desktop baseline');
assert.ok(css.includes('.project-item{width:100%;min-height:36px'), 'project rows must provide a 36px hit area');
assert.ok(css.includes('.setting strong{color:var(--ui-text-2);font-size:14px'), 'settings labels must be 14px');
assert.ok(css.includes('.setting span{margin-top:4px;color:var(--ui-muted);font-size:13px'), 'settings descriptions must be 13px');
assert.ok(css.includes('.project-title h2{display:block'), 'project header must show the project name');
assert.ok(css.includes('.code,.v103-detail{min-height:180px') && css.includes('font-size:13px;line-height:20px'), 'log/code baseline must be 13px/20px');
assert.ok(css.includes('.btn.primary{background:var(--ui-accent);border-color:var(--ui-accent);color:var(--ui-sidebar)'), 'primary buttons must use accent background with dark text');
assert.ok(css.includes('.topbar .eyebrow{display:none}'), 'topbar must not repeat eyebrow labels');
assert.ok(css.includes('/* Dashboard: system overview, not KPI-card wall. */'));
assert.ok(css.includes('.hero{padding:20px!important;border:1px solid var(--ui-border)!important'), 'dashboard hero must be a compact summary panel');
assert.ok(css.includes('.health-card span{color:var(--ui-muted);font-size:12px'), 'dashboard health labels must be at least 12px');
assert.ok(css.includes('.health-card strong{margin-top:3px;color:var(--ui-text);font-size:15px'), 'dashboard health values must use the 15px value size');
assert.ok(css.includes('.kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:0'), 'dashboard metrics must retain legacy style compatibility even when the surface is retired');
assert.ok(css.includes('#route-activity .page>.card{padding:4px 8px!important'), 'activity styles may remain for compatibility but the route itself is retired');
assert.ok(css.includes('.setting input[type=checkbox]{appearance:none;width:38px;height:22px'), 'foundation must retain a readable toggle baseline');
assert.ok(css.includes('/* Project workspace: editor-like hierarchy. */'));
assert.ok(css.includes('.project-page>.tabs{position:sticky'), 'project tabs must stay available while scrolling');
assert.ok(css.includes('@media(max-width:820px){.sidebar{width:64px'), 'narrow compatibility rule must remain bounded below the desktop window floor');
assert.ok(css.includes('@media(prefers-contrast:more)'));
assert.ok(css.includes(':focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}'));
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
assert.equal(/https?:\/\//i.test(css), false, 'UI foundation must not depend on remote fonts/assets');

// 1.0.11 cleanup contract: keep backend capabilities, remove redundant desktop surfaces.
assert.ok(runtime.includes("document.getElementById('v07SafetyNav')?.remove()"), 'Safety Center must not remain a sidebar route');
assert.ok(runtime.includes("panel.id = 'settingsSafetyPanel'"), 'Safety controls must live inside Settings');
assert.ok(runtime.includes('#route-dashboard .two-col>article:has(#dashboardActivity)'), 'dashboard recent activity compatibility rule may remain');
assert.ok(runtime.includes('#route-dashboard article:has(#dashboardProjects)'), 'dashboard shared project compatibility rule may remain');
assert.ok(runtime.includes('[data-project-tab="files"],[data-project-tab="search"]'), 'Files/Search tabs must be removed from desktop navigation');
assert.ok(runtime.includes('#project-tab-overview .two-col>article:has(#indexDetails)'), 'duplicate Project Index card must be hidden');
assert.ok(runtime.includes('.settings-safety-panel .safety-summary'), 'Safety cards must inherit dark desktop surfaces');
assert.equal(v08.includes('insertAdjacentHTML'), false, 'Project Brain must stay headless and not remount a card');

// v1.0.41 UI slimming: retire app-only surfaces while keeping ChatCode execution capabilities intact.
for (const retired of ['data-route="activity"','id="route-activity"','id="modeQuick"','id="quickFields"','data-project-tab="tasks"','data-project-tab="git"','id="project-tab-tasks"','id="project-tab-git"','id="usageChart"','id="dashboardActivity"']) {
  assert.equal(html.includes(retired), false, `retired UI surface must not remain: ${retired}`);
}
for (const retiredBinding of ["$('modeQuick')","$('taskButton')","$('gitStatusButton')","$('gitDiffButton')","$('activityFilter')","$('clearActivity')"]) {
  assert.equal(app.includes(retiredBinding), false, `retired UI binding must not remain: ${retiredBinding}`);
}
assert.ok(app.includes("mode:'custom'"), 'connection UI must save only custom-domain mode');
assert.equal(v09.includes('supportJournal'), false, 'Support Journal panel must not mount');
assert.equal(v09.includes('saveSupportNote'), false, 'Support Journal UI actions must be retired');
for (const preservedCapability of ['runTask:', 'gitStatus:', 'gitDiff:', 'supportEvents:', 'usageSnapshot:']) {
  assert.ok(preload.includes(preservedCapability), `core bridge capability must remain available: ${preservedCapability}`);
}

// Desktop readability polish: permissions, switches and logs keep behavior while using the shared visual system.
assert.ok(runtime.includes("revision: 'desktop-readability-polish'"));
assert.ok(runtime.includes('#route-connection>.page>.two-col{gap:24px'), 'connection columns must use the 24px desktop gap');
assert.ok(runtime.includes('#project-tab-permissions>.two-col{display:grid;grid-template-columns:minmax(260px,.88fr)'), 'permissions must use a single bounded two-column surface');
assert.ok(runtime.includes('.v10-mode-option{min-height:76px!important'), 'Safe/Trusted mode options must use the readable desktop control size');
assert.ok(runtime.includes('.v10-mode-option strong{color:var(--ui-text)!important;font-size:14px!important'), 'workspace mode labels must be readable');
assert.ok(runtime.includes('.v10-mode-option span{color:var(--ui-muted)!important;font-size:13px!important'), 'workspace mode descriptions must be readable');
assert.ok(runtime.includes('.safety-rules-card .safety-rule-grid{display:grid!important'), 'Safety rules must render as one compact grid');
assert.ok(runtime.includes("details.id = 'uiPermissionAdvanced'"), 'Terminal/Work Session/Fast Agent must be grouped under Advanced tools');
assert.ok(runtime.includes("['v10TerminalRuntime', 'v10WorkSessions', 'v10FastAgentPath']"), 'all advanced permission cards must be grouped together');
assert.ok(runtime.includes('#route-settings .setting input[type="checkbox"]::after'), 'settings switches must draw a deterministic thumb');
assert.ok(runtime.includes('translateX(18px)'), 'settings switch thumb must move explicitly when checked');
assert.ok(runtime.includes('aria-expanded="false" aria-controls="settingsSafetyPanel"'), 'Safety launcher must expose expansion semantics');
assert.ok(runtime.includes("panel.setAttribute('aria-hidden', 'true')"), 'Safety panel must expose hidden state semantics');
assert.ok(runtime.includes('.activity-list,.support-events{background:#17191E!important'), 'legacy log styles may remain without mounting retired app surfaces');
assert.ok(runtime.includes('.code,.v10-job-output,.v103-detail{background:#17191E!important'), 'Task/Git/Terminal/Work Session logs must share neutral dark surfaces');
assert.equal(runtime.includes('#fff 0%,#f7faff'), false, 'current polish must not introduce legacy white gradients');

// Browser chrome only: do not change browser session/bounds APIs, but keep tabs and controls readable and accessible.
for (const phrase of [
  '.browser-tabbar{height:40px;min-height:40px',
  '.browser-tab{min-width:120px;max-width:220px;height:34px',
  '.browser-tab-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;font-size:13px',
  '.browser-tab-close{width:28px;height:28px;min-width:28px',
  '.browser-tool{width:32px;height:32px;min-width:32px',
  '.browser-address{width:100%;height:32px!important;min-height:32px!important',
  '.browser-session-note{height:28px;min-height:28px'
]) assert.ok(browser.includes(phrase), `Browser chrome readability regression: ${phrase}`);
assert.ok(browser.includes('role="tablist" aria-label="Các tab trình duyệt"'), 'browser tab list needs an accessible name');
assert.ok(browser.includes("button.setAttribute('role', 'tab')"), 'browser tab selection must use button semantics');
assert.ok(browser.includes("button.setAttribute('aria-selected'"), 'browser active tab must expose selected state');
assert.ok(browser.includes("close.setAttribute('aria-label'"), 'browser close buttons need accessible names');
assert.ok(browser.includes('aria-label="Địa chỉ hoặc tìm kiếm"'), 'browser address field needs an accessible name');
assert.ok(browser.includes('id="browserStatus" role="status" aria-live="polite"'), 'browser status must use a polite live region');
assert.ok(browser.includes('event.stopPropagation()'), 'closing a tab must not activate it');
assert.ok(browser.includes('api.browserSetBounds({ x:rect.x, y:rect.y, width:rect.width, height:rect.height })'), 'browser bounds must still follow the viewport rectangle');

// 1.0.13 hotfix: permissions must obey the project tab state and mode changes must stay in place.
assert.ok(v10css.includes('.project-tab#project-tab-permissions:not(.active){display:none!important}'), 'inactive Permissions tab must stay hidden');
assert.ok(v10css.includes('.project-tab#project-tab-permissions.active{display:flex!important}'), 'active Permissions tab must use its polished flex layout');
assert.equal(v10.includes('location.reload()'), false, 'Safe/Trusted mode changes must not reload the renderer');
function hasRenderThenRefresh(source) {
  return /await render\(\);\r?\n\s+await refreshTerminalJobs\(\);/.test(String(source || ''));
}
assert.equal(hasRenderThenRefresh('await render();\n    await refreshTerminalJobs();'), true, 'LF sequence must pass');
assert.equal(hasRenderThenRefresh('await render();\r\n    await refreshTerminalJobs();'), true, 'CRLF sequence must pass');
assert.equal(hasRenderThenRefresh('await render();'), false, 'missing refresh must fail');
assert.ok(hasRenderThenRefresh(v10), 'workspace mode changes must refresh in place');

function projectFlowSource() {
  const wanted = new Set(['selectProject','setProjectTab','loadProjectOverview']);
  return app.split(/\r?\n/).filter(line => {
    const match = line.match(/^(?:async\s+)?function\s+(\w+)/);
    return match && wanted.has(match[1]);
  }).join('\n');
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

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
    console,
    Promise,
    Map
  };
  vm.createContext(context);
  vm.runInContext(projectFlowSource(), context);
  return { context, state, calls };
}

async function testProjectOverviewSingleLoad() {
  const h = projectHarness();
  await h.context.selectProject('A');
  assert.deepEqual(h.calls.index, ['A'], 'selectProject must request index once');
  assert.deepEqual(h.calls.git, ['A'], 'selectProject must request Git once');
  assert.deepEqual(h.calls.renderedIndex, ['A']);
  assert.deepEqual(h.calls.renderedGit, ['A']);
  assert.deepEqual(h.calls.routes, ['project']);

  await h.context.setProjectTab('files');
  assert.equal(h.calls.files, 1, 'Files tab must keep its existing load behavior');
  await h.context.setProjectTab('overview');
  assert.deepEqual(h.calls.index, ['A','A'], 'returning to Overview must load exactly once');
  assert.deepEqual(h.calls.git, ['A','A'], 'returning to Overview must load Git exactly once');
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
  index.B.resolve({ id:'B', fileCount:2 });
  git.B.resolve({ ok:true, stdout:'B' });
  await selectingB;
  index.A.resolve({ id:'A', fileCount:1 });
  git.A.resolve({ ok:true, stdout:'A' });
  await selectingA;
  assert.equal(h.state.current.id, 'B');
  assert.deepEqual(h.calls.renderedIndex, ['B'], 'late A index must not render into project B');
  assert.deepEqual(h.calls.renderedGit, ['B'], 'late A Git must not render into project B');
  assert.equal(h.state.index.get('B')?.id, 'B');
  assert.equal(h.state.index.has('A'), false, 'late A response must not mutate current overview state');
}

(async () => {
  await testProjectOverviewSingleLoad();
  await testProjectOverviewRaceGuard();
  console.log('Renderer foundation PASS: desktop readability + v1.0.41 UI slimming + browser chrome + single-load project overview.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
