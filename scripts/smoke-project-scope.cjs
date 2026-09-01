const assert = require('node:assert/strict');
const { createProjectScopeApi } = require('../core/project-scope');

function errCode(error) { return String(error?.code || error?.details?.code || ''); }
function errDetails(error) { return error?.details?.details || error?.details || {}; }

function fakeApi() {
  const projects = [
    { id:'boncauinax', name:'boncauinax.vn', root:'D:/sites/boncauinax' },
    { id:'vitas', name:'vitas.com.vn', root:'D:/sites/vitas' },
    { id:'eupharma', name:'eupharma.vn', root:'D:/sites/eupharma' },
    { id:'CHATCODE-GPT', name:'CHATCODE-GPT', root:'virtual' }
  ];
  const sessions = new Map();
  const jobs = new Map();
  let seq = 0;
  let jobSeq = 0;
  return {
    async listProjects() { return projects; },
    async search(project, query) { return [{ project, query }]; },
    async readFile(project, file) { return { project, path:file, content:'ok' }; },
    async readFiles(project, files) { return files.map(file => ({ project, path:file, content:'ok' })); },
    async projectBrain(project) { return { project }; },
    async projectContext(project, query) { return { project, query }; },
    async inspectProject(project, query) { return { project:{ id:project, name:projects.find(p => p.id === project)?.name || project }, query }; },
    async startWork(project, goal) { const id=`work-${++seq}`; sessions.set(id,{ project_id:project, status:'active' }); return { work_session_id:id, project_id:project, workspace_mode:'trusted', baseline:{} }; },
    async workStatus(id) { return sessions.get(id) || { project_id:'', status:'missing' }; },
    async prepareTask(project, request) { const id=`task-${++seq}`; sessions.set(id,{ project_id:project, status:'active' }); return { ok:true, task_id:id, work_session_id:id, request, context:{ project:{ id:project, name:projects.find(p => p.id === project)?.name || project } }, agent_contract:{ guidance:[] } }; },
    async completeTask(id) { const session=sessions.get(id); if (session) session.status='completed'; return { ok:true, task_id:id, status:'completed' }; },
    async writeFile(project, file) { return { ok:true, project, file }; },
    async applyPatch(project) { return { ok:true, project }; },
    async finishWork(id) { const session=sessions.get(id); if (session) session.status='completed'; return { ok:true, id, status:'completed' }; },
    async rollbackWork(id) { const session=sessions.get(id); if (session) session.status='rolled_back'; return { ok:true, id, status:'rolled_back' }; },
    async gitStatus(project) { return { project, ok:true }; },
    async gitStage(project) { return { project, ok:true }; },
    async exec(project, command, options = {}) {
      if (command === 'spawn-failure') throw Object.assign(new Error('spawn failed'), { code:'SPAWN_FAILED' });
      if (!options.background) {
        if (command === 'exit-nonzero') return { project_id:project, status:'failed', exit_code:7, background:false, terminal:{ hidden:true } };
        if (command === 'timeout') return { project_id:project, status:'timeout', exit_code:null, background:false, terminal:{ hidden:true } };
        return { project_id:project, status:'completed', exit_code:0, background:false, terminal:{ hidden:true } };
      }
      const id = `job-${++jobSeq}`;
      const job = { job_id:id, project_id:project, status:'running', exit_code:null, background:true, terminal:{ hidden:true } };
      jobs.set(id, job);
      return { ...job };
    },
    async jobStatus(id) {
      const job = jobs.get(id);
      if (!job) throw Object.assign(new Error('missing job'), { code:'FILE_NOT_FOUND' });
      return { ...job };
    },
    async jobStop(id) {
      const job = jobs.get(id);
      if (!job) throw Object.assign(new Error('missing job'), { code:'FILE_NOT_FOUND' });
      job.status = 'stopped';
      job.exit_code = null;
      return { ...job, stop_requested:true };
    },
    __setJobStatus(id, status, exitCode = status === 'completed' ? 0 : null) {
      const job = jobs.get(id);
      if (!job) throw new Error(`missing fake job ${id}`);
      job.status = status;
      job.exit_code = exitCode;
    }
  };
}

(async () => {
  // First project-specific call pins a single-project scope.
  {
    const api = createProjectScopeApi(fakeApi());
    await api.search('boncauinax', 'header mobile');
    const visible = await api.listProjects();
    assert.deepEqual(visible.map(p => p.id).sort(), ['CHATCODE-GPT','boncauinax']);
    await assert.rejects(() => api.search('eupharma', 'header'), error => errCode(error) === 'PROJECT_SCOPE_VIOLATION');
    const skill = await api.readFile('CHATCODE-GPT', 'skills/wordpress-bricks/SKILL.md');
    assert.equal(skill.project, 'CHATCODE-GPT');
  }

  // Explicit migration/reference intent permits only named references, read-only.
  {
    const api = createProjectScopeApi(fakeApi());
    const prepared = await api.prepareTask('boncauinax', 'Copy sản phẩm từ vitas sang boncauinax rồi kiểm tra lại');
    assert.equal(prepared.project_scope.locked, true);
    assert.equal(prepared.project_scope.target.id, 'boncauinax');
    assert.deepEqual(prepared.project_scope.reference_projects.map(p => p.id), ['vitas']);
    await api.search('vitas', 'products');
    await assert.rejects(() => api.writeFile('vitas', 'x.txt', 'x'), error => errCode(error) === 'PROJECT_SCOPE_READ_ONLY');
    await assert.rejects(() => api.search('eupharma', 'products'), error => errCode(error) === 'PROJECT_SCOPE_VIOLATION');
    await api.writeFile('boncauinax', 'wp-content/themes/child/functions.php', '<?php');
  }

  // Merely mentioning a normal external reference concept must not open another local project.
  {
    const api = createProjectScopeApi(fakeApi());
    const prepared = await api.prepareTask('boncauinax', 'Làm boncauinax giống website mẫu bên ngoài');
    assert.equal(prepared.project_scope.multi_project, false);
    await assert.rejects(() => api.projectBrain('vitas'), error => errCode(error) === 'PROJECT_SCOPE_VIOLATION');
  }

  // A truly active task/work holder cannot be bypassed even with explicit switch wording.
  {
    const api = createProjectScopeApi(fakeApi());
    const first = await api.prepareTask('boncauinax', 'Làm dự án boncauinax phần header');
    await assert.rejects(
      () => api.prepareTask('eupharma', 'Tiếp theo chuyển sang project eupharma phần header'),
      error => errCode(error) === 'PROJECT_SCOPE_VIOLATION'
        && errDetails(error).scope_holder_type === 'work_session'
        && errDetails(error).active_work_session_ids.includes(first.task_id)
    );
    await api.finishWork(first.task_id);
    const switched = await api.prepareTask('eupharma', 'Tiếp theo chuyển sang project eupharma phần header');
    assert.equal(switched.project_scope.target.id, 'eupharma');
  }

  // Rollback releases the old target. The next prepare_task may select a new project.
  {
    const api = createProjectScopeApi(fakeApi());
    const first = await api.prepareTask('boncauinax', 'Làm dự án boncauinax phần header');
    await api.rollbackWork(first.task_id);
    assert.equal(api.projectScope().locked, false);
    const next = await api.prepareTask('eupharma', 'check header');
    assert.equal(next.project_scope.target.id, 'eupharma');
  }

  // Finish has the same lifecycle semantics as rollback.
  {
    const api = createProjectScopeApi(fakeApi());
    const first = await api.prepareTask('boncauinax', 'Làm dự án boncauinax phần footer');
    await api.finishWork(first.task_id);
    assert.equal(api.projectScope().locked, false);
    const next = await api.prepareTask('vitas', 'check footer');
    assert.equal(next.project_scope.target.id, 'vitas');
  }

  // Successful complete_task also releases the old target for a new prepare_task.
  {
    const api = createProjectScopeApi(fakeApi());
    const first = await api.prepareTask('boncauinax', 'Làm dự án boncauinax');
    await api.completeTask(first.task_id);
    assert.equal(api.projectScope().locked, false);
    const next = await api.prepareTask('eupharma', 'check home');
    assert.equal(next.project_scope.target.id, 'eupharma');
  }

  // Read-only calls do not become active scope holders and may be superseded by explicit prepare intent.
  {
    const api = createProjectScopeApi(fakeApi());
    await api.readFile('vitas', 'readme.txt');
    const next = await api.prepareTask('boncauinax', 'Explicitly switch target back to project boncauinax');
    assert.equal(next.project_scope.target.id, 'boncauinax');
  }

  // A. Standalone foreground completion releases its temporary holder.
  {
    const api = createProjectScopeApi(fakeApi());
    const first = await api.prepareTask('boncauinax', 'Làm dự án boncauinax');
    await api.finishWork(first.task_id);
    const terminal = await api.exec('vitas', 'foreground-success');
    assert.equal(terminal.status, 'completed');
    assert.equal(terminal.terminal.hidden, true);
    assert.equal(api.projectScope().locked, false);
    const next = await api.prepareTask('boncauinax', 'Explicitly switch target back to project boncauinax');
    assert.equal(next.project_scope.target.id, 'boncauinax');
  }

  // B. Foreground non-zero, timeout, and spawn failure all clean up scope in finally paths.
  for (const command of ['exit-nonzero', 'timeout']) {
    const api = createProjectScopeApi(fakeApi());
    const terminal = await api.exec('vitas', command);
    assert.ok(['failed','timeout'].includes(terminal.status));
    assert.equal(api.projectScope().locked, false);
    const next = await api.prepareTask('boncauinax', 'Explicitly switch target back to project boncauinax');
    assert.equal(next.project_scope.target.id, 'boncauinax');
  }
  {
    const api = createProjectScopeApi(fakeApi());
    await assert.rejects(() => api.exec('vitas', 'spawn-failure'), /spawn failed/);
    assert.equal(api.projectScope().locked, false);
    const next = await api.prepareTask('boncauinax', 'Explicitly switch target back to project boncauinax');
    assert.equal(next.project_scope.target.id, 'boncauinax');
  }

  // C. Completed background job releases the job lease when observed terminal.
  {
    const api = createProjectScopeApi(fakeApi());
    const job = await api.exec('vitas', 'background-complete', { background:true });
    assert.equal(api.projectScope().scope_holder_type, 'terminal_job');
    api.__setJobStatus(job.job_id, 'completed');
    const status = await api.jobStatus(job.job_id);
    assert.equal(status.status, 'completed');
    assert.equal(api.projectScope().locked, false);
    const next = await api.prepareTask('boncauinax', 'Explicitly switch target back to project boncauinax');
    assert.equal(next.project_scope.target.id, 'boncauinax');
  }

  // D. Running background job remains a real holder and blocks project switching with precise details.
  {
    const api = createProjectScopeApi(fakeApi());
    const job = await api.exec('vitas', 'background-running', { background:true });
    assert.equal((await api.jobStatus(job.job_id)).status, 'running');
    await assert.rejects(
      () => api.prepareTask('boncauinax', 'Explicitly switch target back to project boncauinax'),
      error => errCode(error) === 'PROJECT_SCOPE_VIOLATION'
        && errDetails(error).scope_holder_type === 'terminal_job'
        && errDetails(error).active_job_ids.includes(job.job_id)
    );
  }

  // E. Stopped background job releases its lease.
  {
    const api = createProjectScopeApi(fakeApi());
    const job = await api.exec('vitas', 'background-stop', { background:true });
    const stopped = await api.jobStop(job.job_id);
    assert.equal(stopped.status, 'stopped');
    assert.equal(api.projectScope().locked, false);
    const next = await api.prepareTask('boncauinax', 'Explicitly switch target back to project boncauinax');
    assert.equal(next.project_scope.target.id, 'boncauinax');
  }

  // F. One completed job must not release a project while another job is still running.
  {
    const api = createProjectScopeApi(fakeApi());
    const first = await api.exec('vitas', 'background-one', { background:true });
    const second = await api.exec('vitas', 'background-two', { background:true });
    api.__setJobStatus(first.job_id, 'completed');
    await api.jobStatus(first.job_id);
    assert.deepEqual(api.projectScope().active_job_ids, [second.job_id]);
    await assert.rejects(
      () => api.prepareTask('boncauinax', 'Explicitly switch target back to project boncauinax'),
      error => errCode(error) === 'PROJECT_SCOPE_VIOLATION'
        && errDetails(error).active_job_ids.length === 1
        && errDetails(error).active_job_ids[0] === second.job_id
    );
    api.__setJobStatus(second.job_id, 'completed');
    await api.jobStatus(second.job_id);
    assert.equal(api.projectScope().locked, false);
  }

  // G. Explicit start_work is a holder and must still protect its target.
  {
    const api = createProjectScopeApi(fakeApi());
    const work = await api.startWork('vitas', 'active work');
    await assert.rejects(
      () => api.prepareTask('boncauinax', 'Explicitly switch target back to project boncauinax'),
      error => errCode(error) === 'PROJECT_SCOPE_VIOLATION'
        && errDetails(error).scope_holder_type === 'work_session'
        && errDetails(error).active_work_session_ids.includes(work.work_session_id)
    );
    await api.rollbackWork(work.work_session_id);
    assert.equal(api.projectScope().locked, false);
  }

  // Session mutations remain strict: once completed A scope is released, an old B session
  // cannot self-pin B via complete_task. A new prepare_task must establish B first.
  {
    const base = fakeApi();
    const other = await base.prepareTask('vitas', 'internal pre-existing session');
    const api = createProjectScopeApi(base);
    const task = await api.prepareTask('boncauinax', 'Làm dự án boncauinax');
    await api.completeTask(task.task_id);
    assert.equal(api.projectScope().locked, false);
    await assert.rejects(() => api.completeTask(other.task_id), error => errCode(error) === 'PROJECT_SCOPE_VIOLATION');
  }

  console.log('Project scope lock PASS: active holder lifecycle + terminal cleanup + strict session mutation binding');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
