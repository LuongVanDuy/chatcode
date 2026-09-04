const assert = require('node:assert/strict');
const { createProjectScopeApi } = require('../core/project-scope');

function errCode(error) { return String(error?.code || error?.details?.code || ''); }

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
    async startWork(project, goal) {
      const id=`work-${++seq}`;
      sessions.set(id,{ project_id:project, status:'active' });
      return { work_session_id:id, project_id:project, workspace_mode:'trusted', baseline:{}, goal };
    },
    async workStatus(id) { return sessions.get(id) || { project_id:'', status:'missing' }; },
    async prepareTask(project, request) {
      const id=`task-${++seq}`;
      sessions.set(id,{ project_id:project, status:'active' });
      return {
        ok:true,
        task_id:id,
        work_session_id:id,
        request,
        context:{ project:{ id:project, name:projects.find(p => p.id === project)?.name || project } },
        agent_contract:{ guidance:[] }
      };
    },
    async completeTask(id) {
      const session=sessions.get(id);
      if (session) session.status='completed';
      return { ok:true, task_id:id, work_session_id:id, status:'completed' };
    },
    async writeFile(project, file) { return { ok:true, project, file }; },
    async applyPatch(project) { return { ok:true, project }; },
    async finishWork(id) {
      const session=sessions.get(id);
      if (session) session.status='completed';
      return { ok:true, id, work_session_id:id, status:'completed' };
    },
    async rollbackWork(id) {
      const session=sessions.get(id);
      if (session) session.status='rolled_back';
      return { ok:true, id, work_session_id:id, status:'rolled_back' };
    },
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
  // Read-only discovery is never a process-global project lock.
  {
    const api = createProjectScopeApi(fakeApi());
    await api.search('boncauinax', 'header mobile');
    await api.search('eupharma', 'footer mobile');
    const visible = await api.listProjects();
    assert.deepEqual(visible.map(p => p.id).sort(), ['CHATCODE-GPT','boncauinax','eupharma','vitas']);
    assert.equal(api.projectScope().locked, false);
  }

  // Two normal coding tasks on different projects may stay active concurrently.
  {
    const api = createProjectScopeApi(fakeApi());
    const first = await api.prepareTask('boncauinax', 'Làm dự án boncauinax phần header');
    const second = await api.prepareTask('eupharma', 'Làm dự án eupharma phần footer');
    assert.equal(first.project_scope.target.id, 'boncauinax');
    assert.equal(second.project_scope.target.id, 'eupharma');
    const aggregate = api.projectScope();
    assert.equal(aggregate.concurrent, true);
    assert.equal(aggregate.scope_count, 2);
    assert.deepEqual(aggregate.targets.map(p => p.id).sort(), ['boncauinax','eupharma']);
    assert.ok(api.projectScope('boncauinax').active_work_session_ids.includes(first.task_id));
    assert.ok(api.projectScope('eupharma').active_work_session_ids.includes(second.task_id));

    await api.writeFile('boncauinax', 'header.php', 'a');
    await api.writeFile('eupharma', 'footer.php', 'b');

    await api.completeTask(first.task_id);
    assert.equal(api.projectScope('boncauinax').locked, false);
    assert.equal(api.projectScope('eupharma').locked, true, 'finishing A must not release project B');
    await api.completeTask(second.task_id);
    assert.equal(api.projectScope().locked, false);
  }

  // A reference stays read-only inside its source lane, but can become an independent
  // writable target when another conversation/task explicitly prepares that project.
  {
    const api = createProjectScopeApi(fakeApi());
    const migration = await api.prepareTask('boncauinax', 'Copy sản phẩm từ vitas sang boncauinax rồi kiểm tra lại');
    assert.deepEqual(migration.project_scope.reference_projects.map(p => p.id), ['vitas']);
    await api.search('vitas', 'products');
    await assert.rejects(() => api.writeFile('vitas', 'x.txt', 'x'), error => errCode(error) === 'PROJECT_SCOPE_READ_ONLY');

    const vitasTask = await api.prepareTask('vitas', 'Sửa riêng project vitas phần sản phẩm');
    assert.equal(vitasTask.project_scope.target.id, 'vitas');
    await api.writeFile('vitas', 'x.txt', 'x');
    assert.equal(api.projectScope().scope_count, 2);

    await api.completeTask(vitasTask.task_id);
    assert.equal(api.projectScope('vitas').locked, false);
    await assert.rejects(() => api.writeFile('vitas', 'x.txt', 'x'), error => errCode(error) === 'PROJECT_SCOPE_READ_ONLY');
    await api.completeTask(migration.task_id);
    assert.equal(api.projectScope().locked, false);
  }

  // A running terminal job on one project must not block a coding task on another.
  {
    const api = createProjectScopeApi(fakeApi());
    const job = await api.exec('vitas', 'watch-assets', { background:true });
    assert.ok(api.projectScope('vitas').active_job_ids.includes(job.job_id));
    const task = await api.prepareTask('boncauinax', 'Sửa boncauinax phần menu');
    assert.equal(task.project_scope.target.id, 'boncauinax');
    assert.equal(api.projectScope().concurrent, true);

    const stopped = await api.jobStop(job.job_id);
    assert.equal(stopped.status, 'stopped');
    assert.equal(api.projectScope('vitas').locked, false);
    assert.equal(api.projectScope('boncauinax').locked, true);
    await api.completeTask(task.task_id);
    assert.equal(api.projectScope().locked, false);
  }

  // Multiple holders only keep their own project lane alive.
  {
    const api = createProjectScopeApi(fakeApi());
    const first = await api.exec('vitas', 'background-one', { background:true });
    const second = await api.exec('vitas', 'background-two', { background:true });
    const other = await api.prepareTask('eupharma', 'Sửa eupharma phần home');

    api.__setJobStatus(first.job_id, 'completed');
    await api.jobStatus(first.job_id);
    assert.deepEqual(api.projectScope('vitas').active_job_ids, [second.job_id]);
    assert.equal(api.projectScope('eupharma').locked, true);

    api.__setJobStatus(second.job_id, 'completed');
    await api.jobStatus(second.job_id);
    assert.equal(api.projectScope('vitas').locked, false);
    assert.equal(api.projectScope('eupharma').locked, true);
    await api.completeTask(other.task_id);
  }

  // start_work lanes are also independent across projects.
  {
    const api = createProjectScopeApi(fakeApi());
    const work = await api.startWork('vitas', 'active work');
    const task = await api.prepareTask('boncauinax', 'Làm boncauinax song song');
    assert.equal(api.projectScope().scope_count, 2);
    await api.rollbackWork(work.work_session_id);
    assert.equal(api.projectScope('vitas').locked, false);
    assert.equal(api.projectScope('boncauinax').locked, true);
    await api.completeTask(task.task_id);
  }

  // Foreground terminal holders always clean up their own lane, including errors.
  for (const command of ['foreground-success', 'exit-nonzero', 'timeout']) {
    const api = createProjectScopeApi(fakeApi());
    const result = await api.exec('vitas', command);
    assert.ok(['completed','failed','timeout'].includes(result.status));
    assert.equal(api.projectScope('vitas').locked, false);
  }
  {
    const api = createProjectScopeApi(fakeApi());
    await assert.rejects(() => api.exec('vitas', 'spawn-failure'), /spawn failed/);
    assert.equal(api.projectScope('vitas').locked, false);
  }

  // Session mutations remain strict: a session created outside the scoped wrapper
  // cannot self-pin a project later just because another project lane exists.
  {
    const base = fakeApi();
    const old = await base.prepareTask('vitas', 'internal pre-existing session');
    const api = createProjectScopeApi(base);
    const task = await api.prepareTask('boncauinax', 'Làm dự án boncauinax');
    await assert.rejects(() => api.completeTask(old.task_id), error => errCode(error) === 'PROJECT_SCOPE_VIOLATION');
    assert.equal(api.projectScope('boncauinax').locked, true);
    await api.completeTask(task.task_id);
  }

  console.log('Project scope lanes PASS: concurrent projects + holder isolation + reference safety + strict session binding');
})().catch(error => {
  console.error(error);
  process.exit(1);
});