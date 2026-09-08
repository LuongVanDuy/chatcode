const assert = require('assert/strict');
const { normalizeError } = require('../core/errors');
const { parseUnifiedDiff, applyFilePatch } = require('../core/work-runtime');

const source = 'alpha\nbeta\ngamma\n';
const wrongCounts = [
  '--- a/demo.txt',
  '+++ b/demo.txt',
  '@@ -1,99 +1,88 @@',
  ' alpha',
  '-beta',
  '+BETA',
  ' gamma',
  ''
].join('\n');

const parsed = parseUnifiedDiff(wrongCounts);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].hunks.length, 1);
assert.equal(parsed[0].hunks[0].declaredOldCount, 99);
assert.equal(parsed[0].hunks[0].declaredNewCount, 88);
assert.equal(parsed[0].hunks[0].oldCount, 3);
assert.equal(parsed[0].hunks[0].newCount, 3);
assert.equal(parsed[0].hunks[0].countAdjusted, true);
assert.equal(applyFilePatch(source, parsed[0]), 'alpha\nBETA\ngamma\n');

const multiFileWrongCounts = [
  '--- a/one.txt',
  '+++ b/one.txt',
  '@@ -1,20 +1,20 @@',
  '-one',
  '+ONE',
  '--- a/two.txt',
  '+++ b/two.txt',
  '@@ -1,30 +1,30 @@',
  '-two',
  '+TWO',
  ''
].join('\n');
const multi = parseUnifiedDiff(multiFileWrongCounts);
assert.equal(multi.length, 2, 'relaxed parser must keep file boundaries without diff --git lines');
assert.equal(applyFilePatch('one\n', multi[0]), 'ONE\n');
assert.equal(applyFilePatch('two\n', multi[1]), 'TWO\n');

const realConflict = [
  '--- a/demo.txt',
  '+++ b/demo.txt',
  '@@ -1,50 +1,50 @@',
  ' alpha',
  '-DOES_NOT_EXIST',
  '+BETA',
  ' gamma',
  ''
].join('\n');
const conflictParsed = parseUnifiedDiff(realConflict);
assert.throws(
  () => applyFilePatch(source, conflictParsed[0]),
  error => normalizeError(error).code === 'PATCH_CONFLICT',
  'count repair must not weaken exact context/delete matching'
);

console.log('Unified patch parser smoke: PASS (header counts repaired, real conflicts preserved)');
