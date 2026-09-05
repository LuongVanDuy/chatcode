const fs = require('fs');
const path = require('path');

const FTP_CONFIG_RELATIVE = '.vscode/sftp.json';
const MAX_DEPLOY_FILES = 50;
const MAX_TERMINAL_COMMAND_CHARS = 15000;

function isTrusted(project) {
  return project?.workspaceMode === 'trusted' || project?.safety?._workspaceMode === 'trusted';
}

function normalizeDeployFiles(files) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(files) ? files : []) {
    const rel = String(item?.path || item || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!rel || rel === '.' || /(^|\/)\.\.($|\/)/.test(rel)) continue;
    const lower = rel.toLowerCase();
    if (lower === FTP_CONFIG_RELATIVE || lower.startsWith('.vscode/')) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(rel);
    if (out.length >= MAX_DEPLOY_FILES) break;
  }
  return out;
}

function powershellEncodedCommand(script) {
  return Buffer.from(String(script || ''), 'utf16le').toString('base64');
}

function buildFtpDeployCommand(files) {
  const changed = normalizeDeployFiles(files);
  const filesBase64 = Buffer.from(JSON.stringify(changed), 'utf8').toString('base64');
  const script = String.raw`$ErrorActionPreference='Stop'
$cfgPath=Join-Path (Get-Location) '.vscode\sftp.json'
if(-not (Test-Path -LiteralPath $cfgPath -PathType Leaf)){Write-Output 'CHATCODE_FTP_SKIP|config_missing';exit 0}
$cfg=Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
if($cfg.uploadOnSave -ne $true){Write-Output 'CHATCODE_FTP_SKIP|upload_disabled';exit 0}
$protocol=([string]$cfg.protocol).Trim().ToLowerInvariant()
if($protocol -ne 'ftp'){Write-Output ('CHATCODE_FTP_SKIP|unsupported_protocol|'+$protocol);exit 0}
$hostName=([string]$cfg.host).Trim();$user=[string]$cfg.username;$pass=[string]$cfg.password
if([string]::IsNullOrWhiteSpace($hostName) -or [string]::IsNullOrWhiteSpace($user)){throw 'FTP host/username missing in .vscode/sftp.json'}
$port=if([int]$cfg.port -gt 0){[int]$cfg.port}else{21}
$base=([string]$cfg.remotePath).Replace('\','/').Trim()
if([string]::IsNullOrWhiteSpace($base)){$base='/'}
if(-not $base.StartsWith('/')){$base='/'+$base}
$base=$base.TrimEnd('/');if(-not $base){$base=''}
$passive=if($null -eq $cfg.passive){$true}else{[bool]$cfg.passive};$ssl=[bool]$cfg.secure
$autoDelete=[bool]($null -ne $cfg.watcher -and $cfg.watcher.autoDelete -eq $true)
$cred=New-Object System.Net.NetworkCredential($user,$pass)
$filesJson=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${filesBase64}'))
$files=@($filesJson | ConvertFrom-Json)
function FtpUri([string]$remote){$parts=@($remote.Trim('/') -split '/' | Where-Object {$_});$encoded=($parts|ForEach-Object{[Uri]::EscapeDataString($_)}) -join '/';return ('ftp://{0}:{1}/{2}' -f $hostName,$port,$encoded)}
function FtpRequest([string]$remote,[string]$method){$r=[System.Net.FtpWebRequest]::Create((FtpUri $remote));$r.Method=$method;$r.Credentials=$cred;$r.UsePassive=$passive;$r.UseBinary=$true;$r.EnableSsl=$ssl;$r.KeepAlive=$false;$r.Timeout=120000;$r.ReadWriteTimeout=120000;return $r}
function EnsureDir([string]$relDir){if([string]::IsNullOrWhiteSpace($relDir)){return};$current=$base;foreach($part in @($relDir -split '/'|Where-Object{$_})){$current=$current+'/'+$part;try{$r=FtpRequest $current ([Net.WebRequestMethods+Ftp]::MakeDirectory);$q=$r.GetResponse();$q.Close()}catch [Net.WebException]{if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode;$_.Exception.Response.Close();if($code -eq 550){continue}};throw}}}
$failed=0
foreach($raw in $files){$rel=([string]$raw).Replace('\','/').TrimStart('/');if(-not $rel){continue};if($rel.ToLowerInvariant().StartsWith('.vscode/')){Write-Output ('CHATCODE_FTP_SKIP_FILE|protected|'+$rel);continue};if($rel -match '(^|/)\.\.($|/)'){Write-Output ('CHATCODE_FTP_FAIL|'+$rel+'|invalid_relative_path');$failed++;continue};$local=Join-Path (Get-Location) ($rel.Replace('/',[IO.Path]::DirectorySeparatorChar));$remote=$base+'/'+$rel;try{if(Test-Path -LiteralPath $local -PathType Leaf){$parts=@($rel -split '/');if($parts.Count -gt 1){EnsureDir (($parts[0..($parts.Count-2)]) -join '/')};$r=FtpRequest $remote ([Net.WebRequestMethods+Ftp]::UploadFile);$bytes=[IO.File]::ReadAllBytes($local);$r.ContentLength=$bytes.Length;$s=$r.GetRequestStream();try{$s.Write($bytes,0,$bytes.Length)}finally{$s.Dispose()};$q=$r.GetResponse();$q.Close();Write-Output ('CHATCODE_FTP_OK|upload|'+$rel)}elseif($autoDelete){try{$r=FtpRequest $remote ([Net.WebRequestMethods+Ftp]::DeleteFile);$q=$r.GetResponse();$q.Close();Write-Output ('CHATCODE_FTP_OK|delete|'+$rel)}catch [Net.WebException]{if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode;$_.Exception.Response.Close();if($code -eq 550){Write-Output ('CHATCODE_FTP_SKIP_FILE|remote_missing|'+$rel);continue}};throw}}else{Write-Output ('CHATCODE_FTP_SKIP_FILE|local_missing|'+$rel)}}catch{$msg=($_.Exception.Message -replace '[\r\n|]',' ');Write-Output ('CHATCODE_FTP_FAIL|'+$rel+'|'+$msg);$failed++}}
if($failed -gt 0){exit 2}
exit 0`;
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${powershellEncodedCommand(script)}`;
}

function buildFtpDeployBatches(files, maxCommandChars = MAX_TERMINAL_COMMAND_CHARS) {
  const normalized = normalizeDeployFiles(files);
  const batches = [];
  let current = [];
  for (const file of normalized) {
    const candidate = [...current, file];
    const command = buildFtpDeployCommand(candidate);
    if (command.length <= maxCommandChars) {
      current = candidate;
      continue;
    }
    if (!current.length) throw new Error(`FTP deploy command exceeds terminal guard for file: ${file}`);
    batches.push(current);
    current = [file];
    if (buildFtpDeployCommand(current).length > maxCommandChars) {
      throw new Error(`FTP deploy command exceeds terminal guard for file: ${file}`);
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

function parseDeployResult(raw, files) {
  const stdout = String(raw?.stdout || '');
  const stderr = String(raw?.stderr || '');
  const uploaded = [], deleted = [], skippedFiles = [], failures = [];
  let skipReason = '';
  for (const line of stdout.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    const parts = line.split('|');
    if (parts[0] === 'CHATCODE_FTP_OK' && parts[1] === 'upload' && parts[2]) uploaded.push(parts.slice(2).join('|'));
    else if (parts[0] === 'CHATCODE_FTP_OK' && parts[1] === 'delete' && parts[2]) deleted.push(parts.slice(2).join('|'));
    else if (parts[0] === 'CHATCODE_FTP_SKIP' && parts[1]) skipReason = parts.slice(1).join('|');
    else if (parts[0] === 'CHATCODE_FTP_SKIP_FILE' && parts[2]) skippedFiles.push({ reason:parts[1] || 'skipped', file:parts.slice(2).join('|') });
    else if (parts[0] === 'CHATCODE_FTP_FAIL') failures.push({ file:parts[1] || '', error:parts.slice(2).join('|') || 'FTP upload failed' });
  }
  const commandOk = raw?.status === 'completed' && Number(raw?.exit_code) === 0;
  if (skipReason && commandOk) return { ok:true, status:'skipped', reason:skipReason, changed_files:files, uploaded, deleted, skipped_files:skippedFiles, failures:[] };
  const ok = commandOk && failures.length === 0;
  return {
    ok,
    status:ok ? 'completed' : 'failed',
    changed_files:files,
    uploaded,
    deleted,
    skipped_files:skippedFiles,
    failures,
    ...(ok ? {} : { error:(failures[0]?.error || stderr.trim() || `Terminal FTP exited with code ${raw?.exit_code ?? 'unknown'}`).slice(0, 800) })
  };
}

async function deployChangedFiles(api, store, projectRef, changedFiles) {
  const files = normalizeDeployFiles(changedFiles);
  if (!files.length) return { ok:true, status:'skipped', reason:'no_changed_files', changed_files:[] };
  let project;
  try { project = store?.getProject?.(projectRef); } catch { return { ok:false, status:'failed', reason:'project_not_found', changed_files:files }; }
  const root = String(project?.root || '');
  if (!root) return { ok:true, status:'not_configured', reason:'project_root_missing', changed_files:files };
  const configPath = path.join(root, '.vscode', 'sftp.json');
  if (!fs.existsSync(configPath)) return { ok:true, status:'not_configured', reason:'config_missing', changed_files:files };
  if (!isTrusted(project) || typeof api?.exec !== 'function') return { ok:false, status:'skipped', reason:'trusted_terminal_required', changed_files:files };

  let batches;
  try { batches = buildFtpDeployBatches(files); }
  catch (error) { return { ok:false, status:'failed', changed_files:files, uploaded:[], deleted:[], skipped_files:[], failures:[], error:String(error?.message || error).slice(0,800) }; }

  const uploaded = [], deleted = [], skippedFiles = [], failures = [];
  for (const batch of batches) {
    try {
      const raw = await api.exec(project.id, buildFtpDeployCommand(batch), { background:false, timeout_ms:180000 });
      const parsed = parseDeployResult(raw, batch);
      if (parsed.status === 'skipped' && parsed.reason) {
        return { ...parsed, changed_files:files, batch_count:batches.length };
      }
      uploaded.push(...parsed.uploaded);
      deleted.push(...parsed.deleted);
      skippedFiles.push(...parsed.skipped_files);
      failures.push(...parsed.failures);
      if (!parsed.ok && !parsed.failures.length) failures.push({ file:batch.join(', '), error:parsed.error || 'FTP terminal batch failed' });
    } catch (error) {
      failures.push({ file:batch.join(', '), error:String(error?.message || error || 'FTP terminal deploy failed').slice(0,800) });
    }
  }

  const ok = failures.length === 0;
  return {
    ok,
    status:ok ? 'completed' : 'failed',
    changed_files:files,
    uploaded,
    deleted,
    skipped_files:skippedFiles,
    failures,
    batch_count:batches.length,
    ...(ok ? {} : { error:(failures[0]?.error || 'FTP terminal deploy failed').slice(0,800) })
  };
}

function createFtpDeployApi(api, store) {
  if (!api || typeof api.finishWork !== 'function' || api.__ftpDeployWrapped) return api;
  api.__ftpDeployWrapped = true;
  const originalFinishWork = api.finishWork.bind(api);
  api.finishWork = async (workSessionId, ...args) => {
    let before = null;
    try { if (typeof api.workStatus === 'function') before = await api.workStatus(workSessionId); } catch {}
    const result = await originalFinishWork(workSessionId, ...args);
    if (result?.status !== 'completed') return result;
    const projectRef = result?.project_id || result?.project || before?.project_id || before?.project || '';
    const changedFiles = result?.changed_files || before?.changed_files || [];
    if (!projectRef) return result;
    const ftp = await deployChangedFiles(api, store, projectRef, changedFiles);
    if (ftp.status === 'not_configured' || ftp.reason === 'no_changed_files') return result;
    return { ...result, ftp_deploy:ftp };
  };
  return api;
}

function installFtpDeployPatches() {
  const safety = require('./safety-tools');
  if (safety.__ftpDeployPatched) return;
  safety.__ftpDeployPatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function ftpDeploySafeToolApi(projects, store, approvals, backups, options) {
    return createFtpDeployApi(previousCreate(projects, store, approvals, backups, options), store);
  };
}

module.exports = {
  FTP_CONFIG_RELATIVE,
  MAX_DEPLOY_FILES,
  MAX_TERMINAL_COMMAND_CHARS,
  normalizeDeployFiles,
  buildFtpDeployCommand,
  buildFtpDeployBatches,
  parseDeployResult,
  deployChangedFiles,
  createFtpDeployApi,
  installFtpDeployPatches
};
