const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { compareVersions, parseVersion } = require('../core/updater');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.deepEqual(parseVersion('v0.9.1'), [0, 9, 1]);
assert.equal(compareVersions('0.9.1', '0.9.0') > 0, true);
assert.equal(compareVersions('1.0.0', '0.9.99') > 0, true);
assert.equal(compareVersions('0.9.1', '0.9.1'), 0);
assert.equal(compareVersions('0.9.0', '0.9.1') < 0, true);

// package.json is the updater/release version source of truth. Documentation drift
// must not block a valid installer release.
assert.match(String(packageJson.version || ''), /^\d+\.\d+\.\d+$/, 'package.json must contain a semantic release version');

const v08Runtime = fs.readFileSync(path.join(root, 'renderer', 'v08-runtime.js'), 'utf8');
assert.equal(v08Runtime.includes('appInfo()'), false, 'v08 compatibility stub must not duplicate version refresh work');
assert.equal(v08Runtime.includes('addEventListener'), false, 'v08 compatibility stub must not install legacy UI listeners');
assert.equal(Buffer.byteLength(v08Runtime, 'utf8') < 512, true, 'v08 compatibility stub must stay minimal until the loader entry is removed');

const runtime = fs.readFileSync(path.join(root, 'renderer', 'v081-runtime.js'), 'utf8');
assert.equal(/textContent\s*=\s*['"]v0\.8['"]/.test(runtime), false, 'Sidebar version must never be hard-coded to v0.8');
assert.equal(runtime.includes('PROJECT BRAIN · V0.8'), false, 'Project Brain card must not show stale v0.8 label');
assert.equal(runtime.includes('18 MCP tools'), false, 'Project Brain card must not show stale MCP tool count');
assert.match(runtime, /textContent\s*=\s*`v\$\{info\.version\}`/, 'Sidebar version must come from appInfo.version');

console.log(`Updater/UI version smoke passed: ${packageJson.version} package source-of-truth + lean renderer version owner OK`);
