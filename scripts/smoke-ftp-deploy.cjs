const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FTP_CONFIG_RELATIVE,
  MAX_TERMINAL_COMMAND_CHARS,
  normalizeDeployFiles,
  buildFtpDeployCommand,
  buildFtpDeployBatches,
  parseDeployResult,
  deployChangedFiles,
  createFtpDeployApi
} = require('../core/ftp-deploy');

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-ftp-'));
  fs.mkdirSync(path.join(root, '.vscode'), { recursive:true });
  fs.writeFileSync(path.join(root, '.vscode', 'sftp.json'), JSON.stringify({
    host:'example.test', username:'demo', password:'SECRET_SHOULD_NOT_APPEAR', protocol:'ftp', port:21,
    secure:false, passive:true, remotePath:'/public_html', uploadOnSave:true,
    watcher:{ files:'**/*', autoDelete:true }
  }, null, 2));
  return root;
}

function decodeCommand(command) {
  const encoded = String(command).match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)$/)?.[1] || '';
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

(async () => {
  assert.equal(FTP_CONFIG_RELATIVE, '.vscode/sftp.json');
  assert.deepEqual(normalizeDeployFiles([
    'wp-content/themes/site/style.css',
    { path:'wp-content\\themes\\site\\functions.php' },
    '.vscode/sftp.json',
    '.vscode/settings.json',
    '../escape.txt',
    'wp-content/themes/site/style.css'
  ]), [
    'wp-content/themes/site/style.css',
    'wp-content/themes/site/functions.php'
  ]);

  const command = buildFtpDeployCommand(['wp-content/themes/site/style.css', 'assets/logo 1.svg']);
  assert.match(command, /^powershell\.exe .* -EncodedCommand /);
  assert.ok(command.length < 16000, `FTP terminal command exceeds Trusted Terminal guard: ${command.length}`);
  const script = decodeCommand(command);
  for (const phrase of ['.vscode\\sftp.json', 'uploadOnSave', 'remotePath', 'FtpWebRequest', 'UsePassive', 'EnableSsl', 'autoDelete', 'CHATCODE_FTP_OK']) {
    assert.ok(script.includes(phrase), `FTP script missing ${phrase}`);
  }
  assert.ok(script.includes('$cfg.password'), 'PowerShell must read password locally from config');
  assert.equal(script.includes('SECRET_SHOULD_NOT_APPEAR'), false, 'credential value leaked into generated terminal command');
  assert.equal(script.toLowerCase().includes('boncauinax.vn'), false, 'project-specific host leaked into generic FTP deploy');

  const manyFiles = Array.from({ length:50 }, (_, i) => `wp-content/themes/site/assets/generated/component-${String(i).padStart(2,'0')}-with-a-long-filename.css`);
  const batches = buildFtpDeployBatches(manyFiles);
  assert.ok(batches.length > 1, 'large changed-file set should be split into multiple terminal commands');
  assert.deepEqual(batches.flat(), manyFiles, 'FTP batching lost or reordered changed files');
  for (const batch of batches) {
    const batchedCommand = buildFtpDeployCommand(batch);
    assert.ok(batchedCommand.length <= MAX_TERMINAL_COMMAND_CHARS, `FTP batch exceeds terminal command budget: ${batchedCommand.length}`);
  }

  const parsed = parseDeployResult({
    status:'completed', exit_code:0,
    stdout:'CHATCODE_FTP_OK|upload|a.php\nCHATCODE_FTP_OK|delete|old.css\nCHATCODE_FTP_SKIP_FILE|local_missing|x.txt\n', stderr:''
  }, ['a.php','old.css','x.txt']);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.uploaded, ['a.php']);
  assert.deepEqual(parsed.deleted, ['old.css']);
  assert.deepEqual(parsed.skipped_files, [{ reason:'local_missing', file:'x.txt' }]);

  const disabled = parseDeployResult({ status:'completed', exit_code:0, stdout:'CHATCODE_FTP_SKIP|upload_disabled\n', stderr:'' }, ['a.php']);
  assert.equal(disabled.status, 'skipped');
  assert.equal(disabled.reason, 'upload_disabled');

  const root = fixtureRoot();
  let execCalls = 0;
  let seenCommand = '';
  const store = {
    getProject:ref => ({ id:String(ref), name:'Fixture', root, workspaceMode:'trusted', safety:{ _workspaceMode:'trusted' } })
  };
  const api = {
    exec:async (_ref, cmd, opts) => {
      execCalls++;
      seenCommand = cmd;
      assert.equal(opts.background, false);
      assert.equal(opts.timeout_ms, 180000);
      return { status:'completed', exit_code:0, stdout:'CHATCODE_FTP_OK|upload|inc/test.php\n', stderr:'' };
    }
  };
  const deployed = await deployChangedFiles(api, store, 'p1', ['inc/test.php']);
  assert.equal(deployed.ok, true);
  assert.equal(deployed.status, 'completed');
  assert.deepEqual(deployed.uploaded, ['inc/test.php']);
  assert.equal(execCalls, 1);
  assert.equal(deployed.batch_count, 1);
  assert.equal(decodeCommand(seenCommand).includes('SECRET_SHOULD_NOT_APPEAR'), false, 'runtime command exposed stored password');

  const wrappedApi = createFtpDeployApi({
    workStatus:async () => ({ project_id:'p1', project:'Fixture', status:'active', changed_files:['inc/test.php'] }),
    finishWork:async () => ({ project_id:'p1', project:'Fixture', status:'completed', changed_files:['inc/test.php'] }),
    exec:api.exec
  }, store);
  const finished = await wrappedApi.finishWork('work-1');
  assert.equal(finished.status, 'completed');
  assert.equal(finished.ftp_deploy.status, 'completed');
  assert.deepEqual(finished.ftp_deploy.uploaded, ['inc/test.php']);

  const safeStore = {
    getProject:ref => ({ id:String(ref), name:'Safe', root, workspaceMode:'safe', safety:{ _workspaceMode:'safe' } })
  };
  const safe = await deployChangedFiles(api, safeStore, 'p2', ['inc/test.php']);
  assert.equal(safe.status, 'skipped');
  assert.equal(safe.reason, 'trusted_terminal_required');

  const noConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-no-ftp-'));
  const noConfig = await deployChangedFiles(api, { getProject:ref => ({ id:String(ref), root:noConfigRoot, workspaceMode:'trusted' }) }, 'p3', ['a.php']);
  assert.equal(noConfig.status, 'not_configured');
  assert.equal(noConfig.reason, 'config_missing');

  fs.rmSync(root, { recursive:true, force:true });
  fs.rmSync(noConfigRoot, { recursive:true, force:true });
  console.log('Terminal FTP deploy smoke PASS: local credentials + changed-files-only + bounded terminal batching + Work Session hook.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
