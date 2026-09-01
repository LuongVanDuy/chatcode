const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const preload = read('preload.js');
const runtime = read('renderer/current-runtime.js');
const v08 = read('renderer/v08-runtime.js');
const v10 = read('renderer/v10-runtime.js');
const v10css = read('renderer/v10.css');
const css = read('renderer/ui-foundation.css');

assert.ok(preload.includes("await load('current-runtime.js', 'current-runtime')"), 'preload must load the current renderer entrypoint');
for (const legacy of ['v07-runtime.js','v08-runtime.js','v081-runtime.js','v09-runtime.js','v091-runtime.js','v10-runtime.js','v10-stage3.js','v10-stage4.js','v102-runtime.js']) {
  assert.equal(preload.includes(legacy), false, `preload must not directly know legacy runtime ${legacy}`);
  assert.ok(runtime.includes(`'${legacy}'`), `current runtime must retain compatibility module ${legacy} until it is proven removable`);
}
assert.ok(runtime.includes("foundation: 'ui-foundation.css'"));
assert.ok(runtime.includes("new CustomEvent('chatcode:renderer-ready'"));
assert.ok(runtime.includes('stage: 3'), 'current renderer must expose UI stage 3');
assert.ok(runtime.includes("document.body.dataset.uiStage = '3'"), 'Stage 3 chrome must mark the document');
assert.ok(runtime.includes("icon_system: 'lucide'"), 'current renderer must expose Lucide as the chrome icon system');
for (const icon of ['panels-top-left','plug-zap','activity','settings','folder-plus','stethoscope','clipboard-copy','refresh-cw','trash-2','search','play','git-branch','file-diff']) {
  assert.ok(runtime.includes(`'${icon}'`), `Stage 3 missing Lucide icon ${icon}`);
}

for (const token of ['--ui-bg:','--ui-sidebar:','--ui-surface:','--ui-text:','--ui-muted:','--ui-border:','--ui-accent:','--ui-radius-md:','--ui-font:']) {
  assert.ok(css.includes(token), `UI foundation missing ${token}`);
}
assert.ok(css.includes('color-scheme:dark'));
assert.ok(css.includes('--shadow:var(--ui-shadow)'));
assert.ok(css.includes('.sidebar{width:250px'), 'Stage 3 must keep compact desktop sidebar');
assert.ok(css.includes('.topbar{height:62px'), 'Stage 3 must use a compact 62px topbar');
assert.ok(css.includes('.topbar .eyebrow{display:none}'), 'topbar must not repeat eyebrow labels');
assert.ok(css.includes('/* Dashboard: system overview, not KPI-card wall. */'));
assert.ok(css.includes('.kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:0'), 'dashboard metrics must be a flat strip');
assert.ok(css.includes('#route-activity .page>.card{padding:4px 8px!important'), 'activity foundation must remain flat');
assert.ok(css.includes('.setting input[type=checkbox]{appearance:none;width:32px;height:18px'), 'foundation must retain compact toggle baseline');
assert.ok(css.includes('/* Project workspace: editor-like hierarchy. */'));
assert.ok(css.includes('.project-page>.tabs{position:sticky'), 'project tabs must stay available while scrolling');
assert.ok(css.includes('@media(max-width:820px){.sidebar{width:64px'), 'narrow windows must collapse sidebar to an icon rail');
assert.ok(css.includes('@media(prefers-contrast:more)'));
assert.ok(css.includes(':focus-visible'));
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
assert.equal(/https?:\/\//i.test(css), false, 'UI foundation must not depend on remote fonts/assets');

// 1.0.11 cleanup contract: keep backend capabilities, remove redundant desktop surfaces.
assert.ok(runtime.includes("document.getElementById('v07SafetyNav')?.remove()"), 'Safety Center must not remain a sidebar route');
assert.ok(runtime.includes("panel.id = 'settingsSafetyPanel'"), 'Safety controls must live inside Settings');
assert.ok(runtime.includes('#route-dashboard .two-col>article:has(#dashboardActivity)'), 'dashboard recent activity card must be hidden');
assert.ok(runtime.includes('#route-dashboard article:has(#dashboardProjects)'), 'dashboard shared project card must be hidden');
assert.ok(runtime.includes('[data-project-tab="files"],[data-project-tab="search"]'), 'Files/Search tabs must be removed from desktop navigation');
assert.ok(runtime.includes('#project-tab-overview .two-col>article:has(#indexDetails)'), 'duplicate Project Index card must be hidden');
assert.ok(runtime.includes('.settings-safety-panel .safety-summary'), 'Safety cards must inherit dark desktop surfaces');
assert.equal(v08.includes('insertAdjacentHTML'), false, 'Project Brain must stay headless and not remount a card');

// Post-1.0.11 polish: permissions, switches and logs must use the current dark workspace language.
assert.ok(runtime.includes("revision: 'permissions-log-polish'"));
assert.ok(runtime.includes('#project-tab-permissions>.two-col{display:grid;grid-template-columns:minmax(260px,.88fr)'), 'permissions must use a single bounded two-column surface');
assert.ok(runtime.includes('.v10-mode-option{min-height:70px!important'), 'Safe/Trusted mode options must not inherit white legacy cards');
assert.ok(runtime.includes('.safety-rules-card .safety-rule-grid{display:grid!important'), 'Safety rules must render as one compact grid');
assert.ok(runtime.includes("details.id = 'uiPermissionAdvanced'"), 'Terminal/Work Session/Fast Agent must be grouped under Advanced tools');
assert.ok(runtime.includes("['v10TerminalRuntime', 'v10WorkSessions', 'v10FastAgentPath']"), 'all advanced permission cards must be grouped together');
assert.ok(runtime.includes('#route-settings .setting input[type="checkbox"]::after'), 'settings switches must draw a deterministic thumb');
assert.ok(runtime.includes('translateX(16px)'), 'settings switch thumb must move explicitly when checked');
assert.ok(runtime.includes('.activity-list,.support-events{background:#18191b!important'), 'Activity and Support logs must share neutral dark surfaces');
assert.ok(runtime.includes('.code,.v10-job-output,.v103-detail{background:#17181a!important'), 'Task/Git/Terminal/Work Session logs must share neutral dark surfaces');
assert.equal(runtime.includes('#fff 0%,#f7faff'), false, 'current polish must not introduce legacy white gradients');

// 1.0.13 hotfix: permissions must obey the project tab state and mode changes must stay in place.
assert.ok(v10css.includes('.project-tab#project-tab-permissions:not(.active){display:none!important}'), 'inactive Permissions tab must stay hidden');
assert.ok(v10css.includes('.project-tab#project-tab-permissions.active{display:flex!important}'), 'active Permissions tab must use its polished flex layout');
assert.equal(v10.includes('location.reload()'), false, 'Safe/Trusted mode changes must not reload the renderer');
assert.ok(v10.includes('await render();\n    await refreshTerminalJobs();'), 'workspace mode changes must refresh in place');

console.log('Renderer foundation PASS: Stage 3 workspace + permissions/log polish + tab-state hotfix');
