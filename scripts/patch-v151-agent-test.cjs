const fs = require('fs');
const file='scripts/smoke-agent.cjs';
let s=fs.readFileSync(file,'utf8');
const marker = `  const secondRollback = await api.rollbackWork(repair.task_id);
  assert.equal(secondRollback.ok, true);
  assert.equal(await fsp.readFile(path.join(root, 'src', 'app.js'), 'utf8'), baseline);
  assert.equal(git(root, ['status','--porcelain']).trim(), '');
`;
if(!s.includes(marker)) throw new Error('agent anti-loop insertion marker missing');
const block = `${marker}
  // Same root cause receives one corrective pass, then that execution path is exhausted instead of looping.
  const exhaustedTask = await api.prepareTask('agent', 'Exercise bounded retry policy for checkout normalization', 6);
  const exhaustedFirstPatch = [
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,1 +1,1 @@',
    '-export function checkoutAddress(value) { return value.trim(); }',
    '+export function checkoutAddress(value) { return String(value).trim(); }',
    ''
  ].join('\\n');
  const alwaysFail = \`node -e "process.exit(7)"\`;
  const exhaustedFirst = await api.completeTask(exhaustedTask.task_id, exhaustedFirstPatch, [alwaysFail]);
  assert.equal(exhaustedFirst.status, 'needs_fix');
  const exhaustedSecondPatch = [
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,1 +1,1 @@',
    '-export function checkoutAddress(value) { return String(value).trim(); }',
    '+export function checkoutAddress(value) { return String(value || "").trim(); }',
    ''
  ].join('\\n');
  const exhaustedSecond = await api.completeTask(exhaustedTask.task_id, exhaustedSecondPatch, [alwaysFail]);
  assert.equal(exhaustedSecond.status, 'path_exhausted');
  assert.equal(exhaustedSecond.task_id, exhaustedTask.task_id, 'fallback remains in the same task/session');
  assert.match(exhaustedSecond.next_action,/Dừng path này|stop.*path|fallback/i);
  assert.equal((await api.workStatus(exhaustedTask.task_id)).status, 'active', 'path exhaustion must not spawn or silently finalize another task');
  assert.equal(api.listWorkSessions('agent').filter(item => item.status === 'active').length,1,'anti-loop corrective pass must not create another work session');
  const exhaustedRollback = await api.rollbackWork(exhaustedTask.task_id);
  assert.equal(exhaustedRollback.ok,true);
  assert.equal(await fsp.readFile(path.join(root,'src','app.js'),'utf8'),baseline);
`;
s=s.replace(marker,block);
fs.writeFileSync(file,s);
console.log('anti-loop path_exhausted regression staged');
