const fs = require('fs');
const os = require('os');
const path = require('path');
const { completionWithDeployStatus } = require('./completion-deploy-policy');

const FTP_CONFIG_RELATIVE = '.vscode/sftp.json';
const MAX_DEPLOY_FILES = 500;
const MAX_TERMINAL_COMMAND_CHARS = 15000;

function isTrusted(project) {
  return project?.workspaceMode === 'trusted' || project?.safety?._workspaceMode === 'trusted';
}

function isProtectedDeployPath(rel) {
  const lower = String(rel || '').toLowerCase();
  return lower === FTP_CONFIG_RELATIVE
    || lower.startsWith('.vscode/')
    || lower === '.git' || lower.startsWith('.git/')
    || lower === '.chatcode' || lower.startsWith('.chatcode/')
    || lower === 'wp-config.php'
    || lower === '.env' || lower.startsWith('.env.');
}

function normalizeDeployFiles(files) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(files) ? files : []) {
    const rel = String(item?.path || item || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!rel || rel === '.' || /(^|\/)\.\.($|\/)/.test(rel) || isProtectedDeployPath(rel)) continue;
    const lower = rel.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(rel);
  }
  return out;
}

function changedFilesFromLegacyChanges(changes) {
  const files = [];
  for (const change of Array.isArray(changes) ? changes : []) {
    const op = String(change?.op || change?.operation || '').toLowerCase();
    if (op === 'rename' || op === 'move') files.push(change?.to);
    else if (['write','patch'].includes(op)) files.push(change?.path);
    // Remote deletion is never inferred from a missing local file. A future explicit
    // remote-delete operation can be added without reviving watcher.autoDelete behavior.
  }
  return normalizeDeployFiles(files);
}

function powershellEncodedCommand(script) {
  return Buffer.from(String(script || ''), 'utf16le').toString('base64');
}

function resolveFtpRunnerPath() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'tools', 'deploy-ftp.ps1'));
  candidates.push(path.resolve(__dirname, '..', 'tools', 'deploy-ftp.ps1'));
  return candidates.find(file => fs.existsSync(file)) || '';
}

function buildFtpDeployCommand(runnerPath, projectRoot, manifestPath) {
  const payload = Buffer.from(JSON.stringify({ runnerPath, projectRoot, manifestPath }), 'utf8').toString('base64');
  const script = String.raw`$ErrorActionPreference='Stop'
$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
& ([string]$data.runnerPath) -ProjectRoot ([string]$data.projectRoot) -Manifest ([string]$data.manifestPath)`;
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${powershellEncodedCommand(script)}`;
}

function buildFtpDeployBatches(files) {
  const normalized = normalizeDeployFiles(files);
  return normalized.length ? [normalized] : [];
}

function createDeployManifest(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-ftp-manifest-'));
  const manifestPath = path.join(dir, 'ftp-files.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ files }, null, 2), 'utf8');
  return { dir, manifestPath };
}

function cleanupDeployManifest(dir) {
  const resolved = path.resolve(String(dir || ''));
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('chatcode-ftp-manifest-')) {
    fs.rmSync(resolved, { recursive:true, force:true });
  }
}

function parseDeployResult(raw, files = [], skippedFiles = []) {
  const stdout = String(raw?.stdout || '');
  const stderr = String(raw?.stderr || '');
  const start = stdout.indexOf('{');
  let report = null;
  if (start >= 0) {
    try { report = JSON.parse(stdout.slice(start)); } catch {}
  }

  const uploaded = [], unchanged = [], failures = [];
  for (const item of Array.isArray(report?.files) ? report.files : []) {
    const file = String(item?.file || '');
    const status = String(item?.status || '');
    if (status === 'uploaded' && file) uploaded.push(file);
    else if (status === 'unchanged' && file) unchanged.push(file);
    else if (status === 'failed') failures.push({ file, error:String(item?.error || 'FTP runner failed').slice(0,800) });
  }

  const commandOk = raw?.status === 'completed' && Number(raw?.exit_code) === 0;
  const reportOk = report?.ok === true;
  if (!report && !failures.length) failures.push({ file:'', error:'FTP runner returned no JSON report' });
  if (report && !reportOk && !failures.length) {
    failures.push({ file:'', error:String(report?.cleanup_warnings?.[0] || stderr.trim() || 'FTP runner reported failure').slice(0,800) });
  }
  const ok = commandOk && reportOk && failures.length === 0;

  return {
    ok,
    status:ok ? 'completed' : 'failed',
    changed_files:files,
    uploaded,
    unchanged,
    deleted:[],
    skipped_files:skippedFiles,
    failures,
    not_attempted:Array.isArray(report?.not_attempted) ? report.not_attempted : [],
    cleanup_warnings:Array.isArray(report?.cleanup_warnings) ? report.cleanup_warnings : [],
    curl_requests:Number(report?.curl_requests || 0),
    batch_count:files.length ? 1 : 0,
    runner:'sha256-staging',
    ...(ok ? {} : { error:(failures[0]?.error || stderr.trim() || `Terminal FTP exited with code ${raw?.exit_code ?? 'unknown'}`).slice(0,800) })
  };
}

function autoDeployConfig(root) {
  const configPath = path.join(root, '.vscode', 'sftp.json');
  if (!fs.existsSync(configPath)) return { ok:true, status:'not_configured', reason:'config_missing' };
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { return { ok:false, status:'failed', reason:'config_invalid', error:'Cannot read .vscode/sftp.json as JSON' }; }
  if (config?.uploadOnSave !== true) return { ok:true, status:'skipped', reason:'upload_disabled' };
  const protocol = String(config?.protocol || '').trim().toLowerCase();
  if (protocol !== 'ftp') return { ok:true, status:'skipped', reason:`unsupported_protocol|${protocol || 'missing'}` };
  return { ok:true, status:'enabled' };
}

async function deployChangedFiles(api, store, projectRef, changedFiles) {
  const files = normalizeDeployFiles(changedFiles);
  if (!files.length) return { ok:true, status:'skipped', reason:'no_changed_files', changed_files:[] };
  if (files.length > MAX_DEPLOY_FILES) {
    return { ok:false, status:'failed', changed_files:files, uploaded:[], unchanged:[], deleted:[], skipped_files:[], failures:[], error:`FTP deploy supports at most ${MAX_DEPLOY_FILES} files per completion` };
  }

  let project;
  try { project = store?.getProject?.(projectRef); } catch { return { ok:false, status:'failed', reason:'project_not_found', changed_files:files }; }
  const root = String(project?.root || '');
  if (!root) return { ok:true, status:'not_configured', reason:'project_root_missing', changed_files:files };

  const config = autoDeployConfig(root);
  if (config.status !== 'enabled') return { ...config, changed_files:files };
  if (!isTrusted(project) || typeof api?.exec !== 'function') return { ok:false, status:'skipped', reason:'trusted_terminal_required', changed_files:files };

  const runnerPath = resolveFtpRunnerPath();
  if (!runnerPath) return { ok:false, status:'failed', reason:'runner_missing', changed_files:files, error:'FTP runner tools/deploy-ftp.ps1 is not available' };

  const deployable = [];
  const skippedFiles = [];
  for (const file of files) {
    const local = path.join(root, ...file.split('/'));
    let isFile = false;
    try { isFile = fs.statSync(local).isFile(); } catch {}
    if (isFile) deployable.push(file);
    else skippedFiles.push({ reason:'local_missing_no_delete', file });
  }

  if (!deployable.length) {
    return {
      ok:true, status:'completed', changed_files:files, uploaded:[], unchanged:[], deleted:[], skipped_files:skippedFiles,
      failures:[], not_attempted:[], cleanup_warnings:[], curl_requests:0, batch_count:0, runner:'sha256-staging'
    };
  }

  const manifest = createDeployManifest(deployable);
  try {
    const command = buildFtpDeployCommand(runnerPath, root, manifest.manifestPath);
    if (command.length > MAX_TERMINAL_COMMAND_CHARS) {
      return { ok:false, status:'failed', changed_files:files, uploaded:[], unchanged:[], deleted:[], skipped_files:skippedFiles, failures:[], error:'FTP runner invocation exceeds terminal guard' };
    }
    const raw = await api.exec(project.id, command, { background:false, timeout_ms:180000 });
    return parseDeployResult(raw, files, skippedFiles);
  } catch (error) {
    return {
      ok:false, status:'failed', changed_files:files, uploaded:[], unchanged:[], deleted:[], skipped_files:skippedFiles,
      failures:[{ file:deployable.join(', '), error:String(error?.message || error || 'FTP runner failed').slice(0,800) }],
      error:String(error?.message || error || 'FTP runner failed').slice(0,800), runner:'sha256-staging'
    };
  } finally {
    cleanupDeployManifest(manifest.dir);
  }
}

function shouldAttachFtpResult(ftp) {
  return ftp && ftp.status !== 'not_configured' && ftp.reason !== 'no_changed_files';
}

function mergeFtpProgress(prior, current, changedFiles) {
  if (!prior) return current;
  const skipped = [...(prior.skipped_files || []), ...(current.skipped_files || [])];
  const seenSkipped = new Set();
  return {
    ...current,
    changed_files:changedFiles,
    uploaded:[...new Set([...(prior.uploaded || []), ...(current.uploaded || [])])],
    unchanged:[...new Set([...(prior.unchanged || []), ...(current.unchanged || [])])],
    deleted:[...new Set([...(prior.deleted || []), ...(current.deleted || [])])],
    skipped_files:skipped.filter(item => {
      const key = `${item?.reason || ''}|${item?.file || ''}`;
      if (seenSkipped.has(key)) return false;
      seenSkipped.add(key);
      return true;
    })
  };
}

function createFtpDeployApi(api, store) {
  if (!api || api.__ftpDeployWrapped) return api;
  if (typeof api.finishWork !== 'function' && typeof api.applyAndVerify !== 'function') return api;
  api.__ftpDeployWrapped = true;
  const finishedDeploys = new Map();
  const finishing = new Map();

  if (typeof api.finishWork === 'function') {
    const originalFinishWork = api.finishWork.bind(api);
    api.finishWork = async (workSessionId, ...args) => {
      if (args[1]?.cancel) return originalFinishWork(workSessionId, ...args);
      if (finishing.has(workSessionId)) return finishing.get(workSessionId);
      const run = async () => {
        let before = null;
        try { if (typeof api.workStatus === 'function') before = await api.workStatus(workSessionId); } catch {}
        const previous = finishedDeploys.get(workSessionId);
        if (before?.status === 'completed' && previous?.ftp_deploy?.ok) return previous;
        const result = await originalFinishWork(workSessionId, ...args);
        if (result?.status !== 'completed') return result;
        const projectRef = result?.project_id || result?.project || before?.project_id || before?.project || '';
        const changedFiles = result?.changed_files || before?.changed_files || [];
        if (!projectRef) return result;
        const prior = before?.status === 'completed' ? previous?.ftp_deploy : null;
        const done = new Set([
          ...(prior?.uploaded || []), ...(prior?.unchanged || []), ...(prior?.deleted || []),
          ...(prior?.skipped_files || []).filter(item => item?.reason === 'local_missing_no_delete').map(item => item.file)
        ]);
        const ftp = mergeFtpProgress(prior, await deployChangedFiles(api, store, projectRef, changedFiles.filter(file => !done.has(file))), changedFiles);
        const completed = shouldAttachFtpResult(ftp) ? completionWithDeployStatus({ ...result, ftp_deploy:ftp }) : result;
        finishedDeploys.set(workSessionId, completed);
        while (finishedDeploys.size > 200) finishedDeploys.delete(finishedDeploys.keys().next().value);
        return completed;
      };
      const pending = run();
      finishing.set(workSessionId, pending);
      try { return await pending; } finally { finishing.delete(workSessionId); }
    };
  }

  if (typeof api.applyAndVerify === 'function') {
    const originalApplyAndVerify = api.applyAndVerify.bind(api);
    api.applyAndVerify = async (ref, changes = [], tasks = []) => {
      const result = await originalApplyAndVerify(ref, changes, tasks);
      if (result?.status !== 'completed' || result?.ok === false || result?.verification_passed === false) return result;
      const changedFiles = changedFilesFromLegacyChanges(changes);
      if (!changedFiles.length) return result;
      const ftp = await deployChangedFiles(api, store, ref, changedFiles);
      return shouldAttachFtpResult(ftp) ? completionWithDeployStatus({ ...result, ftp_deploy:ftp }) : result;
    };
  }

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
  changedFilesFromLegacyChanges,
  resolveFtpRunnerPath,
  buildFtpDeployCommand,
  buildFtpDeployBatches,
  parseDeployResult,
  deployChangedFiles,
  createFtpDeployApi,
  installFtpDeployPatches
};
