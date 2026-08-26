const api = window.personalCode;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const state = {
  projects: [],
  current: null,
  screen: 'dashboard',
  projectTab: 'overview',
  connectionMode: 'custom',
  connectionConfig: null,
  connection: null,
  settings: null,
  appInfo: null
};

const STATUS = {
  connected: { title: 'Đã kết nối', detail: 'ChatGPT có thể gọi MCP qua HTTPS.', tone: 'success' },
  verifying: { title: 'Đang xác minh', detail: 'Đang kiểm tra đường truyền công khai.', tone: 'progress' },
  starting: { title: 'Đang kết nối', detail: 'Đang khởi động Cloudflare Tunnel.', tone: 'progress' },
  'installing-tunnel': { title: 'Đang chuẩn bị', detail: 'Đang cài cloudflared lần đầu.', tone: 'progress' },
  'config-required': { title: 'Cần cấu hình', detail: 'Thiết lập kết nối Cloudflare một lần.', tone: 'warning' },
  stopped: { title: 'Đã ngắt', detail: 'MCP công khai hiện không khả dụng.', tone: 'neutral' },
  error: { title: 'Kết nối lỗi', detail: 'Kiểm tra lại Cloudflare hoặc dịch vụ cục bộ.', tone: 'error' }
};

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</span><div>${esc(message)}</div>`;
  $('toastContainer').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 180);
  }, 3200);
}

function statusMeta(status) {
  return STATUS[status] || STATUS.stopped;
}

function persistNavigation() {
  localStorage.setItem('chatcode.screen', state.screen);
  localStorage.setItem('chatcode.projectId', state.current?.id || '');
  localStorage.setItem('chatcode.projectTab', state.projectTab);
}

async function init() {
  try {
    const [projects, config, connection, settings, appInfo] = await Promise.all([
      api.listProjects(),
      api.connectionConfig(),
      api.connectionStatus(),
      api.getSettings(),
      api.appInfo()
    ]);

    state.projects = projects;
    state.connectionConfig = config;
    state.connectionMode = config?.mode || 'custom';
    state.connection = connection;
    state.settings = settings;
    state.appInfo = appInfo;

    const savedProjectId = localStorage.getItem('chatcode.projectId');
    state.current = state.projects.find(p => p.id === savedProjectId) || null;
    state.projectTab = ['overview','files','search','tasks','git','permissions'].includes(localStorage.getItem('chatcode.projectTab'))
      ? localStorage.getItem('chatcode.projectTab')
      : 'overview';
    const savedScreen = localStorage.getItem('chatcode.screen');
    state.screen = ['dashboard','connection','settings','project'].includes(savedScreen) ? savedScreen : 'dashboard';
    if (state.screen === 'project' && !state.current) state.screen = 'dashboard';

    renderProjects();
    renderDashboardProjects();
    renderConnectionConfig();
    renderConnection(connection);
    renderSettings();
    renderProject();
    showScreen(state.screen, false);
    if (state.screen === 'project') setProjectTab(state.projectTab, false);

    api.onConnectionChanged(value => {
      state.connection = value;
      renderConnection(value);
    });
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
}

function showScreen(name, persist = true) {
  if (!['dashboard','connection','settings','project'].includes(name)) name = 'dashboard';
  if (name === 'project' && !state.current) name = 'dashboard';
  state.screen = name;
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === `screen-${name}`));
  document.querySelectorAll('[data-screen]').forEach(el => el.classList.toggle('active', el.dataset.screen === name));
  document.querySelectorAll('.project-item').forEach(el => el.classList.toggle('active', name === 'project' && el.dataset.id === state.current?.id));
  renderTopbar();
  if (persist) persistNavigation();
}

function renderTopbar() {
  const title = $('topTitle');
  const subtitle = $('topSubtitle');
  const eyebrow = $('topEyebrow');
  if (state.screen === 'project' && state.current) {
    eyebrow.textContent = 'DỰ ÁN';
    title.textContent = state.current.name;
    subtitle.textContent = state.current.root;
  } else if (state.screen === 'connection') {
    eyebrow.textContent = 'CẤU HÌNH TOÀN CỤC';
    title.textContent = 'Kết nối ChatGPT';
    subtitle.textContent = 'Một kết nối MCP dùng chung cho tất cả dự án.';
  } else if (state.screen === 'settings') {
    eyebrow.textContent = 'ỨNG DỤNG';
    title.textContent = 'Cài đặt';
    subtitle.textContent = 'Chạy nền, khởi động Windows và thông tin hệ thống.';
  } else {
    eyebrow.textContent = 'CHATCODE CÁ NHÂN';
    title.textContent = 'Tổng quan';
    subtitle.textContent = 'Cầu nối riêng giữa ChatGPT và các thư mục bạn cho phép.';
  }
}

function renderProjects() {
  $('projectCount').textContent = String(state.projects.length);
  $('projects').innerHTML = state.projects.length
    ? state.projects.map(p => `
      <button class="project-item ${state.screen === 'project' && state.current?.id === p.id ? 'active' : ''}" data-id="${esc(p.id)}" type="button">
        <span class="project-avatar">${esc((p.name || 'P').slice(0, 1).toUpperCase())}</span>
        <span class="project-copy"><strong>${esc(p.name)}</strong><small>${esc(shortPath(p.root))}</small></span>
      </button>`).join('')
    : `<div class="project-empty"><span>Chưa có dự án</span><small>Thêm thư mục để bắt đầu.</small></div>`;
  document.querySelectorAll('.project-item').forEach(el => el.onclick = () => selectProject(el.dataset.id));
}

function shortPath(value) {
  const text = String(value || '');
  return text.length > 38 ? `…${text.slice(-37)}` : text;
}

function renderDashboardProjects() {
  $('metricProjects').textContent = String(state.projects.length);
  $('dashboardProjectGrid').innerHTML = state.projects.length
    ? state.projects.map(p => {
      const perms = p.permissions || {};
      const enabled = [perms.write, perms.manageFiles, perms.tasks, perms.gitWrite].filter(Boolean).length;
      return `<button class="dashboard-project" data-dashboard-project="${esc(p.id)}" type="button">
        <span class="dashboard-project-avatar">${esc((p.name || 'P').slice(0,1).toUpperCase())}</span>
        <span class="dashboard-project-copy"><strong>${esc(p.name)}</strong><small>${esc(p.root)}</small><i>${enabled}/4 quyền nâng cao đang bật</i></span>
        <span class="chevron">›</span>
      </button>`;
    }).join('')
    : `<div class="dashboard-empty"><strong>Chưa có dự án nào</strong><span>Thêm thư mục đầu tiên. Cấu hình domain không cần làm lại cho từng dự án.</span></div>`;
  document.querySelectorAll('[data-dashboard-project]').forEach(el => el.onclick = () => selectProject(el.dataset.dashboardProject));
}

function selectProject(id) {
  state.current = state.projects.find(p => p.id === id) || null;
  if (!state.current) return;
  state.projectTab = 'overview';
  renderProjects();
  renderProject();
  showScreen('project');
  setProjectTab('overview');
}

function renderProject() {
  const p = state.current;
  if (!p) return;
  $('projectName').textContent = p.name;
  $('projectPath').textContent = p.root;
  $('projectAvatar').textContent = (p.name || 'P').slice(0,1).toUpperCase();
  $('permWrite').checked = !!p.permissions?.write;
  $('permManage').checked = !!p.permissions?.manageFiles;
  $('permTasks').checked = !!p.permissions?.tasks;
  $('permGit').checked = !!p.permissions?.gitWrite;
  $('taskButton').disabled = !p.permissions?.tasks;
  renderPermissionPills();
  renderOverviewPermissions();
}

function renderPermissionPills() {
  const p = state.current?.permissions || {};
  const items = [['Đọc', true], ['Ghi', p.write], ['Quản lý', p.manageFiles], ['Tác vụ', p.tasks], ['Git', p.gitWrite]];
  $('permissionPills').innerHTML = items.map(([label, on]) => `<span class="permission-pill ${on ? 'on' : ''}"><i></i>${label}</span>`).join('');
}

function renderOverviewPermissions() {
  const p = state.current?.permissions || {};
  const items = [
    ['Đọc & tìm kiếm', true, 'Luôn bật'],
    ['Ghi file', p.write, p.write ? 'Được phép' : 'Đang tắt'],
    ['Quản lý file', p.manageFiles, p.manageFiles ? 'Được phép' : 'Đang tắt'],
    ['Chạy tác vụ', p.tasks, p.tasks ? 'Được phép' : 'Đang tắt'],
    ['Git write', p.gitWrite, p.gitWrite ? 'Được phép' : 'Đang tắt']
  ];
  $('overviewPermissions').innerHTML = items.map(([label,on,text]) => `<div><span><i class="mini-dot ${on ? 'on' : ''}"></i>${label}</span><strong class="${on ? 'enabled' : ''}">${text}</strong></div>`).join('');
}

function setProjectTab(name, persist = true) {
  if (!state.current) return;
  if (!['overview','files','search','tasks','git','permissions'].includes(name)) name = 'overview';
  state.projectTab = name;
  document.querySelectorAll('[data-project-tab]').forEach(el => el.classList.toggle('active', el.dataset.projectTab === name));
  document.querySelectorAll('.project-panel').forEach(el => el.classList.toggle('active', el.id === `project-tab-${name}`));
  if (name === 'files') loadFiles();
  if (persist) persistNavigation();
}

function renderConnection(connection = {}) {
  state.connection = connection;
  const status = connection.status || 'stopped';
  const meta = statusMeta(status);
  const connected = status === 'connected';

  $('topConnectionBadge').className = `connection-chip ${meta.tone}`;
  $('topConnectionBadge').querySelector('span:last-child').textContent = meta.title;
  $('sidebarStatusDot').className = `status-dot ${meta.tone}`;
  $('sidebarStatusText').textContent = meta.title;
  $('sidebarStatusDetail').textContent = connected && connection.domain ? connection.domain : 'MCP · localhost:47820';
  $('navConnectionDot').className = `nav-dot ${connected ? 'success' : status === 'error' ? 'error' : ''}`;
  $('connectionHeaderStatus').className = `header-status ${meta.tone}`;
  $('connectionHeaderStatus').querySelector('span:last-child').textContent = meta.title;

  $('dashboardStatusTitle').textContent = connected ? 'ChatGPT Connector đang trực tuyến' : meta.title;
  $('dashboardStatusDetail').textContent = connection.error || (connected ? 'Bạn có thể đóng cửa sổ; ChatCode vẫn chạy nền trong System Tray.' : meta.detail);
  $('heroPulse').className = `pulse ${connected ? 'success' : status === 'error' ? 'error' : ''}`;
  $('metricConnection').textContent = connected ? 'Online' : meta.title;
  $('metricDomain').textContent = connection.domain || (connection.mode === 'quick' ? 'Quick Tunnel' : 'Chưa cấu hình domain');
  $('dashboardPrimaryAction').textContent = connected ? 'Xem kết nối' : 'Mở cấu hình kết nối';

  $('connectionUrl').value = connection.connectionUrl || '';
  $('copyConnection').disabled = !connection.connectionUrl;

  const message = connection.error || (connected
    ? `Đã xác minh ${connection.publicBaseUrl || connection.domain || 'Cloudflare Tunnel'}. Cấu hình này áp dụng cho mọi dự án.`
    : meta.detail);
  $('connectionMessage').className = `inline-message ${connection.error ? 'error' : connected ? 'success' : 'info'}`;
  $('connectionMessage').textContent = message;
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
  $('cloudToken').placeholder = config.hasTunnelToken ? 'Đã lưu · để trống nếu không đổi token' : 'Nhập token eyJ…';
  $('clearCloudToken').classList.toggle('hidden', !config.hasTunnelToken);
}

async function saveAndConnect() {
  const button = $('saveAndConnect');
  setButtonBusy(button, true, 'Đang kết nối…');
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
    if (result.status === 'connected') toast('Kết nối ChatGPT đã sẵn sàng.');
  } catch (error) {
    toast(error.message || String(error), 'error');
  } finally {
    setButtonBusy(button, false, 'Lưu & Kết nối');
  }
}

function setButtonBusy(button, busy, label) {
  button.disabled = busy;
  button.classList.toggle('loading', busy);
  const target = button.querySelector('.button-label');
  if (target) target.textContent = label;
  else if (label) button.textContent = label;
}

async function runDiagnosis() {
  const buttons = [$('diagnoseConnection'), $('dashboardDiagnose')];
  buttons.forEach(b => { b.disabled = true; });
  $('diagnosticResults').innerHTML = `<div class="diagnostic-empty">Đang kiểm tra kết nối…</div>`;
  try {
    const result = await api.diagnoseConnection();
    $('diagnosticResults').innerHTML = result.checks.map(item => `
      <div class="diagnostic-item ${item.ok ? 'ok' : 'fail'}">
        <span class="diagnostic-icon">${item.ok ? '✓' : '!'}</span>
        <div><strong>${esc(item.name)}</strong><small>${item.status ? `HTTP ${item.status} · ` : ''}${item.ms} ms</small></div>
      </div>`).join('');
    toast(result.ok ? 'MCP end-to-end hoạt động bình thường.' : 'Có bước kết nối chưa đạt.', result.ok ? 'success' : 'error');
    if (state.screen === 'dashboard') showScreen('connection');
  } catch (error) {
    $('diagnosticResults').innerHTML = `<div class="diagnostic-empty error-text">${esc(error.message || String(error))}</div>`;
    toast(error.message || String(error), 'error');
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

function renderSettings() {
  const settings = state.settings || { closeToTray: true, launchAtLogin: false };
  $('settingCloseToTray').checked = !!settings.closeToTray;
  $('settingLaunchAtLogin').checked = !!settings.launchAtLogin;
  $('metricBackground').textContent = settings.closeToTray ? 'Bật' : 'Tắt';
  $('appVersion').textContent = state.appInfo?.version ? `v${state.appInfo.version}` : '—';
}

async function saveSettings() {
  try {
    state.settings = await api.updateSettings({
      closeToTray: $('settingCloseToTray').checked,
      launchAtLogin: $('settingLaunchAtLogin').checked
    });
    renderSettings();
    toast('Đã lưu cài đặt ứng dụng.');
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
}

async function addProject() {
  try {
    const project = await api.addProject();
    if (!project) return;
    state.projects = await api.listProjects();
    state.current = state.projects.find(p => p.id === project.id) || project;
    renderProjects();
    renderDashboardProjects();
    renderProject();
    selectProject(project.id);
    toast(`Đã thêm “${project.name}”.`);
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
}

async function removeCurrentProject() {
  if (!state.current) return;
  const name = state.current.name;
  if (!confirm(`Gỡ “${name}” khỏi ChatCode? File trên máy sẽ không bị xóa.`)) return;
  try {
    await api.removeProject(state.current.id);
    state.projects = await api.listProjects();
    state.current = null;
    localStorage.removeItem('chatcode.projectId');
    renderProjects();
    renderDashboardProjects();
    showScreen('dashboard');
    toast(`Đã gỡ “${name}” khỏi ChatCode.`, 'info');
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
}

async function savePermissions() {
  if (!state.current) return;
  try {
    const updated = await api.updateProject({
      id: state.current.id,
      permissions: {
        write: $('permWrite').checked,
        manageFiles: $('permManage').checked,
        tasks: $('permTasks').checked,
        gitWrite: $('permGit').checked
      }
    });
    state.current = updated;
    const index = state.projects.findIndex(p => p.id === updated.id);
    if (index >= 0) state.projects[index] = updated;
    renderPermissionPills();
    renderOverviewPermissions();
    renderDashboardProjects();
    $('taskButton').disabled = !updated.permissions?.tasks;
    $('permissionSaved').textContent = 'Đã lưu thay đổi.';
    clearTimeout(savePermissions.timer);
    savePermissions.timer = setTimeout(() => { $('permissionSaved').textContent = 'Thay đổi được lưu tự động.'; }, 1800);
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
}

async function loadFiles() {
  if (!state.current) return;
  $('fileList').innerHTML = `<div class="list-loading">Đang đọc danh sách tệp…</div>`;
  try {
    const files = await api.listFiles(state.current.id);
    $('fileCount').textContent = `${files.length.toLocaleString('vi-VN')} tệp`;
    $('fileList').innerHTML = files.length
      ? files.map(f => `<button class="file-item" data-path="${esc(f)}" type="button"><span class="file-glyph">${fileGlyph(f)}</span><span>${esc(f)}</span></button>`).join('')
      : `<div class="list-empty">Không có file phù hợp.</div>`;
    document.querySelectorAll('.file-item').forEach(el => el.onclick = () => openFile(el.dataset.path, el));
  } catch (error) {
    $('fileList').innerHTML = `<div class="list-empty error-text">${esc(error.message || String(error))}</div>`;
  }
}

function fileGlyph(file) {
  const ext = String(file).split('.').pop().toLowerCase();
  if (['js','jsx','ts','tsx','mjs','cjs'].includes(ext)) return 'JS';
  if (['json','yaml','yml','toml'].includes(ext)) return '{}';
  if (['md','txt'].includes(ext)) return 'TX';
  if (['css','scss','html','vue','svelte'].includes(ext)) return 'UI';
  if (ext === 'py') return 'PY';
  if (ext === 'php') return 'PH';
  return '·';
}

async function openFile(rel, element) {
  document.querySelectorAll('.file-item').forEach(el => el.classList.toggle('active', el === element));
  $('fileTitle').textContent = rel;
  $('filePreview').textContent = 'Đang tải…';
  try {
    $('filePreview').textContent = await api.readFile(state.current.id, rel);
  } catch (error) {
    $('filePreview').textContent = error.message || String(error);
  }
}

async function runSearch() {
  if (!state.current) return;
  const query = $('searchInput').value.trim();
  if (!query) return;
  $('searchResults').innerHTML = `<div class="search-empty">Đang tìm…</div>`;
  try {
    const results = await api.search(state.current.id, query);
    $('searchResults').innerHTML = results.length
      ? results.map(r => `<article class="search-result"><strong>${esc(r.path)}</strong><pre>${esc(r.snippet)}</pre></article>`).join('')
      : `<div class="search-empty">Không tìm thấy kết quả.</div>`;
  } catch (error) {
    $('searchResults').innerHTML = `<div class="search-empty error-text">${esc(error.message || String(error))}</div>`;
  }
}

async function runTask() {
  if (!state.current) return;
  if (!state.current.permissions?.tasks) return toast('Quyền Tác vụ đang tắt.', 'error');
  const command = $('taskInput').value.trim();
  if (!command) return;
  $('taskButton').disabled = true;
  $('taskOutput').textContent = `> ${command}\n\nĐang chạy…`;
  try {
    const result = await api.runTask(state.current.id, command);
    $('taskOutput').textContent = [`> ${command}`, '', result.stdout || '', result.stderr || '', `Exit code: ${result.code}`].filter(Boolean).join('\n');
  } catch (error) {
    $('taskOutput').textContent = error.message || String(error);
  } finally {
    $('taskButton').disabled = !state.current.permissions?.tasks;
  }
}

async function runGit(type) {
  if (!state.current) return;
  $('gitOutput').textContent = 'Đang chạy Git…';
  try {
    const result = type === 'diff' ? await api.gitDiff(state.current.id) : await api.gitStatus(state.current.id);
    $('gitOutput').textContent = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n') || '(không có output)';
  } catch (error) {
    $('gitOutput').textContent = error.message || String(error);
  }
}

document.querySelectorAll('[data-screen]').forEach(el => el.onclick = () => showScreen(el.dataset.screen));
document.querySelectorAll('[data-project-tab]').forEach(el => el.onclick = () => setProjectTab(el.dataset.projectTab));
document.querySelectorAll('[data-open-tab]').forEach(el => el.onclick = () => setProjectTab(el.dataset.openTab));

$('addProject').onclick = addProject;
$('dashboardAddProject').onclick = addProject;
$('dashboardPrimaryAction').onclick = () => showScreen('connection');
$('hideToTray').onclick = () => api.hideApp();

$('modeCustom').onclick = () => setConnectionMode('custom');
$('modeQuick').onclick = () => setConnectionMode('quick');
$('toggleToken').onclick = () => {
  const input = $('cloudToken');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  $('toggleToken').textContent = visible ? 'Hiện' : 'Ẩn';
};
$('saveAndConnect').onclick = saveAndConnect;
$('restartConnection').onclick = async () => {
  try {
    renderConnection({ ...state.connection, status: 'starting', error: '' });
    const result = await api.startConnection();
    renderConnection(result);
    if (result.status === 'connected') toast('Đã kết nối lại thành công.');
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
};
$('stopConnection').onclick = async () => {
  try {
    await api.stopConnection();
    renderConnection(await api.connectionStatus());
    toast('Đã ngắt kết nối công khai.', 'info');
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
};
$('copyConnection').onclick = async () => {
  try { await api.copyConnection(); toast('Đã sao chép URL MCP.'); }
  catch (error) { toast(error.message || String(error), 'error'); }
};
$('rotateConnection').onclick = async () => {
  if (!confirm('Đổi secret MCP? URL connector hiện tại trong ChatGPT sẽ ngừng hoạt động.')) return;
  try {
    const result = await api.rotateConnection();
    renderConnection(result);
    toast('Đã đổi secret MCP.');
  } catch (error) { toast(error.message || String(error), 'error'); }
};
$('clearCloudToken').onclick = async () => {
  if (!confirm('Xóa Tunnel Token đã lưu?')) return;
  try {
    state.connectionConfig = await api.clearTunnelToken();
    renderConnectionConfig();
    renderConnection(await api.connectionStatus());
    toast('Đã xóa Tunnel Token.', 'info');
  } catch (error) { toast(error.message || String(error), 'error'); }
};
$('diagnoseConnection').onclick = runDiagnosis;
$('dashboardDiagnose').onclick = runDiagnosis;

$('removeProject').onclick = removeCurrentProject;
['permWrite','permManage','permTasks','permGit'].forEach(id => $(id).addEventListener('change', savePermissions));
$('refreshFiles').onclick = loadFiles;
$('searchButton').onclick = runSearch;
$('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
document.querySelectorAll('.quick-commands button').forEach(button => button.onclick = () => { $('taskInput').value = button.dataset.command; });
$('taskButton').onclick = runTask;
$('taskInput').addEventListener('keydown', e => { if (e.key === 'Enter') runTask(); });
$('gitStatus').onclick = () => runGit('status');
$('gitDiff').onclick = () => runGit('diff');
$('settingCloseToTray').addEventListener('change', saveSettings);
$('settingLaunchAtLogin').addEventListener('change', saveSettings);

init();
