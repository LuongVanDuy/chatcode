const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { compareVersions, parseVersion } = require('../core/updater');

assert.deepEqual(parseVersion('v0.9.1'), [0, 9, 1]);
assert.equal(compareVersions('0.9.1', '0.9.0') > 0, true);
assert.equal(compareVersions('1.0.0', '0.9.99') > 0, true);
assert.equal(compareVersions('0.9.1', '0.9.1'), 0);
assert.equal(compareVersions('0.9.0', '0.9.1') < 0, true);

const runtime = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'v08-runtime.js'), 'utf8');
assert.equal(/badge\.textContent\s*=\s*['"]v0\.8['"]/.test(runtime), false, 'Sidebar version must never be hard-coded to v0.8');
assert.equal(runtime.includes('PROJECT BRAIN · V0.8'), false, 'Project Brain card must not show stale v0.8 label');
assert.equal(runtime.includes('18 MCP tools'), false, 'Project Brain card must not show stale MCP tool count');
assert.match(runtime, /badge\.textContent\s*=\s*`v\$\{info\.version\}`/, 'Sidebar version must come from appInfo.version');

console.log('Updater/UI version smoke passed: semantic comparison + dynamic sidebar version OK');
