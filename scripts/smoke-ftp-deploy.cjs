const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FTP_CONFIG_RELATIVE,
  MAX_DEPLOY_FILES,
  MAX_TERMINAL_COMMAND_CHARS,
  normalizeDeployFiles,
  changedFilesFromLegacyChanges,
  resolveFtpRunnerPath,
  buildFtpDeployCommand,
  parseDeployResult,
  deployChangedFiles,
  createFtpDeployApi
} = require('../core/ftp-deploy');

function fixtureRoot(uploadOnSave = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-ftp-'));
  fs.mkdirSync(path.join(root, '.vscode'), { recursive:true });
  fs.writeFileSync(path.join(root, '.vscode', 'sftp.json'), JSON.stringify({
    host:'example.test', username:'demo', password:'SECRET_SHOULD_NOT_APPEAR', protocol:'ftp', port:21,
    secure:false, passive:true, remotePath:'/public_html', uploadOnSave,
    watcher:{ files:'**/*', autoDelete:true }
  }, null, 2));
  return root;
}

function ensureFile(root, rel, content = 'fixture') {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, content);
}

function decodeCommand(command) {
  const encoded = String(command).match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)$/)?.[1] || '';
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

function payloadFromCommand(command) {
  const script = decodeCommand(command);
  const encoded = script.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)?.[1] || '';
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
}

function runnerReport(files, options = {}) {
  const failed = options.failed || '';
  const uploaded = options.uploaded || files.filter(file => file !== failed);
  return {
    ok:!failed,
    mode:'deploy',
    files:[
      ...uploaded.map(file => ({ file, status:options.unchanged?.includes(file) ? 'unchanged' : 'uploaded', sha256:'fixture', attempts:1 })),
      ...(failed ? [{ file:failed, status:'failed', attempts:1, error:'connection failed' }] : [])
    ],
    curl_requests:Math.max(1, files.length),
    cleanup_warnings:[],
    ...(failed ? { not_attempted:files.slice(files.indexOf(failed) + 1) } : {})
  };
}

(async () => {
  assert.equal(FTP_CONFIG_RELATIVE, '.vscode/sftp.json');
  assert.equal(MAX_DEPLOY_FILES, 500);
  assert.deepEqual(normalizeDeployFiles([
    'wp-content/themes/site/style.css',
    { path:'wp-content\\themes\\site\\functions.php' },
    '.vscode/sftp.json', '.git/config', '.chatcode/ftp-files.json', '.env', 'wp-config.php',
    '../escape.txt', 'wp-content/themes/site/style.css'
  ]), ['wp-content/themes/site/style.css','wp-content/themes/site/functions.php']);
  assert.deepEqual(changedFilesFromLegacyChanges([
    { op:'write', path:'new.php' },
    { op:'patch', path:'style.css' },
    { op:'rename', from:'old.js', to:'new.js' },
    { op:'delete', path:'gone.txt' }
  ]), ['new.php','style.css','new.js'], 'remote deletion must not be inferred from missing local files');

  const runnerPath = resolveFtpRunnerPath();
  assert.ok(runnerPath.endsWith(path.join('tools','deploy-ftp.ps1')), runnerPath);
  const command = buildFtpDeployCommand(runnerPath, 'C:\\project root', 'C:\\temp\\manifest.json');
  assert.match(command, /^powershell\.exe .* -EncodedCommand /);
  assert.ok(command.length < MAX_TERMINAL_COMMAND_CHARS, `runner invocation too large: ${command.length}`);
  assert.deepEqual(payloadFromCommand(command), {
    runnerPath,
    projectRoot:'C:\\project root',
    manifestPath:'C:\\temp\\manifest.json'
  });
  assert.equal(command.includes('SECRET_SHOULD_NOT_APPEAR'), false, 'credential leaked into runner invocation');
  assert.equal(decodeCommand(command).includes('FtpWebRequest'), false, 'legacy inline FTP transport must be gone');

  const parsed = parseDeployResult({
    status:'completed', exit_code:0,
    stdout:`FTP uploaded: a.php\nFTP unchanged: b.css\n${JSON.stringify({ ok:true, mode:'deploy', files:[{file:'a.php',status:'uploaded'},{file:'b.css',status:'unchanged'}], curl_requests:3, cleanup_warnings:[] })}`,
    stderr:''
  }, ['a.php','b.css']);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.uploaded, ['a.php']);
  assert.deepEqual(parsed.unchanged, ['b.css']);
  assert.equal(parsed.runner, 'sha256-staging');

  const root = fixtureRoot();
  for (const file of ['inc/test.php','a.php','b.php','legacy.php']) ensureFile(root, file);
  let execCalls = 0;
  let seenCommand = '';
  const store = { getProject:ref => ({ id:String(ref), name:'Fixture', root, workspaceMode:'trusted', safety:{ _workspaceMode:'trusted' } }) };
  const api = {
    exec:async (_ref, cmd, opts) => {
      execCalls++;
      seenCommand = cmd;
      assert.equal(opts.background, false);
      assert.equal(opts.timeout_ms, 180000);
      const payload = payloadFromCommand(cmd);
      assert.equal(payload.projectRoot, root);
      const manifest = JSON.parse(fs.readFileSync(payload.manifestPath, 'utf8'));
      return { status:'completed', exit_code:0, stdout:JSON.stringify(runnerReport(manifest.files)), stderr:'' };
    }
  };
  const deployed = await deployChangedFiles(api, store, 'p1', ['inc/test.php']);
  assert.equal(deployed.ok, true);
  assert.deepEqual(deployed.uploaded, ['inc/test.php']);
  assert.equal(execCalls, 1);
  assert.equal(seenCommand.includes('SECRET_SHOULD_NOT_APPEAR'), false, 'runtime command exposed stored password');

  const missing = await deployChangedFiles(api, store, 'p1', ['deleted.php']);
  assert.equal(missing.ok, true);
  assert.deepEqual(missing.skipped_files, [{ reason:'local_missing_no_delete', file:'deleted.php' }]);
  assert.equal(execCalls, 1, 'missing local file must not trigger FTP delete or network transport');

  const disabledRoot = fixtureRoot(false);
  ensureFile(disabledRoot, 'a.php');
  const disabled = await deployChangedFiles(api, { getProject:() => ({ id:'disabled', root:disabledRoot, workspaceMode:'trusted' }) }, 'disabled', ['a.php']);
  assert.equal(disabled.status, 'skipped');
  assert.equal(disabled.reason, 'upload_disabled');

  const wrappedApi = createFtpDeployApi({
    workStatus:async () => ({ project_id:'p1', project:'Fixture', status:'active', changed_files:['inc/test.php'] }),
    finishWork:async () => ({ project_id:'p1', project:'Fixture', status:'completed', changed_files:['inc/test.php'] }),
    applyAndVerify:async () => ({ project:'Fixture', status:'completed', ok:true, verification_passed:true }),
    exec:api.exec
  }, store);
  const finished = await wrappedApi.finishWork('work-1');
  assert.equal(finished.status, 'completed');
  assert.equal(finished.ftp_deploy.status, 'completed');
  assert.deepEqual(finished.ftp_deploy.uploaded, ['inc/test.php']);

  let retryCalls = 0;
  let finishCalls = 0;
  let workState = 'active';
  const { createProjectScopeApi } = require('../core/project-scope');
  const retryApi = createProjectScopeApi(createFtpDeployApi({
    listProjects:async () => [store.getProject('p1')],
    startWork:async () => ({ work_session_id:'retry-work', project_id:'p1', status:'active' }),
    workStatus:async () => ({ project_id:'p1', status:workState, changed_files:['a.php','b.php'] }),
    finishWork:async () => { finishCalls++; workState='completed'; return { project_id:'p1', status:'completed', changed_files:['a.php','b.php'] }; },
    exec:async (_ref, cmd) => {
      retryCalls++;
      const payload = payloadFromCommand(cmd);
      const manifest = JSON.parse(fs.readFileSync(payload.manifestPath, 'utf8'));
      if (retryCalls === 1) {
        assert.deepEqual(manifest.files, ['a.php','b.php']);
        return { status:'failed', exit_code:2, stdout:JSON.stringify(runnerReport(manifest.files, { uploaded:['a.php'], failed:'b.php' })), stderr:'' };
      }
      assert.deepEqual(manifest.files, ['b.php'], 'retry only files not already verified remotely');
      return { status:'completed', exit_code:0, stdout:JSON.stringify(runnerReport(manifest.files)), stderr:'' };
    }
  }, store));
  await retryApi.startWork('p1');
  const firstDeploy = await retryApi.finishWork('retry-work');
  assert.equal(firstDeploy.status, 'deploy_failed');
  assert.equal(retryApi.projectScope('p1').locked, false, 'failed FTP must not retain completed work holder');
  const retryDeploy = await retryApi.finishWork('retry-work');
  assert.equal(retryDeploy.status, 'completed');
  assert.deepEqual(retryDeploy.ftp_deploy.uploaded, ['a.php','b.php']);
  await retryApi.finishWork('retry-work');
  assert.equal(retryCalls, 2, 'successful FTP must not run twice');
  assert.equal(finishCalls, 2, 'cached success must not re-run finish verification');

  const legacy = await wrappedApi.applyAndVerify('p1', [{ op:'write', path:'legacy.php', content:'<?php' }, { op:'delete', path:'gone.php' }], []);
  assert.equal(legacy.status, 'completed');
  assert.deepEqual(legacy.ftp_deploy.uploaded, ['legacy.php']);

  const failedLegacyApi = createFtpDeployApi({
    applyAndVerify:async () => ({ project:'Fixture', status:'completed', ok:false, verification_passed:false }),
    exec:async () => { throw new Error('must not deploy failed verification'); }
  }, store);
  const failedLegacy = await failedLegacyApi.applyAndVerify('p1', [{ op:'write', path:'bad.php' }], []);
  assert.equal(failedLegacy.ftp_deploy, undefined);

  const safe = await deployChangedFiles(api, { getProject:ref => ({ id:String(ref), root, workspaceMode:'safe', safety:{ _workspaceMode:'safe' } }) }, 'p2', ['inc/test.php']);
  assert.equal(safe.status, 'skipped');
  assert.equal(safe.reason, 'trusted_terminal_required');

  const noConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-no-ftp-'));
  const noConfig = await deployChangedFiles(api, { getProject:ref => ({ id:String(ref), root:noConfigRoot, workspaceMode:'trusted' }) }, 'p3', ['a.php']);
  assert.equal(noConfig.status, 'not_configured');

  fs.rmSync(root, { recursive:true, force:true });
  fs.rmSync(disabledRoot, { recursive:true, force:true });
  fs.rmSync(noConfigRoot, { recursive:true, force:true });
  console.log('FTP lifecycle smoke PASS: one SHA runner transport + safe no-delete + retry on same Work Session.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
