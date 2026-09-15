const fs = require('fs');

function replaceOnce(file, before, after) {
  let source = fs.readFileSync(file,'utf8');
  if (!source.includes(before)) throw new Error(`${file}: expected block not found`);
  source = source.replace(before, after);
  fs.writeFileSync(file,source);
}

// FTP: allow only ChatCode-owned one-shot DB helper cleanup, never arbitrary remote delete.
replaceOnce('core/ftp-deploy.js',
"const MAX_TERMINAL_COMMAND_CHARS = 15000;\n",
"const MAX_TERMINAL_COMMAND_CHARS = 15000;\nconst OWNED_DB_HELPER_RE = /^wp-content\\/mu-plugins\\/chatcode-db-once-[a-f0-9]{24}\\.php$/;\n");
replaceOnce('core/ftp-deploy.js',
"function buildFtpDeployBatches(files) {",
`function buildFtpOwnedDeleteCommand(runnerPath, projectRoot, relativePath) {
  if (!OWNED_DB_HELPER_RE.test(String(relativePath || ''))) throw new Error('Remote delete is restricted to ChatCode-owned one-shot DB helpers.');
  const payload = Buffer.from(JSON.stringify({ runnerPath, projectRoot, relativePath }), 'utf8').toString('base64');
  const script = String.raw\`$ErrorActionPreference='Stop'
$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('\${payload}')) | ConvertFrom-Json
& ([string]$data.runnerPath) -ProjectRoot ([string]$data.projectRoot) -DeleteOwned ([string]$data.relativePath)\`;
  return \`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand \${powershellEncodedCommand(script)}\`;
}

function buildFtpDeployBatches(files) {`);
replaceOnce('core/ftp-deploy.js',
"function autoDeployConfig(root) {",
"function autoDeployConfig(root, { explicit = false } = {}) {");
replaceOnce('core/ftp-deploy.js',
"  if (config?.uploadOnSave !== true) return { ok:true, status:'skipped', reason:'upload_disabled' };",
"  if (config?.uploadOnSave !== true && !explicit) return { ok:true, status:'skipped', reason:'upload_disabled' };");
replaceOnce('core/ftp-deploy.js',
"async function deployChangedFiles(api, store, projectRef, changedFiles) {",
"async function deployChangedFiles(api, store, projectRef, changedFiles, workSessionId = '', options = {}) {");
replaceOnce('core/ftp-deploy.js',
"  const config = autoDeployConfig(root);",
"  const config = autoDeployConfig(root, { explicit:options?.explicit === true });");
replaceOnce('core/ftp-deploy.js',
"    const raw = await api.exec(project.id, command, { background:false, timeout_ms:180000 });",
"    const raw = await api.exec(project.id, command, { background:false, timeout_ms:180000, ...(workSessionId ? { work_session_id:workSessionId } : {}) });");
replaceOnce('core/ftp-deploy.js',
"function shouldAttachFtpResult(ftp) {",
`async function deleteOwnedRemoteFile(api, store, projectRef, relativePath, workSessionId = '') {
  const rel = String(relativePath || '').replace(/\\\\/g,'/').replace(/^\\.\\//,'').replace(/^\\/+/, '');
  if (!OWNED_DB_HELPER_RE.test(rel)) throw new Error('Remote delete is restricted to ChatCode-owned one-shot DB helpers.');
  const project = store?.getProject?.(projectRef);
  const root = String(project?.root || '');
  if (!root || !isTrusted(project) || typeof api?.exec !== 'function') return { ok:false, status:'skipped', reason:'trusted_terminal_required', file:rel };
  const config = autoDeployConfig(root, { explicit:true });
  if (config.status !== 'enabled') return { ...config, file:rel };
  const runnerPath = resolveFtpRunnerPath();
  if (!runnerPath) return { ok:false, status:'failed', reason:'runner_missing', file:rel };
  const command = buildFtpOwnedDeleteCommand(runnerPath, root, rel);
  const raw = await api.exec(project.id, command, { background:false, timeout_ms:90000, ...(workSessionId ? { work_session_id:workSessionId } : {}) });
  const stdout = String(raw?.stdout || '');
  const start = stdout.indexOf('{');
  let report = null;
  if (start >= 0) try { report = JSON.parse(stdout.slice(start)); } catch {}
  const ok = raw?.status === 'completed' && Number(raw?.exit_code) === 0 && report?.ok === true && report?.mode === 'owned_delete';
  return { ok, status:ok ? 'completed' : 'failed', file:rel, deleted:report?.deleted === true, absent:report?.absent === true, ...(ok ? {} : { error:String(report?.error || raw?.stderr || 'Owned remote delete was not confirmed').slice(0,800) }) };
}

function shouldAttachFtpResult(ftp) {`);
replaceOnce('core/ftp-deploy.js',
"        const ftp = await deployChangedFiles(api, store, projectRef, changedFiles);",
"        const ftp = await deployChangedFiles(api, store, projectRef, changedFiles, workSessionId);");
replaceOnce('core/ftp-deploy.js',
"  buildFtpDeployCommand,\n  buildFtpDeployBatches,",
"  buildFtpDeployCommand,\n  buildFtpOwnedDeleteCommand,\n  buildFtpDeployBatches,");
replaceOnce('core/ftp-deploy.js',
"  deployChangedFiles,\n  createFtpDeployApi,",
"  deployChangedFiles,\n  deleteOwnedRemoteFile,\n  OWNED_DB_HELPER_RE,\n  createFtpDeployApi,");

// PowerShell FTP runner: one narrowly-owned delete action for the one-shot helper only.
replaceOnce('tools/deploy-ftp.ps1',
"  [string]$Manifest = '',\n  [switch]$DryRun,",
"  [string]$Manifest = '',\n  [string]$DeleteOwned = '',\n  [switch]$DryRun,");
replaceOnce('tools/deploy-ftp.ps1',
"  $items = @()\n  if ($Probe) {",
`  $items = @()
  if ($DeleteOwned) {
    $rel = ([string]$DeleteOwned).Replace('\\','/')
    if ($rel -notmatch '^wp-content/mu-plugins/chatcode-db-once-[a-f0-9]{24}\\.php$') { throw 'DeleteOwned is restricted to ChatCode one-shot DB helpers' }
    $ownedRemote = $remoteBase + '/' + $rel
    if ((Download-Hash $ownedRemote -AllowMissing) -eq '') {
      $results.Add(@{file=$rel; status='absent'})
    } else {
      Require-Ok (Delete-OwnedRemote $ownedRemote)
      if ((Download-Hash $ownedRemote -AllowMissing) -ne '') { throw 'Owned helper still exists after delete' }
      $results.Add(@{file=$rel; status='deleted'})
    }
  } elseif ($Probe) {`);
replaceOnce('tools/deploy-ftp.ps1',
"$report = @{ok=($exitCode -eq 0); mode=$(if ($DryRun) {'dry_run'} elseif ($Probe) {'probe'} else {'deploy'}); files=@($results.ToArray()); curl_requests=$curlCount; cleanup_warnings=@($cleanupWarnings.ToArray())}",
"$ownedDeleted = @($results | Where-Object { $_.status -eq 'deleted' }).Count -gt 0\n$ownedAbsent = @($results | Where-Object { $_.status -eq 'absent' }).Count -gt 0\n$report = @{ok=($exitCode -eq 0); mode=$(if ($DeleteOwned) {'owned_delete'} elseif ($DryRun) {'dry_run'} elseif ($Probe) {'probe'} else {'deploy'}); files=@($results.ToArray()); deleted=$ownedDeleted; absent=$ownedAbsent; curl_requests=$curlCount; cleanup_warnings=@($cleanupWarnings.ToArray())}");

// Install DB capability before final project-scope wrapper.
replaceOnce('core/runtime-bootstrap.js',
"  const { installBricksEvidencePatches } = require('./bricks-evidence');\n  installBricksEvidencePatches();\n  // Git is an explicit integration",
"  const { installBricksEvidencePatches } = require('./bricks-evidence');\n  installBricksEvidencePatches();\n  // Optional WordPress database capability: bounded server-side bridge/one-shot fallback.\n  // It is installed before Project Scope so every action inherits the same task/project lane.\n  const { installDatabaseRuntimePatches } = require('./database-runtime');\n  installDatabaseRuntimePatches();\n  // Git is an explicit integration");

// Final project-scope layer knows the database method and keeps mutations task/project-bound.
replaceOnce('core/project-scope.js',
"    'writeFile','deleteFile','renameFile','runTask','exec','jobStatus','jobStop','gitStatus','gitDiff','gitStatusExplicit','gitDiffExplicit','gitStage','gitCommit'",
"    'writeFile','deleteFile','renameFile','runTask','exec','databaseOp','jobStatus','jobStop','gitStatus','gitDiff','gitStatusExplicit','gitDiffExplicit','gitStage','gitCommit'");
replaceOnce('core/project-scope.js',
"  if (original.startWork) {",
`  if (original.databaseOp) {
    api.databaseOp = async (ref, input = {}) => {
      const action = String(input?.action || 'inspect').toLowerCase();
      const isMutation = action === 'mutate' || action === 'rollback' || !!input?.task_id;
      await ensureProject(ref, 'databaseOp', isMutation ? 'write' : 'read');
      if (input?.task_id) await guardSession(input.task_id, 'databaseOp', isMutation ? 'write' : 'read');
      return original.databaseOp(ref, input);
    };
  }

  if (original.startWork) {`);

console.log('v1.0.51 core patch staged');
