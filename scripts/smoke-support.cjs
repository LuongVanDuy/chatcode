const assert = require('assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { createSupportService, installChildProcessAudit } = require('../core/support');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatcode-support-'));
  const app = { getPath: () => dir };
  const support = createSupportService(app);
  installChildProcessAudit(support);

  await new Promise((resolve, reject) => {
    childProcess.execFile(process.execPath, ['-e', 'process.exit(0)'], { windowsHide:true }, error => error ? reject(error) : resolve());
  });
  await support.appendEvent({ type:'process', phase:'spawn', source:'cloudflared', executable:'cloudflared.exe', args:['tunnel','run','--token','eyJTHIS_IS_A_FAKE_TEST_TOKEN_1234567890'], windowsHide:true });
  await support.markTerminalFlash('manual marker');
  await support.saveNote('Terminal flashed once during reconnect.');
  await new Promise(resolve => setTimeout(resolve, 80));

  const events = await support.listEvents(30);
  assert.ok(events.some(x => x.phase === 'spawn' && x.executable.toLowerCase().includes('node')), 'child process spawn audit missing');
  assert.ok(events.some(x => x.phase === 'exit' && x.executable.toLowerCase().includes('node')), 'child process exit audit missing');
  assert.ok(events.some(x => x.type === 'terminal-flash-marker'), 'manual terminal marker missing');
  const tokenEvent = events.find(x => x.source === 'cloudflared' && x.args?.includes('<redacted>'));
  assert.ok(tokenEvent, 'tunnel token was not redacted');
  assert.equal(await support.getNote(), 'Terminal flashed once during reconnect.');
  const report = await support.report({ version:'0.9.0', limit:20 });
  assert.equal(report.version, '0.9.0');
  assert.ok(Array.isArray(report.terminalEvents));

  await fs.rm(dir, { recursive:true, force:true });
  console.log('Support smoke passed: process audit + token redaction + note + terminal marker OK');
})().catch(error => { console.error(error); process.exit(1); });
