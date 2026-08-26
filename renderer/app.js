const api = window.personalCode;
const state = { projects: [], current: null, connectionMode: 'custom', connectionConfig: null };
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const STATUS = {
  connected: { title: 'Đã kết nối', detail: 'ChatGPT có thể truy cập MCP qua HTTPS', tone: 'success' },
  verifying: { title: 'Đang kiểm tra', detail: 'Đang xác minh domain có truy cập được MCP', tone: 'progress' },
  starting: { title: 'Đang khởi động', detail: 'Đang mở Cloudflare Tunnel', tone: 'progress' },
  'installing-tunnel': { title: 'Đang chuẩn bị', detail: 'Đang cài thành phần Cloudflare lần đầu', tone: 'progress' },
  'config-required': { title: 'Cần cấu hình', detail: 'Nhập domain và Tunnel Token để bắt đầu', tone: 'warning' },
  stopped: { title: 'Đã ngắt kết nối', detail: 'MCP cục bộ vẫn an toàn trên máy', tone: 'neutral' },
  error: { title: 'Kết nối lỗi', detail: 'Kiểm tra lại cấu hình Cloudflare', tone: 'error' }
};

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</span><div>${esc(message)}</div>`;
  $('toastContainer').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

function setBusy(button, busy, label) {
  button.classList.toggle('loading', busy);
  button.disabled = busy;
  const labelEl = button.querySelector('.button-label');
  if (labelEl && label) labelEl.textContent = label;
}

async function init() {
  try {
    const [projects, config, connection] = await Promise.all([
      api.listProjects(),
      api.connectionConfig(),
      api.connectionStatus()
    ]);
    state.projects = projects;
    state.connectionConfig = config;
    state.connectionMode = config?.mode || 'custom';
    renderProjects();
    renderProjectState();
    renderConnectionConfig();
    renderConnection(connection);
    api.onConnectionChanged(renderConnection);
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
}

function renderProjects() {
  $('projectCount').textContent = String(state.projects.length);
  $('projects').innerHTML = state.projects.length
    ? state.projects.map(p => `
      <button class="project-item ${state.current?.id === p.id ? 'active' : ''}" data-id="${esc(p.id)}">
        <span class="project-avatar">${esc((p.name || 'P').slice(0, 1).toUpperCase())}</span>
        <span class="project-copy"><strong>${esc(p.name)}</strong><small>${esc(p.root)}</small></span>
      </button>`).join('')
    : `<div class="empty-projects"><span>◇</span><strong>Chưa có dự án</strong><small>Thêm một thư mục để ChatGPT bắt đầu làm việc.</small></div>`;
  document.querySelectorAll('.project-item').forEach(el => el.onclick = () => selectProject(el.dataset.id));
}

function selectProject(id) {
  state.current = state.projects.find(p => p.id === id) || null;
  renderProjects();
  renderProjectState();
  if (state.current) loadFiles();
}

function renderProjectState() {
  const p = state.current;
  if (!p) {
    $('projectName').textContent = 'Tổng quan';
    $('projectPath').textContent = 'Kết nối ChatGPT rồi chọn thư mục bạn muốn chia sẻ.';
    $('permissionPills').innerHTML = '';
    $('projectRequiredFiles').classList.remove('hidden');
    $('filesContent').classList.add('hidden');
    $('permissionsEmpty').classList.remove('hidden');
    $('permissionsContent').classList.add('hidden');
    $('taskButton').disabled = true;
    return;
  }

  $('projectName').textContent = p.name;
  $('projectPath').textContent = p.root;
  $('projectRequiredFiles').classList.add('hidden');
  $('filesContent').classList.remove('hidden');
  $('permissionsEmpty').classList.add('hidden');
  $('permissionsContent').classList.remove('hidden');
  $('permWrite').checked = !!p.permissions?.write;
  $('permManage').checked = !!p.permissions?.manageFiles;
  $('permTasks').checked = !!p.permissions?.tasks;
  $('permGit').checked = !!p.permissions?.gitWrite;
  $('taskButton').disabled = !p.permissions?.tasks;
  renderPermissionPills();
}

function renderPermissionPills() {
  const p = state.current?.permissions || {};
  const items = [
    ['Đọc', true],
    ['Ghi', p.write],
    ['Quản lý', p.manageFiles],
    ['Tác vụ', p.tasks],
    ['Git', p.gitWrite]
  ];
  $('permissionPills').innerHTML = items.map(([label, on]) => `<span class="permission-pill ${on ? 'on' : ''}">${label}</span>`).join('');
}

function statusMeta(status) {
  return STATUS[status] || STATUS.stopped;
}

function renderConnection(connection = {}) {
  const status = connection.status || 'stopped';
  const meta = statusMeta(status);
  const connected = status === 'connected';

  const hero = $('connectionHeroStatus');
  hero.className = `hero-status ${meta.tone}`;
  hero.querySelector('strong').textContent = meta.title;
  hero.querySelector('span:last-child').textContent = connection.error || meta.detail;

  $('topConnectionBadge').className = `connection-chip ${meta.tone}`;
  $('topConnectionBadge').querySelector('span:last-child').textContent = meta.title;
  $('sidebarStatusText').textContent = meta.title;
  $('sidebarStatusDot').className = `status-dot ${meta.tone}`;

  $('connectionUrl').value = connection.connectionUrl || '';
  $('copyConnection').disabled = !connection.connectionUrl;
  $('urlStatusDot').className = `status-dot ${connected ? 'success' : meta.tone}`;
  $('urlStatusText').textContent = connected ? 'Sẵn sàng cho ChatGPT' : meta.title;

  const message = connection.error
    ? connection.error
    : connected
      ? `Kết nối đã được xác minh qua ${connection.mode === 'quick' ? 'Quick Tunnel' : connection.domain || 'domain riêng'}.`
      : meta.detail;
  renderInlineMessage(message, connection.error ? 'error' : connected ? 'success' : 'info');
}

function renderInlineMessage(message, tone = 'info') {
  const el = $('connectionMessage');
  el.className = `inline-message ${tone}`;
  el.textContent = message || '';
}

function setConnectionMode(mode) {
  state.connectionMode = mode === 'quick' ? 'quick' : 'custom';
  $('modeCustom').classList.toggle('active', state.connectionMode === 'custom');
  $('modeQuick').classList.toggle('active', state.connectionMode === 'quick');
  $('customConfig').classList.toggle('hidden', state.connectionMode !== 'custom');
  $('quickConfig').classList.toggle('hidden', state.connectionMode !== 'quick');
}

function renderConnectionConfig() {
  const config = state.connectionConfig || {};
  setConnectionMode(config.mode || 'custom');
  $('cloudDomain').value = config.domain || '';
  $('savedTokenHint').classList.toggle('hidden', !config.hasTunnelToken);
  $('cloudToken').placeholder = config.hasTunnelToken ? 'Đã lưu · nhập token mới nếu muốn thay đổi' : 'Nhập Tunnel Token';
  $('clearCloudToken').classList.toggle('hidden', !config.hasTunnelToken);
}

function setTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
}

async function loadFiles() {
  if (!state.current) return;
  $('fileList').innerHTML = `<div class="loading-list"><span></span><span></span><span></span></div>`;
  try {
    const files = await api.listFiles(state.current.id);
    $('fileCount').textContent = `${files.length.toLocaleString('vi-VN')} tệp`;
    $('fileList').innerHTML = files.length
      ? files.map(f => `<button class="file-item" data-path="${esc(f)}"><span class="file-glyph">${fileGlyph(f)}</span><span>${esc(f)}</span></button>`).join('')
      : `<div class="list-empty">Không tìm thấy file văn bản.</div>`;
    document.querySelectorAll('.file-item').forEach(el => el.onclick = () => openFile(el.dataset.path, el));
  } catch (error) {
    $('fileList').innerHTML = `<div class="list-empty error-text">${esc(error.message)}</div>`;
  }
}

function fileGlyph(file) {
  const ext = String(file).split('.').pop().toLowerCase();
  if (['js','jsx','ts','tsx','mjs','cjs'].includes(ext)) return 'JS';
  if (['json','yaml','yml','toml'].includes(ext)) return '{}';
  if (['md','txt'].includes(ext)) return '¶';
  if (['css','scss','html','vue','svelte'].includes(ext)) return '◇';
  if (['py'].includes(ext)) return 'Py';
  return '·';
}

async function openFile(rel, element) {
  document.querySelectorAll('.file-item').forEach(el => el.classList.toggle('active', el === element));
  $('fileTitle').textContent = rel;
  $('filePreview').textContent = 'Đang tải nội dung…';
  try {
    $('filePreview').textContent = await api.readFile(state.current.id, rel);
  } catch (error) {
    $('filePreview').textContent = error.message;
  }
}

async function saveAndConnect() {
  const button = $('saveAndConnect');
  setBusy(button, true, 'Đang kết nối…');
  renderInlineMessage('Đang lưu cấu hình và kiểm tra kết nối Cloudflare…', 'info');
  try {
    state.connectionConfig = await api.saveConnectionConfig({
      mode: state.connectionMode,
      domain: $('cloudDomain').value.trim(),
      tunnelToken: $('cloudToken').value.trim()
    });
    $('cloudToken').value = '';
    renderConnectionConfig();
    const result = await api.startConnection();
    renderConnection(result);
    if (result.status === 'connected') toast('Kết nối Cloudflare thành công.');
  } catch (error) {
    renderInlineMessage(error.message || String(error), 'error');
    toast(error.message || String(error), 'error');
  } finally {
    setBusy(button, false, 'Lưu & Kết nối');
  }
}

$('addProject').onclick = async () => {
  try {
    const project = await api.addProject();
    if (!project) return;
    state.projects = await api.listProjects();
    selectProject(project.id);
    toast(`Đã thêm dự án “${project.name}”.`);
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
};

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('modeCustom').onclick = () => setConnectionMode('custom');
$('modeQuick').onclick = () => setConnectionMode('quick');
$('toggleToken').onclick = () => {
  const input = $('cloudToken');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('toggleToken').textContent = input.type === 'password' ? '◉' : '◌';
};
$('saveAndConnect').onclick = saveAndConnect;
$('restartConnection').onclick = async () => {
  try {
    renderConnection({ status: 'starting' });
    const result = await api.startConnection();
    renderConnection(result);
    if (result.status === 'connected') toast('Kết nối đã được kiểm tra lại thành công.');
  } catch (error) {
    renderInlineMessage(error.message || String(error), 'error');
    toast(error.message || String(error), 'error');
  }
};
$('stopConnection').onclick = async () => {
  try {
    await api.stopConnection();
    renderConnection(await api.connectionStatus());
    toast('Đã ngắt Cloudflare Tunnel.', 'info');
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
};
$('copyConnection').onclick = async () => {
  try {
    await api.copyConnection();
    toast('Đã sao chép URL MCP.');
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
};
$('rotateConnection').onclick = async () => {
  try {
    renderInlineMessage('Đang đổi secret MCP và kết nối lại…', 'info');
    const result = await api.rotateConnection();
    renderConnection(result);
    toast('Đã đổi secret MCP. URL cũ không còn dùng được.');
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
};
$('clearCloudToken').onclick = async () => {
  if (!confirm('Xóa Tunnel Token đã lưu? Bạn sẽ cần nhập lại token để dùng domain riêng.')) return;
  try {
    state.connectionConfig = await api.clearTunnelToken();
    renderConnectionConfig();
    renderConnection(await api.connectionStatus());
    toast('Đã xóa Tunnel Token.', 'info');
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
};

$('refreshFiles').onclick = loadFiles;
$('searchButton').onclick = async () => {
  if (!state.current) {
    $('searchResults').innerHTML = `<div class="empty-result">Hãy chọn một dự án trước.</div>`;
    return;
  }
  const query = $('searchInput').value.trim();
  if (!query) return;
  $('searchResults').innerHTML = `<div class="searching"><span class="spinner"></span>Đang tìm trong dự án…</div>`;
  try {
    const results = await api.search(state.current.id, query);
    $('searchResults').innerHTML = results.length
      ? results.map(r => `<article class="search-card"><div class="search-path">${esc(r.path)}</div><pre>${esc(r.snippet)}</pre></article>`).join('')
      : `<div class="empty-result">Không tìm thấy kết quả phù hợp.</div>`;
  } catch (error) {
    $('searchResults').innerHTML = `<div class="empty-result error-text">${esc(error.message)}</div>`;
  }
};
$('searchInput').addEventListener('keydown', event => { if (event.key === 'Enter') $('searchButton').click(); });

document.querySelectorAll('.quick-commands button').forEach(button => button.onclick = () => { $('taskInput').value = button.dataset.command; });
$('taskButton').onclick = async () => {
  if (!state.current) return toast('Hãy chọn một dự án trước.', 'error');
  if (!state.current.permissions?.tasks) return toast('Quyền chạy tác vụ đang tắt cho dự án này.', 'error');
  const command = $('taskInput').value.trim();
  if (!command) return;
  $('taskOutput').textContent = `> ${command}\n\nĐang chạy…`;
  try {
    const result = await api.runTask(state.current.id, command);
    $('taskOutput').textContent = `> ${command}\n\n${result.stdout}${result.stderr}`;
  } catch (error) {
    $('taskOutput').textContent = `> ${command}\n\n${error.message}`;
  }
};
$('taskInput').addEventListener('keydown', event => { if (event.key === 'Enter') $('taskButton').click(); });

$('gitStatus').onclick = async () => {
  if (!state.current) return toast('Hãy chọn một dự án trước.', 'error');
  $('gitOutput').textContent = 'Đang đọc trạng thái Git…';
  try {
    const result = await api.gitStatus(state.current.id);
    $('gitOutput').textContent = result.stdout + result.stderr || 'Working tree sạch.';
  } catch (error) {
    $('gitOutput').textContent = error.message;
  }
};
$('gitDiff').onclick = async () => {
  if (!state.current) return toast('Hãy chọn một dự án trước.', 'error');
  $('gitOutput').textContent = 'Đang đọc thay đổi…';
  try {
    const result = await api.gitDiff(state.current.id);
    $('gitOutput').textContent = result.stdout + result.stderr || 'Không có thay đổi chưa stage.';
  } catch (error) {
    $('gitOutput').textContent = error.message;
  }
};

$('saveProject').onclick = async () => {
  if (!state.current) return;
  try {
    const updated = await api.updateProject({
      id: state.current.id,
      name: state.current.name,
      permissions: {
        write: $('permWrite').checked,
        manageFiles: $('permManage').checked,
        tasks: $('permTasks').checked,
        gitWrite: $('permGit').checked
      }
    });
    state.current = updated;
    state.projects = state.projects.map(p => p.id === updated.id ? updated : p);
    renderProjects();
    renderProjectState();
    toast('Đã lưu quyền truy cập cho dự án.');
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
};

init();