const api = window.personalCode;
const state = { projects: [], current: null, history: [] };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

async function init(){
  state.projects = await api.listProjects();
  renderProjects();
  const ai = await api.getSettings();
  $('aiBaseUrl').value = ai.baseUrl || '';
  $('aiModel').value = ai.model || '';
  $('aiStatus').textContent = ai.hasApiKey ? 'API key is stored with OS encryption.' : 'No API key saved yet.';
  if(state.projects[0]) selectProject(state.projects[0].id);
}
function renderProjects(){
  $('projects').innerHTML = state.projects.map(p => `<div class="project-item ${state.current?.id===p.id?'active':''}" data-id="${p.id}"><strong>${esc(p.name)}</strong><span>${esc(p.root)}</span></div>`).join('');
  document.querySelectorAll('.project-item').forEach(el => el.onclick = () => selectProject(el.dataset.id));
}
function selectProject(id){
  state.current = state.projects.find(p => p.id === id); state.history = [];
  renderProjects(); $('emptyState').classList.add('hidden'); $('workspace').classList.remove('hidden');
  $('projectName').textContent = state.current.name; $('projectPath').textContent = state.current.root;
  $('permWrite').checked = !!state.current.permissions?.write; $('permTasks').checked = !!state.current.permissions?.tasks; $('permGit').checked = !!state.current.permissions?.gitWrite;
  renderPills(); loadFiles();
}
function renderPills(){
  const p = state.current?.permissions || {};
  $('permissionPills').innerHTML = `<span class="pill on">READ</span><span class="pill ${p.write?'on':''}">WRITE</span><span class="pill ${p.tasks?'on':''}">TASKS</span><span class="pill ${p.gitWrite?'on':''}">GIT WRITE</span>`;
}
function setTab(name){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id===`tab-${name}`));
}
async function loadFiles(){
  if(!state.current) return; $('fileList').innerHTML = '<div class="muted">Scanning…</div>';
  try{ const files = await api.listFiles(state.current.id); $('fileList').innerHTML = files.map(f=>`<div class="file-item" data-path="${esc(f)}">${esc(f)}</div>`).join(''); document.querySelectorAll('.file-item').forEach(el=>el.onclick=()=>openFile(el.dataset.path)); }
  catch(e){ $('fileList').innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}
async function openFile(rel){
  $('fileTitle').textContent = rel; $('filePreview').textContent = 'Loading…';
  try{$('filePreview').textContent = await api.readFile(state.current.id, rel);}catch(e){$('filePreview').textContent=e.message;}
}
function addMessage(role, content, events=[]){
  const el=document.createElement('div'); el.className=`message ${role}`; el.innerHTML=`<div class="role">${role==='user'?'You':'Personal ChatCode'}</div><div class="content">${esc(content)}</div>${events.length?`<div class="tool-events">${events.map(e=>`${e.ok?'✓':'×'} ${esc(e.summary)}`).join(' · ')}</div>`:''}`; $('chatLog').appendChild(el); $('chatLog').scrollTop=$('chatLog').scrollHeight;
}
async function sendChat(){
  if(!state.current) return; const text=$('chatInput').value.trim(); if(!text) return; $('chatInput').value=''; addMessage('user',text); $('sendChat').classList.add('busy');
  try{ const result=await api.runAgent(state.current.id,text,state.history); addMessage('assistant',result.content,result.events||[]); state.history.push({role:'user',content:text},{role:'assistant',content:result.content}); await loadFiles(); }
  catch(e){addMessage('assistant',`Error: ${e.message}`);} finally{$('sendChat').classList.remove('busy');}
}

$('addProject').onclick=async()=>{const p=await api.addProject(); if(!p)return; state.projects=await api.listProjects(); renderProjects(); selectProject(p.id);};
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
$('refreshFiles').onclick=loadFiles;
$('searchButton').onclick=async()=>{if(!state.current)return; const q=$('searchInput').value.trim(); $('searchResults').innerHTML='<div class="muted">Searching…</div>'; try{const rs=await api.search(state.current.id,q); $('searchResults').innerHTML=rs.length?rs.map(r=>`<div class="search-card"><strong>${esc(r.path)}</strong><pre>${esc(r.snippet)}</pre></div>`).join(''):'<div class="muted">No matches.</div>';}catch(e){$('searchResults').innerHTML=`<div class="muted">${esc(e.message)}</div>`;}};
$('taskButton').onclick=async()=>{if(!state.current)return; $('taskOutput').textContent='Running…'; try{const r=await api.runTask(state.current.id,$('taskInput').value.trim()); $('taskOutput').textContent=`$ ${$('taskInput').value}\n\n${r.stdout}${r.stderr}`;}catch(e){$('taskOutput').textContent=e.message;}};
$('gitStatus').onclick=async()=>{try{const r=await api.gitStatus(state.current.id);$('gitOutput').textContent=r.stdout+r.stderr;}catch(e){$('gitOutput').textContent=e.message;}};
$('gitDiff').onclick=async()=>{try{const r=await api.gitDiff(state.current.id);$('gitOutput').textContent=r.stdout+r.stderr;}catch(e){$('gitOutput').textContent=e.message;}};
$('saveProject').onclick=async()=>{const updated=await api.updateProject({id:state.current.id,name:state.current.name,permissions:{write:$('permWrite').checked,tasks:$('permTasks').checked,gitWrite:$('permGit').checked}}); state.current=updated; state.projects=state.projects.map(p=>p.id===updated.id?updated:p); renderPills(); renderProjects();};
$('saveAI').onclick=async()=>{try{const r=await api.saveAISettings({baseUrl:$('aiBaseUrl').value,model:$('aiModel').value,apiKey:$('aiApiKey').value}); $('aiApiKey').value=''; $('aiStatus').textContent=r.hasApiKey?'Saved. API key is encrypted by the OS.':'Settings saved; API key is still missing.';}catch(e){$('aiStatus').textContent=e.message;}};
$('sendChat').onclick=sendChat; $('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))sendChat();});
init();
