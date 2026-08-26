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
const MAX_TIMEOUT_MS = 12 * 60 * 60 * 1000;

function isTrusted(project) {
  return project?.workspaceMode === 'trusted' || project?.safety?._workspaceMode === 'trusted';
}

function commandGuard(command) {
  const raw = String(command || '').trim();
  if (!raw) throw chatError('TASK_NOT_ALLOWED', 'Command không được để trống.');
  if (raw.length > 16000) throw chatError('TASK_NOT_ALLOWED', 'Command quá dài.', { length:raw.length });

  const blocked = [
    { re:/\bgit(?:\.exe)?\b[^\r\n]{0,320}?\bpush\b/i, reason:'Git push đang tắt trong Trusted Workspace.' },
    { re:/\bgit(?:\.exe)?\b[^\r\n]{0,320}?\breset\s+--hard\b/i, reason:'git reset --hard bị khóa để tránh mất dữ liệu local.' },
    { re:/(^|[;&|]\s*)(?:"[^"]*"\s*)?(shutdown|shutdown\.exe|reboot|poweroff)(\s|$)/i, reason:'Lệnh tắt/khởi động lại hệ điều hành bị khóa.' },
    { re:/(^|[;&|]\s*)(?:"[^"]*"\s*)?(format|format\.com|diskpart|bcdedit)(\s|$)/i, reason:'Lệnh quản trị đĩa/boot bị khóa.' },
    { re:/(^|[;&|]\s*)rm\s+-[^\r\n]*r[^\r\n]*f[^\r\n]*\s+\/(?:\s|$)/i, reason:'Lệnh xóa root filesystem bị khóa.' }
  ];
  const hit = blocked.find(item => item.re.test(raw));
  if (hit) throw chatError('TASK_NOT_ALLOWED', hit.reason, { command:raw.slice(0, 240), trusted_terminal:true });
  return raw;
}

function appendStream(job, key, chunk) {
  const raw = String(chunk || '');
  if (!raw) return;
  const totalKey = `${key}Total`, baseKey = `${key}Base`, truncatedKey = `${key}Truncated`;
  job[totalKey] += raw.length;
  job[key] += raw;
  if (job[key].length > MAX_STREAM_CHARS) {
    const remove = job[key].length - MAX_STREAM_CHARS;
    job[key] = job[key].slice(remove);
    job[baseKey] += remove;
    job[truncatedKey] = true;
  }
}

function streamWindow(job, key, requestedOffset) {
  const base = job[`${key}Base`], total = job[`${key}Total`];
  const requested = Math.max(0, Number(requestedOffset) || 0);
  const effective = Math.max(base, Math.min(requested, total));
  return {
    text:job[key].slice(effective - base),
    offset:total,
    base,
    missed:requested < base
  };
}

function createTerminalRuntime(store, projects, { onChanged } = {}) {
  const jobs = new Map();

  function emit(job) {
    if (typeof onChanged !== 'function') return;
    try { onChanged(publicJob(job, { includeOutput:false })); } catch {}
  }

  function prune() {
    const cutoff = Date.now() - COMPLETED_TTL_MS;
    for (const [id, job] of jobs) {
      const end = Date.parse(job.completedAt || '') || 0;
      if (!['running','stopping'].includes(job.status) && end && end < cutoff) jobs.delete(id);
    }
    if (jobs.size <= MAX_JOBS) return;
    const removable = [...jobs.values()]
      .filter(job => !['running','stopping'].includes(job.status))
      .sort((a,b) => Date.parse(a.completedAt || a.createdAt) - Date.parse(b.completedAt || b.createdAt));
    while (jobs.size > MAX_JOBS && removable.length) jobs.delete(removable.shift().id);
  }

  function publicJob(job, { stdoutOffset = 0, stderrOffset = 0, includeOutput = true } = {}) {
    const out = streamWindow(job, 'stdout', stdoutOffset);
    const err = streamWindow(job, 'stderr', stderrOffset);
    const active = ['running','stopping'].includes(job.status);
    const successful = job.status === 'completed' || job.status === 'stopped';
    return {
      ok:active || successful,
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
      ...(includeOutput ? { stdout:out.text, stderr:err.text } : {}),
      stdout_offset:out.offset,
      stderr_offset:err.offset,
      stdout_base_offset:out.base,
      stderr_base_offset:err.base,
      stdout_missed:out.missed,
      stderr_missed:err.missed,
      output_truncated:job.stdoutTruncated || job.stderrTruncated,
      background:job.background,
      timeout_ms:job.timeoutMs,
      stop_reason:job.stopReason || '',
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

  function stopTree(job, force = true) {
    if (!job.child || !['running','stopping','timeout'].includes(job.status)) return Promise.resolve(false);
    if (process.platform === 'win32' && job.pid) {
      return new Promise(resolve => {
        childProcess.execFile('taskkill.exe', ['/pid', String(job.pid), '/t', ...(force ? ['/f'] : [])], { windowsHide:true, shell:false, timeout:10000 }, error => {
          if (error) { try { job.child?.kill(); } catch {} }
          resolve(true);
        });
      });
    }
    try {
      if (job.pid) process.kill(-job.pid, force ? 'SIGKILL' : 'SIGTERM');
      else job.child.kill(force ? 'SIGKILL' : 'SIGTERM');
      return Promise.resolve(true);
    } catch {
      try { job.child.kill(force ? 'SIGKILL' : 'SIGTERM'); return Promise.resolve(true); }
      catch { return Promise.resolve(false); }
    }
  }

  function armTimeout(job) {
    if (!job.timeoutMs) return;
    job.timeout = setTimeout(async () => {
      if (!['running','stopping'].includes(job.status)) return;
      job.status = 'timeout';
      job.stopReason = 'timeout';
      appendStream(job, 'stderr', `\nChatCode: timeout sau ${job.timeoutMs} ms.`);
      emit(job);
      await stopTree(job, true);
    }, job.timeoutMs);
    job.timeout.unref?.();
  }

  async function exec(ref, commandInput, options = {}) {
    prune();
    const project = store.getProject(ref);
    if (!isTrusted(project)) throw chatError('PERMISSION_DENIED', 'Generic exec chỉ khả dụng khi project ở Trusted Workspace.', { project:project.name, required_workspace_mode:'trusted' });
    const command = commandGuard(commandInput);
    const running = [...jobs.values()].filter(job => job.projectId === project.id && ['running','stopping'].includes(job.status)).length;
    if (running >= MAX_RUNNING_PER_PROJECT) throw chatError('TASK_NOT_ALLOWED', `Project đang có ${running} terminal job chạy nền. Hãy dừng job cũ trước.`, { limit:MAX_RUNNING_PER_PROJECT });

    const cwd = await resolveCwd(project, options.cwd);
    const background = !!options.background;
    const requestedTimeout = Number(options.timeout_ms);
    const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.min(MAX_TIMEOUT_MS, Math.max(1000, requestedTimeout))
      : (background ? 0 : 120000);
    const shell = shellCommand(command);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = {
      id, project:project.name, projectId:project.id, command, cwdRel:cwd.rel,
      status:'running', pid:null, exitCode:null, signal:'', stdout:'', stderr:'',
      stdoutTotal:0, stderrTotal:0, stdoutBase:0, stderrBase:0,
      stdoutTruncated:false, stderrTruncated:false, background, timeoutMs,
      createdAt:now, startedAt:now, completedAt:'', stopReason:'', child:null, timeout:null, done:null
    };
    jobs.set(id, job);

    let child;
    try {
      child = childProcess.spawn(shell.file, shell.args, {
        cwd:cwd.abs,
        windowsHide:true,
        shell:false,
        detached:process.platform !== 'win32',
        stdio:['ignore','pipe','pipe'],
        env:{ ...process.env, CHATCODE_WORKSPACE:project.root, CHATCODE_PROJECT_ID:project.id }
      });
      job.child = child;
      job.pid = child.pid || null;
    } catch (error) {
      job.status = 'failed';
      appendStream(job, 'stderr', error?.message || error);
      job.completedAt = new Date().toISOString();
      emit(job);
      throw error;
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { appendStream(job, 'stdout', chunk); emit(job); });
    child.stderr?.on('data', chunk => { appendStream(job, 'stderr', chunk); emit(job); });

    job.done = new Promise(resolve => {
      child.once('error', error => {
        appendStream(job, 'stderr', `${job.stderr ? '\n' : ''}${error?.message || error}`);
        if (job.status === 'running') job.status = 'failed';
        emit(job);
      });
      child.once('close', (code, signal) => {
        if (job.timeout) clearTimeout(job.timeout);
        job.exitCode = Number.isInteger(code) ? code : null;
        job.signal = signal || '';
        if (job.status === 'running') job.status = code === 0 ? 'completed' : 'failed';
        else if (job.status === 'stopping') job.status = 'stopped';
        job.completedAt = new Date().toISOString();
        job.child = null;
        emit(job);
        prune();
        resolve(publicJob(job));
      });
    });

    armTimeout(job);
    emit(job);
    return background ? publicJob(job) : job.done;
  }

  function status(jobId, options = {}) {
    prune();
    const job = jobs.get(String(jobId || ''));
    if (!job) throw chatError('FILE_NOT_FOUND', 'Không tìm thấy terminal job hoặc job đã hết thời gian lưu.', { job_id:String(jobId || '') });
    return publicJob(job, { stdoutOffset:options.stdout_offset, stderrOffset:options.stderr_offset });
  }

  function list(projectRef = '') {
    prune();
    let projectId = '';
    if (projectRef) projectId = store.getProject(projectRef).id;
    return [...jobs.values()]
      .filter(job => !projectId || job.projectId === projectId)
      .sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 80)
      .map(job => publicJob(job, { includeOutput:false }));
  }

  async function stop(jobId) {
    prune();
    const job = jobs.get(String(jobId || ''));
    if (!job) throw chatError('FILE_NOT_FOUND', 'Không tìm thấy terminal job.', { job_id:String(jobId || '') });
    if (!['running','stopping'].includes(job.status)) return publicJob(job);
    job.status = 'stopping';
    job.stopReason = 'user';
    emit(job);
    const stopped = await stopTree(job, true);
    if (!stopped && job.status === 'stopping') {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      appendStream(job, 'stderr', '\nChatCode: không thể dừng process tree.');
      emit(job);
    }
    return { ...publicJob(job), stop_requested:stopped };
  }

  async function shutdown() {
    const running = [...jobs.values()].filter(job => ['running','stopping'].includes(job.status));
    for (const job of running) { job.status = 'stopping'; job.stopReason = 'app_shutdown'; emit(job); }
    await Promise.all(running.map(job => stopTree(job, true).catch(() => false)));
  }

  return { exec, status, list, stop, shutdown, jobs };
}

function installTerminalRuntimePatches() {
  const safetyModule = require('./safety-tools');
  if (safetyModule.__terminalRuntimePatched) return;
  safetyModule.__terminalRuntimePatched = true;
  const previousCreate = safetyModule.createSafeToolApi;
  safetyModule.createSafeToolApi = function terminalAwareSafeToolApi(projects, store, approvals, backups, options) {
    const api = previousCreate(projects, store, approvals, backups, options);
    const runtime = createTerminalRuntime(store, projects, { onChanged:options?.onTerminalChanged });
    api.exec = (ref, command, opts) => runtime.exec(ref, command, opts || {});
    api.jobStatus = (jobId, opts) => runtime.status(jobId, opts || {});
    api.listTerminalJobs = ref => runtime.list(ref || '');
    api.jobStop = jobId => runtime.stop(jobId);
    api.shutdownTerminalJobs = () => runtime.shutdown();
    return api;
  };
}

module.exports = { createTerminalRuntime, installTerminalRuntimePatches, commandGuard };
