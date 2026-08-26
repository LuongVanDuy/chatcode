const api = window.personalCode;
const state = { projects: [], current: null };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

async function init(){
  state.projects = await api.listProjects();
  renderProjects();
  renderProjectState();
  renderConnection(await api.connectionStatus());
  api.onConnectionChanged(renderConnection);
}

function renderProjects(){
  $('projects').innerHTML = state.projects.length
    ? state.projects.map(p => `<div class="project-item ${state.current?.id===p.id?'active':''}" data-id="${p.id}"><strong>${esc(p.name)}</strong><span>${esc(p.root)}</span></div>`).join('')
    : '<div class="muted">No projects yet.</div>';
  document.querySelectorAll('.project-item').forEach(el => el.onclick = () => selectProject(el.dataset.id));
}

function selectProject(id){
  state.current = state.projects.find(p => p.id === id) || null;
  renderProjects();
  renderProjectState();
  if(state.current) loadFiles();
}

function renderProjectState(){
  const p = state.current;
  if(!p){
    $('projectName').textContent='Personal ChatCode';
    $('projectPath').textContent='Connect ChatGPT, then let it work with folders you explicitly add.';
    $('permissionPills').innerHTML='';
    $('projectRequiredFiles').classList.remove('hidden');
    $('filesContent').classList.add('hidden');
    $('permissionsEmpty').classList.remove('hidden');
    $('permissionsContent').classList.add('hidden');
    return;
  }
  $('projectName').textContent=p.name;
  $('projectPath').textContent=p.root;
  $('projectRequiredFiles').classList.add('hidden');
  $('filesContent').classList.remove('hidden');
  $('permissionsEmpty').classList.add('hidden');
  $('permissionsContent').classList.remove('hidden');
  $('permWrite').checked=!!p.permissions?.write;
  $('permManage').checked=!!p.permissions?.manageFiles;
  $('permTasks').checked=!!p.permissions?.tasks;
  $('permGit').checked=!!p.permissions?.gitWrite;
  renderPills();
}

function renderPills(){
  const p=state.current?.permissions||{};
  $('permissionPills').innerHTML=`<span class="pill on">READ</span><span class="pill ${p.write?'on':''}">WRITE</span><span class="pill ${p.manageFiles?'on':''}">MANAGE</span><span class="pill ${p.tasks?'on':''}">TASKS</span><span class="pill ${p.gitWrite?'on':''}">GIT WRITE</span>`;
}

function renderConnection(c){
  const status=(c?.status||'stopped').toUpperCase().replaceAll('-',' ');
  $('connectionBadge').textContent=status;
  $('connectionBadge').className=`pill ${c?.status==='connected'?'on':''}`;
  $('connectionUrl').value=c?.connectionUrl||'';
  $('copyConnection').disabled=!c?.connectionUrl;
  $('connectionMessage').textContent=c?.error ? c.error : c?.status==='connected' ? 'Ready. Paste this URL into your ChatGPT custom MCP app/plugin.' : c?.status==='installing-tunnel' ? 'Installing the tunnel helper for first use…' : 'Creating the ChatGPT connection…';
}

function setTab(name){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id===`tab-${name}`));
}

async function loadFiles(){
  if(!state.current)return;
  $('fileList').innerHTML='<div class="muted">Scanning…</div>';
  try{
    const files=await api.listFiles(state.current.id);
    $('fileList').innerHTML=files.map(f=>`<div class="file-item" data-path="${esc(f)}">${esc(f)}</div>`).join('');
    document.querySelectorAll('.file-item').forEach(el=>el.onclick=()=>openFile(el.dataset.path));
  }catch(e){$('fileList').innerHTML=`<div class="muted">${esc(e.message)}</div>`;}
}

async function openFile(rel){
  $('fileTitle').textContent=rel;
  $('filePreview').textContent='Loading…';
  try{$('filePreview').textContent=await api.readFile(state.current.id,rel);}catch(e){$('filePreview').textContent=e.message;}
}

$('addProject').onclick=async()=>{
  const p=await api.addProject();
  if(!p)return;
  state.projects=await api.listProjects();
  selectProject(p.id);
};
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
$('refreshFiles').onclick=loadFiles;
$('searchButton').onclick=async()=>{
  if(!state.current){$('searchResults').innerHTML='<div class="muted">Select a project first.</div>';return;}
  const q=$('searchInput').value.trim();
  $('searchResults').innerHTML='<div class="muted">Searching…</div>';
  try{const rs=await api.search(state.current.id,q);$('searchResults').innerHTML=rs.length?rs.map(r=>`<div class="search-card"><strong>${esc(r.path)}</strong><pre>${esc(r.snippet)}</pre></div>`).join(''):'<div class="muted">No matches.</div>';}catch(e){$('searchResults').innerHTML=`<div class="muted">${esc(e.message)}</div>`;}
};
$('taskButton').onclick=async()=>{
  if(!state.current){$('taskOutput').textContent='Select a project first.';return;}
  $('taskOutput').textContent='Running…';
  try{const cmd=$('taskInput').value.trim();const r=await api.runTask(state.current.id,cmd);$('taskOutput').textContent=`$ ${cmd}\n\n${r.stdout}${r.stderr}`;}catch(e){$('taskOutput').textContent=e.message;}
};
$('gitStatus').onclick=async()=>{if(!state.current){$('gitOutput').textContent='Select a project first.';return;}try{const r=await api.gitStatus(state.current.id);$('gitOutput').textContent=r.stdout+r.stderr;}catch(e){$('gitOutput').textContent=e.message;}};
$('gitDiff').onclick=async()=>{if(!state.current){$('gitOutput').textContent='Select a project first.';return;}try{const r=await api.gitDiff(state.current.id);$('gitOutput').textContent=r.stdout+r.stderr;}catch(e){$('gitOutput').textContent=e.message;}};
$('saveProject').onclick=async()=>{
  if(!state.current)return;
  const updated=await api.updateProject({id:state.current.id,name:state.current.name,permissions:{write:$('permWrite').checked,manageFiles:$('permManage').checked,tasks:$('permTasks').checked,gitWrite:$('permGit').checked}});
  state.current=updated;
  state.projects=state.projects.map(p=>p.id===updated.id?updated:p);
  renderProjects();renderProjectState();
};
$('copyConnection').onclick=async()=>{try{await api.copyConnection();$('connectionMessage').textContent='Copied. Paste the link into ChatGPT.';}catch(e){$('connectionMessage').textContent=e.message;}};
$('restartConnection').onclick=async()=>{try{renderConnection({status:'starting'});await api.startConnection();}catch(e){$('connectionMessage').textContent=e.message;}};
$('rotateConnection').onclick=async()=>{try{renderConnection({status:'starting'});await api.rotateConnection();}catch(e){$('connectionMessage').textContent=e.message;}};
init();
