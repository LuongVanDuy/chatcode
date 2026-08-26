const assert = require('assert/strict');
const { compareVersions, parseVersion } = require('../core/updater');

assert.deepEqual(parseVersion('v0.9.1'), [0, 9, 1]);
assert.equal(compareVersions('0.9.1', '0.9.0') > 0, true);
assert.equal(compareVersions('1.0.0', '0.9.99') > 0, true);
assert.equal(compareVersions('0.9.1', '0.9.1'), 0);
assert.equal(compareVersions('0.9.0', '0.9.1') < 0, true);
console.log('Updater smoke passed: semantic version comparison OK');
