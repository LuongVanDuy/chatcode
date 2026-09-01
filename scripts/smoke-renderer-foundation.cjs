const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const preload = read('preload.js');
const runtime = read('renderer/current-runtime.js');
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
assert.ok(css.includes('#route-activity .page>.card{padding:4px 8px!important'), 'activity must render as a flat log surface');
assert.ok(css.includes('.setting input[type=checkbox]{appearance:none;width:32px;height:18px'), 'settings must use compact native-like toggles');
assert.ok(css.includes('/* Project workspace: editor-like hierarchy. */'));
assert.ok(css.includes('.project-page>.tabs{position:sticky'), 'project tabs must stay available while scrolling');
assert.ok(css.includes('@media(max-width:820px){.sidebar{width:64px'), 'narrow windows must collapse sidebar to an icon rail');
assert.ok(css.includes('@media(prefers-contrast:more)'));
assert.ok(css.includes(':focus-visible'));
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
assert.equal(/https?:\/\//i.test(css), false, 'UI foundation must not depend on remote fonts/assets');

console.log('Renderer foundation PASS: single entrypoint + Stage 3 screen redesign + Lucide actions + responsive icon rail');
