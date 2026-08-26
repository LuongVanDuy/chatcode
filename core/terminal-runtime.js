const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const { chatError } = require('./errors');

const MAX_STREAM_CHARS = 1024 * 1024;
const MAX_JOBS = 80;
const COMPLETED_TTL_MS = 45 * 60 * 1000;
const MAX_RUNNING_PER_PROJECT = 8;

function isTrusted(project) {
  return project?.workspaceMode === 'trusted' || project?.safety?._workspaceMode === 'trusted';
}

function commandGuard(command) {
  const raw = String(command || '').trim();
  if (!raw) throw chatError('TASK_NOT_ALLOWED', 'Command không được để trống.');

  const blocked = [
    { re:/(^|[;&|]\s*)["']?git(?:\.exe)?["']?\s+(?:-[^\s]+\s+)*push(?:\s|$)/i, reason:'Git push đang tắt trong Trusted Workspace.' },
    { re:/(^|[;&|]\s*)["']?git(?:\.exe)?["']?\s+(?:-[^\s]+\s+)*reset\s+--hard(?:\s|$)/i, reason:'git reset --hard bị khóa để tránh mất dữ liệu local.' },
    { re:/(^|[;&|]\s*)(shutdown|shutdown\.exe|reboot|poweroff)(\s|$)/i, reason:'Lệnh tắt/khởi động lại hệ điều hành bị khóa.' },
    { re:/(^|[;&|]\s*)(format|format\.com|diskpart|bcdedit)(\s|$)/i, reason:'Lệnh quản trị đĩa/boot bị khóa.' },
    { re:/(^|[;&|]\s*)rm\s+-[^\n]*r[^\n]*f[^\n]*\s+\/(\s|$)/i, reason:'Lệnh xóa root filesystem bị khóa.' }
  ];
  const hit = blocked.find(item => item.re.test(raw));
  if (hit) throw chatError('TASK_NOT_ALLOWED', hit.reason, { command:raw.slice(0, 240), trusted_terminal:true });
  return raw;
}

function appendBounded(current, chunk) {
  const next = current + String(chunk || '');
  return next.length <= MAX_STREAM_CHARS ? next : next.slice(next.length - MAX_STREAM_CHARS);
}

function createTerminalRuntime(store, projects) {
  const jobs = new Map();

  function prune() {
    const cutoff = Date.now() - COMPLETED_TTL_MS;
    for (const [id, job] of jobs) {
      const end = Date.parse(job.completedAt || '') || 0;
      if (job.status !== 'running' && end && end < cutoff) jobs.delete(id);
    }
    if (jobs.size <= MAX_JOBS) return;
    const removable = [...jobs.values()].filter(job => job.status !== 'running').sort((a,b) => Date.parse(a.completedAt || a.createdAt) - Date.parse(b.completedAt || b.createdAt));
    while (jobs.size > MAX_JOBS && removable.length) jobs.delete(removable.shift().id);
  }

  function publicJob(job, { stdoutOffset = 0, stderrOffset = 0 } = {}) {
    const outStart = Math.max(0, Math.min(Number(stdoutOffset) || 0, job.stdout.length));
    const errStart = Math.max(0, Math.min(Number(stderrOffset) || 0, job.stderr.length));
    return {
      ok:job.status === 'running' ? true : job.exitCode === 0,
      job_id:job.id,
      project:job.project,
      project_id:job.projectId,
      command:job.command,
      cwd:job.cwdRel || '.',
      status:job.status,
      pid:job.pid || null,
      exit_code:job.exitCode,
      signal:job.signal || null,
      created_at:job.createdAt,
      started_at:job.startedAt,
      completed_at:job.completedAt || null,
      duration_ms:job.completedAt ? Math.max(0, Date.parse(job.completedAt) - Date.parse(job.startedAt)) : Math.max(0, Date.now() - Date.parse(job.startedAt)),
      stdout:job.stdout.slice(outStart),
      stderr:job.stderr.slice(errStart),
      stdout_offset:job.stdout.length,
      stderr_offset:job.stderr.length,
      output_truncated:job.stdoutTruncated || job.stderrTruncated,
      background:job.background,
      terminal:{ hidden:true, shell:process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', cwd_inside_project:true, os_filesystem_sandbox:false },
      approval:{ required:false, status:'not_required', approval_id:null, mode:'trusted_workspace' }
    };
  }

  async function resolveCwd(project, requested) {
    const rel = String(requested || '').trim().replace(/\\/g, '/') || '.';
    const target = await projects.secureResolve(project, rel, { mustExist:true });
    const stat = await fsp.stat(target);
    if (!stat.isDirectory()) throw chatError('FILE_NOT_FOUND', 'cwd phải là một thư mục tồn tại bên trong project.', { cwd:rel });
    return { abs:target, rel:rel === '.' ? '.' : rel.replace(/^\.\//, '') };
  }

  function shellCommand(command) {
    if (process.platform === 'win32') return { file:process.env.ComSpec || 'cmd.exe', args:['/d','/s','/c',command] };
    return { file:'/bin/sh', args:['-lc',command] };
  }

  function stopTree(job) {
    if (!job.child || job.status !== 'running') return Promise.resolve(false);
    return new Promise(resolve => {
      if (process.platform === 'win32' && job.pid) {
        childProcess.execFile('taskkill.exe', ['/pid', String(job.pid), '/t', '/f'], { windowsHide:true, shell:false, timeout:10000 }, () => resolve(true));
        return;
      }
      try { job.child.kill('SIGTERM'); resolve(true); } catch { resolve(false); }
    });
  }

  async function exec(ref, commandInput, options = {}) {
    prune();
    const project = store.getProject(ref);
    if (!isTrusted(project)) throw chatError('PERMISSION_DENIED', 'Generic exec chỉ khả dụng khi project ở Trusted Workspace.', { project:project.name, required_workspace_mode:'trusted' });
    const command = commandGuard(commandInput);
    const running = [...jobs.values()].filter(job => job.projectId === project.id && job.status === 'running').length;
    if (running >= MAX_RUNNING_PER_PROJECT) throw chatError('TASK_NOT_ALLOWED', `Project đang có ${running} terminal job chạy nền. Hãy dừng job cũ trước.`, { limit:MAX_RUNNING_PER_PROJECT });

    const cwd = await resolveCwd(project, options.cwd);
    const background = !!options.background;
    const timeoutMs = Math.min(30 * 60 * 1000, Math.max(1000, Number(options.timeout_ms) || 120000));
    const shell = shellCommand(command);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = {
      id, project:project.name, projectId:project.id, command, cwdRel:cwd.rel,
      status:'running', pid:null, exitCode:null, signal:'', stdout:'', stderr:'',
      stdoutTruncated:false, stderrTruncated:false, background,
      createdAt:now, startedAt:now, completedAt:'', child:null, timeout:null
    };
    jobs.set(id, job);

    let child;
    try {
      child = childProcess.spawn(shell.file, shell.args, {
        cwd:cwd.abs,
        windowsHide:true,
        shell:false,
        stdio:['ignore','pipe','pipe'],
        env:{ ...process.env, CHATCODE_WORKSPACE:project.root, CHATCODE_PROJECT_ID:project.id }
      });
      job.child = child;
      job.pid = child.pid || null;
    } catch (error) {
      job.status = 'failed'; job.stderr = String(error?.message || error); job.completedAt = new Date().toISOString();
      throw error;
    }

    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { const before=job.stdout.length; job.stdout=appendBounded(job.stdout, chunk); if (before + String(chunk).length > MAX_STREAM_CHARS) job.stdoutTruncated=true; });
    child.stderr?.on('data', chunk => { const before=job.stderr.length; job.stderr=appendBounded(job.stderr, chunk); if (before + String(chunk).length > MAX_STREAM_CHARS) job.stderrTruncated=true; });

    const done = new Promise(resolve => {
      child.once('error', error => {
        job.stderr = appendBounded(job.stderr, error?.message || error);
        if (job.status === 'running') job.status = 'failed';
      });
      child.once('close', (code, signal) => {
        if (job.timeout) clearTimeout(job.timeout);
        job.exitCode = Number.isInteger(code) ? code : null;
        job.signal = signal || '';
        if (job.status === 'running') job.status = code === 0 ? 'completed' : 'failed';
        job.completedAt = new Date().toISOString();
        job.child = null;
        prune();
        resolve(publicJob(job));
      });
    });

    if (!background) {
      job.timeout = setTimeout(async () => {
        if (job.status !== 'running') return;
        job.status = 'timeout';
        job.stderr = appendBounded(job.stderr, `\nChatCode: timeout sau ${timeoutMs} ms.`);
        await stopTree(job);
      }, timeoutMs);
      return done;
    }

    return publicJob(job);
  }

  function status(jobId, options = {}) {
    prune();
    const job = jobs.get(String(jobId || ''));
    if (!job) throw chatError('FILE_NOT_FOUND', 'Không tìm thấy terminal job hoặc job đã hết thời gian lưu.', { job_id:String(jobId || '') });
    return publicJob(job, { stdoutOffset:options.stdout_offset, stderrOffset:options.stderr_offset });
  }

  async function stop(jobId) {
    prune();
    const job = jobs.get(String(jobId || ''));
    if (!job) throw chatError('FILE_NOT_FOUND', 'Không tìm thấy terminal job.', { job_id:String(jobId || '') });
    if (job.status !== 'running') return publicJob(job);
    job.status = 'stopping';
    const stopped = await stopTree(job);
    if (!stopped && job.status === 'stopping') job.status = 'failed';
    return { ...publicJob(job), stop_requested:stopped };
  }

  async function shutdown() {
    const running = [...jobs.values()].filter(job => job.status === 'running' || job.status === 'stopping');
    await Promise.all(running.map(job => stopTree(job).catch(() => false)));
  }

  return { exec, status, stop, shutdown, jobs };
}

function installTerminalRuntimePatches() {
  const safetyModule = require('./safety-tools');
  if (safetyModule.__terminalRuntimePatched) return;
  safetyModule.__terminalRuntimePatched = true;
  const previousCreate = safetyModule.createSafeToolApi;
  safetyModule.createSafeToolApi = function terminalAwareSafeToolApi(projects, store, approvals, backups, options) {
    const api = previousCreate(projects, store, approvals, backups, options);
    const runtime = createTerminalRuntime(store, projects);
    api.exec = (ref, command, opts) => runtime.exec(ref, command, opts || {});
    api.jobStatus = (jobId, opts) => runtime.status(jobId, opts || {});
    api.jobStop = jobId => runtime.stop(jobId);
    api.shutdownTerminalJobs = () => runtime.shutdown();
    return api;
  };
}

module.exports = { createTerminalRuntime, installTerminalRuntimePatches, commandGuard };
