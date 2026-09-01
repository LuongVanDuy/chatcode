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
assert.ok(runtime.includes('stage: 2'), 'current renderer must expose UI stage 2');
assert.ok(runtime.includes("icon_system: 'lucide'"), 'current renderer must expose Lucide as the chrome icon system');
for (const icon of ['panels-top-left','plug-zap','activity','settings','folder-plus','refresh-cw','trash-2']) {
  assert.ok(runtime.includes(`'${icon}'`), `Stage 2 missing Lucide icon ${icon}`);
}
assert.ok(runtime.includes("document.body.dataset.uiStage = '2'"), 'Stage 2 chrome must mark the document');

for (const token of ['--ui-bg:','--ui-sidebar:','--ui-surface:','--ui-text:','--ui-muted:','--ui-border:','--ui-accent:','--ui-radius-md:','--ui-font:']) {
  assert.ok(css.includes(token), `UI foundation missing ${token}`);
}
assert.ok(css.includes('color-scheme:dark'));
assert.ok(css.includes('--shadow:var(--ui-shadow)'));
assert.ok(css.includes('.sidebar{width:250px'), 'Stage 2 must use compact 250px sidebar');
assert.ok(css.includes('.topbar{height:64px'), 'Stage 2 must use compact 64px topbar');
assert.ok(css.includes('.topbar .eyebrow{display:none}'), 'Stage 2 app shell must remove redundant topbar eyebrow');
assert.ok(css.includes('/* Tabs become editor-style navigation rather than pills. */'));
assert.ok(css.includes('.tabs button.active{background:transparent'), 'Stage 2 active tabs must be flat editor-style tabs');
assert.ok(css.includes(':focus-visible'));
assert.ok(css.includes('@media (prefers-reduced-motion:reduce)'));
assert.equal(/https?:\/\//i.test(css), false, 'UI foundation must not depend on remote fonts/assets');

console.log('Renderer foundation PASS: single entrypoint + Stage 2 compact shell + Lucide chrome + dark neutral component system');
