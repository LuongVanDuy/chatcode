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
  let seq = 0;
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
    async gitStage(project) { return { project, ok:true }; }
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

  // While a task is still active, an ambiguous prepare cannot silently switch target.
  // A clear user intent naming the new project may switch it.
  {
    const api = createProjectScopeApi(fakeApi());
    await api.prepareTask('boncauinax', 'Làm dự án boncauinax phần header');
    await assert.rejects(() => api.prepareTask('eupharma', 'check header'), error => errCode(error) === 'PROJECT_SCOPE_VIOLATION');
    const switched = await api.prepareTask('eupharma', 'Tiếp theo sửa dự án eupharma phần header');
    assert.equal(switched.project_scope.target.id, 'eupharma');
    await assert.rejects(() => api.search('boncauinax', 'header'), error => errCode(error) === 'PROJECT_SCOPE_VIOLATION');
  }

  // Acceptance A: rollback releases the old target. The next prepare_task may select a new project
  // even when the request itself does not repeat that project name.
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

  // Session mutations remain strict: once the completed A scope is released, an old B session
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

  console.log('Project scope lock PASS: active target guard + finished/rollback scope release + strict session mutation binding');
})().catch(error => {
  console.error(error);
  process.exit(1);
});