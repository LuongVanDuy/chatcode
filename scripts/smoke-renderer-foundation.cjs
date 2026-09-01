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

for (const token of ['--ui-bg:','--ui-sidebar:','--ui-surface:','--ui-text:','--ui-muted:','--ui-border:','--ui-accent:','--ui-radius-md:','--ui-font:']) {
  assert.ok(css.includes(token), `UI foundation missing ${token}`);
}
assert.ok(css.includes('color-scheme:dark'));
assert.ok(css.includes('--shadow:var(--ui-shadow)'));
assert.ok(css.includes(':focus-visible'));
assert.ok(css.includes('@media (prefers-reduced-motion:reduce)'));
assert.equal(/https?:\/\//i.test(css), false, 'UI foundation must not depend on remote fonts/assets');

console.log('Renderer foundation PASS: single preload entrypoint + compatibility boundary + dark neutral design tokens');
