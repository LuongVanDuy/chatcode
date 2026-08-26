const assert = require('assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const { createStore } = require('../core/store');
const { createSupportService, installChildProcessAudit } = require('../core/support');
const { normalizeError } = require('../core/errors');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatcode-terminal-'));
  const userData = path.join(temp, 'user-data');
  const safeRoot = path.join(temp, 'safe');
  const trustedRoot = path.join(temp, 'trusted');
  await fsp.mkdir(safeRoot, { recursive:true });
  await fsp.mkdir(path.join(trustedRoot, 'subdir'), { recursive:true });

  const app = { getPath(name) { if (name !== 'userData') throw new Error(`Unexpected path ${name}`); return userData; } };
  const support = createSupportService(app);
  installChildProcessAudit(support);
  require('../core/runtime-bootstrap').installRuntimePatches();

  const { createProjectService } = require('../core/projects');
  const { createApprovalService } = require('../core/approvals');
  const { createSafeToolApi } = require('../core/safety-tools');

  const store = createStore(app, 47820);
  const state = store.ensure();
  state.projects = [
    {
      id:'safe', name:'Safe Project', root:safeRoot,
      permissions:{ write:true, manageFiles:true, tasks:true, gitWrite:true },
      safety:store.normalizeSafety({ write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow' })
    },
    {
      id:'trusted', name:'Trusted Project', root:trustedRoot,
      permissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false },
      safety:store.normalizeSafety({
        write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow',
        _workspaceMode:'trusted', _allowSecrets:false,
        _safePermissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false }
      })
    }
  ];
  store.write(state);

  const projects = createProjectService(store);
  const approvals = createApprovalService(store);
  const backups = { async snapshot() { return null; } };
  const api = createSafeToolApi(projects, store, approvals, backups, { notifyTaskCompleted:() => ({ emitted:false, count:0, reason:'test' }) });

  assert.equal(typeof api.exec, 'function');
  assert.equal(typeof api.jobStatus, 'function');
  assert.equal(typeof api.jobStop, 'function');
  assert.equal(typeof api.listTerminalJobs, 'function');

  await assert.rejects(
    () => api.exec('safe', 'node --version'),
    error => normalizeError(error).code === 'PERMISSION_DENIED'
  );

  const chained = await api.exec('trusted', `node -e "process.stdout.write('CHAIN_A')" && node -e "process.stdout.write('CHAIN_B')"`);
  assert.equal(chained.status, 'completed', chained.stderr);
  assert.match(chained.stdout, /CHAIN_A/);
  assert.match(chained.stdout, /CHAIN_B/);
  assert.equal(chained.terminal.hidden, true);
  assert.equal(chained.terminal.cwd_inside_project, true);
  assert.equal(chained.terminal.os_filesystem_sandbox, false);

  const pipeCommand = process.platform === 'win32'
    ? `node -e "console.log('PIPE_OK')" | findstr PIPE_OK`
    : `node -e "console.log('PIPE_OK')" | grep PIPE_OK`;
  const piped = await api.exec('trusted', pipeCommand);
  assert.equal(piped.status, 'completed', piped.stderr);
  assert.match(piped.stdout, /PIPE_OK/);

  const cwd = await api.exec('trusted', `node -e "console.log(require('path').basename(process.cwd()))"`, { cwd:'subdir' });
  assert.equal(cwd.status, 'completed', cwd.stderr);
  assert.match(cwd.stdout, /subdir/);
  await assert.rejects(
    () => api.exec('trusted', 'node --version', { cwd:'../' }),
    error => normalizeError(error).code === 'PATH_OUTSIDE_PROJECT'
  );

  for (const blocked of ['git push origin main', 'git -C . push origin main', 'git reset --hard HEAD']) {
    await assert.rejects(() => api.exec('trusted', blocked), error => normalizeError(error).code === 'TASK_NOT_ALLOWED');
  }

  const bg = await api.exec(
    'trusted',
    `node -e "console.log('BG_START');setTimeout(()=>console.log('BG_LATE'),250);setInterval(()=>{},1000)"`,
    { background:true }
  );
  assert.equal(bg.status, 'running');
  assert.equal(bg.background, true);
  assert.ok(bg.job_id);

  await sleep(650);
  const first = api.jobStatus(bg.job_id, { stdout_offset:0, stderr_offset:0 });
  assert.match(first.stdout, /BG_START/);
  assert.match(first.stdout, /BG_LATE/);
  assert.ok(first.stdout_offset >= first.stdout.length);

  const second = api.jobStatus(bg.job_id, { stdout_offset:first.stdout_offset, stderr_offset:first.stderr_offset });
  assert.equal(second.stdout, '');
  assert.equal(second.stderr, '');
  assert.equal(second.stdout_offset, first.stdout_offset);
  assert.ok(api.listTerminalJobs('trusted').some(job => job.job_id === bg.job_id));

  const stop = await api.jobStop(bg.job_id);
  assert.equal(stop.stop_requested, true);
  for (let i = 0; i < 30; i++) {
    const current = api.jobStatus(bg.job_id);
    if (!['running','stopping'].includes(current.status)) break;
    await sleep(100);
  }
  const stopped = api.jobStatus(bg.job_id);
  assert.ok(['stopped','failed'].includes(stopped.status), `Unexpected stop status: ${stopped.status}`);
  assert.equal(stopped.stop_reason, 'user');

  const timed = await api.exec('trusted', `node -e "setTimeout(()=>{},5000)"`, { timeout_ms:1000 });
  assert.equal(timed.status, 'timeout');
  assert.equal(timed.stop_reason, 'timeout');
  assert.match(timed.stderr, /timeout/i);

  await sleep(200);
  const events = await support.listEvents(120);
  const terminalSpawns = events.filter(event => event.type === 'process' && event.phase === 'spawn' && ['shell','task'].includes(event.source));
  assert.ok(terminalSpawns.length > 0, 'Terminal process audit must record shell/task spawns.');
  if (process.platform === 'win32') assert.ok(terminalSpawns.every(event => event.windowsHide === true), 'All Windows terminal spawns must use windowsHide=true.');

  await api.shutdownTerminalJobs();
  approvals.shutdown();
  projects.shutdown();
  await fsp.rm(temp, { recursive:true, force:true });
  console.log('Trusted Terminal smoke test: PASS');
})().catch(error => { console.error(error); process.exit(1); });
