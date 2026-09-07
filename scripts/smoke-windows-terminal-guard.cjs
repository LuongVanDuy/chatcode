const assert = require('assert/strict');
const {
  hasUnsafeCmdArrow,
  parsePhpInlineCommand,
  buildSafePhpInlineCommand,
  createWindowsTerminalGuardApi
} = require('../core/windows-terminal-guard');
const { normalizeError } = require('../core/errors');

function decodePowerShell(command) {
  const encoded = String(command).match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)$/)?.[1] || '';
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

(async () => {
  const risky = `php -r $args = ['order' => 'ASC', 'direction' => 'DESC', 'orderby' => 'ids', 'cast' => (int) 3, 'label' => esc_html__('X')];`;
  assert.equal(hasUnsafeCmdArrow(risky), true);
  assert.equal(hasUnsafeCmdArrow(`php -r "$args = ['order' => 'ASC'];"`), false, 'double-quoted CMD payload should not expose > to cmd.exe');
  assert.equal(hasUnsafeCmdArrow(`echo a ^=> b`), false, 'caret-escaped redirect should not be treated as exposed');

  const parsed = parsePhpInlineCommand(risky);
  assert.equal(parsed.executable, 'php');
  for (const artifact of ["'ASC'", "'DESC'", "'ids'", '(int)', 'esc_html__(']) {
    assert.ok(parsed.code.includes(artifact), `fixture missing ${artifact}`);
  }

  const safe = buildSafePhpInlineCommand(risky);
  assert.match(safe, /^powershell\.exe .* -EncodedCommand /);
  assert.equal(safe.includes('=>'), false, 'transport command must not expose PHP arrows to cmd.exe');
  for (const artifact of ["'ASC'", "'DESC'", "'ids'", '(int)', 'esc_html__(']) {
    assert.equal(safe.includes(artifact), false, `transport command leaked artifact token ${artifact}`);
  }
  const transportScript = decodePowerShell(safe);
  assert.ok(transportScript.includes('FromBase64String'));
  assert.ok(transportScript.includes('& $exe -r $code'));

  const calls = [];
  const jobs = new Map();
  const base = {
    exec:async (ref, command) => {
      calls.push({ ref, command });
      const result = { ok:true, job_id:'job-1', status:'completed', exit_code:0, command };
      jobs.set('job-1', result);
      return result;
    },
    jobStatus:id => jobs.get(id),
    listTerminalJobs:() => [...jobs.values()]
  };
  const api = createWindowsTerminalGuardApi(base, 'win32');
  const result = await api.exec('demo', risky);
  assert.equal(result.status, 'completed');
  assert.equal(result.command, risky, 'public result should preserve the original command');
  assert.equal(result.command_transport, 'windows-safe-inline');
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].command, risky);
  assert.equal(calls[0].command.includes('=>'), false);
  assert.equal(api.jobStatus('job-1').command, risky);
  assert.equal(api.listTerminalJobs()[0].command, risky);

  const nonPhpRisk = `node -e 'const f = x => x'`;
  await assert.rejects(
    () => api.exec('demo', nonPhpRisk),
    error => normalizeError(error).code === 'TASK_NOT_ALLOWED' && normalizeError(error).details?.redirect_artifact_guard === true
  );
  assert.equal(calls.length, 1, 'unsafe non-PHP arrow command must be blocked before cmd.exe');

  const safeApiCalls = [];
  const safeApi = createWindowsTerminalGuardApi({ exec:async (_ref, command) => { safeApiCalls.push(command); return { status:'completed', exit_code:0 }; } }, 'linux');
  await safeApi.exec('demo', nonPhpRisk);
  assert.deepEqual(safeApiCalls, [nonPhpRisk], 'non-Windows terminal behavior must remain unchanged');

  console.log('Windows terminal redirect guard PASS: PHP => transport is encoded and code-token artifact filenames never reach cmd.exe.');
})().catch(error => { console.error(error); process.exit(1); });
