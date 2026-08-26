const api = window.personalCode;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const state = {
  projects: [],
  current: null,
  route: 'dashboard',
  projectTab: 'overview',
  connectionMode: 'custom',
  connectionConfig: null,
  connection: null,
  settings: null,
  usage: null,
  usageDays: 14,
  appInfo: null,
  fileCountCache: new Map(),
  usageTimer: null
};

const STATUS = {
  connected: { title: 'Đã kết nối', detail: 'ChatGPT có thể gọi MCP qua HTTPS', tone: 'success' },
  verifying: { title: 'Đang xác minh', detail: 'Đang kiểm tra domain và MCP', tone: 'progress' },
  starting: { title: 'Đang kết nối', detail: 'Đang mở Cloudflare Tunnel', tone: 'progress' },
  'installing-tunnel': { title: 'Đang chuẩn bị', detail: 'Đang cài cloudflared lần đầu', tone: 'progress' },
  'config-required': { title: 'Cần cấu hình', detail: 'Thiết lập domain và Tunnel Token một lần', tone: 'warning' },
  stopped: { title: 'Đã ngắt', detail: 'Tunnel đang dừng', tone: 'neutral' },
  error: { title: 'Kết nối lỗi', detail: 'Kiểm tra Cloudflare hoặc mạng', tone: 'error' }
};

const PAGE_META = {
  dashboard: ['CHATCODE CÁ NHÂN', 'Tổng quan', 'Theo dõi kết nối, dự án và hoạt động của ChatGPT trên máy này.'],
  connection: ['KẾT NỐI TOÀN CỤC', 'Kết nối ChatGPT', 'Domain và Tunnel Token chỉ cấu hình một lần cho toàn bộ dự án.'],
  activity: ['AUDIT LOG', 'Hoạt động', 'Xem ChatGPT đã đọc, ghi, chạy task hoặc thao tác Git ở đâu.'],
  settings: ['ỨNG DỤNG', 'Cài đặt', 'Điều khiển cách ChatCode chạy nền và khởi động cùng Windows.']
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
  }, 3300);
}

function statusMeta(status) { return STATUS[status] || STATUS.stopped; }
function formatNumber(value) { return Number(value || 0).toLocaleString('vi-VN'); }
function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
  return `${(value / 1024 ** 3).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} GB`;
}
function formatDuration(ms) {
  const n = Number(ms || 0);
  return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} s`;
}
function formatUptime(sec) {
  const s = Math.max(0, Number(sec || 0));
  if (s < 60) return `${Math.floor(s)} giây`;
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
  return `${Math.floor(s / 86400)} ngày ${Math.floor((s % 86400) / 3600)} giờ`;
}
function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}
function activityLabel(category, tool) {
  if (category === 'read') return 'Đọc / phân tích';
  if (category === 'write') return 'Ghi file';
  if (category === 'manage') return 'Quản lý file';
  if (category === 'task') return 'Tác vụ';
  if (category === 'git') return 'Git';
  return tool || 'Khác';
}
function activityGlyph(category, ok) {
  if (!ok) return '!';
  return ({ read:'R', write:'W', manage:'M', task:'T', git:'G' })[category] || '•';
}

async function init() {
  try {
    const [projects, config, connection, settings, usage, appInfo] = await Promise.all([
      api.listProjects(),
      api.connectionConfig(),
      api.connectionStatus(),
      api.getSettings(),
      api.usageSnapshot(state.usageDays),
      api.appInfo()
    ]);
    state.projects = projects;
    state.connectionConfig = config;
    state.connectionMode = config?.mode || 'custom';
    state.connection = connection;
    state.settings = settings;
    state.usage = usage;
    state.appInfo = appInfo;

    renderProjects();
    renderDashboardProjects();
    renderConnectionConfig();
    renderConnection(connection);
    renderUsage();
    renderActivity();
    renderSettings();
    routeTo('dashboard');

    api.onConnectionChanged(connectionValue => {
      state.connection = connectionValue;
      renderConnection(connectionValue);
    });
    api.onActivityChanged(() => refreshUsageSoon());
    api.onActivityReset(() => refreshUsage());
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
}

function refreshUsageSoon() {
  clearTimeout(state.usageTimer);
  state.usageTimer = setTimeout(() => refreshUsage(), 220);
}

async function refreshUsage() {
  try {
    state.usage = await api.usageSnapshot(state.usageDays);
    renderUsage();
    renderActivity();
    if (state.route === 'project' && state.current) renderProjectOverviewActivity();
  } catch {}
}

function renderProjects() {
  $('projectCount').textContent = String(state.projects.length);
  $('projects').innerHTML = state.projects.length
    ? state.projects.map(p => `
      <button class="project-item ${state.route === 'project' && state.current?.id === p.id ? 'active' : ''}" data-project-id="${esc(p.id)}">
        <span class="project-avatar">${esc((p.name || 'P').slice(0,1).toUpperCase())}</span>
        <span class="project-copy"><strong>${esc(p.name)}</strong><small>${esc(p.root)}</small></span>
      </button>`).join('')
    : `<div class="empty-block">Chưa có dự án nào.</div>`;
  document.querySelectorAll('[data-project-id]').forEach(el => el.onclick = () => selectProject(el.dataset.projectId));
}

function renderDashboardProjects() {
  $('dashboardProjects').innerHTML = state.projects.length
    ? state.projects.map(p => `<button class="project-card" data-dashboard-project="${esc(p.id)}"><span class="project-avatar">${esc((p.name || 'P').slice(0,1).toUpperCase())}</span><div><strong>${esc(p.name)}</strong><span>${esc(p.root)}</span></div></button>`).join('')
    : `<div class="empty-block">Thêm thư mục đầu tiên để ChatGPT có workspace làm việc.</div>`;
  document.querySelectorAll('[data-dashboard-project]').forEach(el => el.onclick = () => selectProject(el.dataset.dashboardProject));
}

function routeTo(route) {
  if (route === 'project' && !state.current) route = 'dashboard';
  state.route = route;
  document.querySelectorAll('.route').forEach(el => el.classList.toggle('active', el.id === `route-${route}`));
  document.querySelectorAll('.side-link[data-route]').forEach(el => el.classList.toggle('active', route !== 'project' && el.dataset.route === route));
  renderProjects();

  if (route === 'project' && state.current) {
    $('pageEyebrow').textContent = 'PROJECT WORKSPACE';
    $('pageTitle').textContent = state.current.name;
    $('pageSubtitle').textContent = state.current.root;
  } else {
    const meta = PAGE_META[route] || PAGE_META.dashboard;
    $('pageEyebrow').textContent = meta[0];
    $('pageTitle').textContent = meta[1];
    $('pageSubtitle').textContent = meta[2];
  }
  if (route === 'activity') renderActivity();
  if (route === 'dashboard') renderUsage();
}

async function selectProject(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project) return;
  state.current = project;
  state.projectTab = 'overview';
  renderProjectHeader();
  setProjectTab('overview');
  routeTo('project');
  renderProjectOverviewActivity();
  await loadProjectOverview();
}

function renderProjectHeader() {
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
  renderProjectPermissionSummary();
}

function renderPermissionPills() {
  const p = state.current?.permissions || {};
  const values = [['Đọc', true], ['Ghi', p.write], ['Quản lý', p.manageFiles], ['Task', p.tasks], ['Git', p.gitWrite]];
  $('permissionPills').innerHTML = values.map(([label,on]) => `<span class="permission-pill ${on ? 'on' : ''}">${label}</span>`).join('');
  $('projectPermissionCount').textContent = `${values.filter(([,on]) => on).length}/5`;
}

function renderProjectPermissionSummary() {
  if (!state.current) return;
  const p = state.current.permissions || {};
  const rows = [['Đọc & tìm kiếm', true], ['Ghi file', p.write], ['Quản lý file', p.manageFiles], ['Tác vụ', p.tasks], ['Git write', p.gitWrite]];
  $('projectPermissionSummary').innerHTML = rows.map(([label,on]) => `<div class="permission-summary-row"><span>${label}</span><b class="${on ? 'on' : ''}">${on ? 'Đang bật' : 'Đang tắt'}</b></div>`).join('');
}

function setProjectTab(tab) {
  state.projectTab = tab;
  document.querySelectorAll('[data-project-tab]').forEach(el => el.classList.toggle('active', el.dataset.projectTab === tab));
  document.querySelectorAll('.project-tab').forEach(el => el.classList.toggle('active', el.id === `project-tab-${tab}`));
  if (tab === 'files') loadFiles();
  if (tab === 'overview') loadProjectOverview();
}

async function loadProjectOverview() {
  if (!state.current) return;
  renderProjectOverviewActivity();
  const projectId = state.current.id;
  if (state.fileCountCache.has(projectId)) $('projectFileCount').textContent = formatNumber(state.fileCountCache.get(projectId));
  else $('projectFileCount').textContent = '…';
  $('projectGitSummary').textContent = 'Đang kiểm tra';
  try {
    const [files, git] = await Promise.all([api.listFiles(projectId), api.gitStatus(projectId)]);
    state.fileCountCache.set(projectId, files.length);
    $('projectFileCount').textContent = formatNumber(files.length);
    const out = String(git?.stdout || '').trim();
    if (!git?.ok) $('projectGitSummary').textContent = 'Không có Git';
    else if (!out) $('projectGitSummary').textContent = 'Sạch';
    else {
      const lines = out.split(/\r?\n/);
      const changes = lines.slice(1).filter(Boolean).length;
      $('projectGitSummary').textContent = changes ? `${changes} thay đổi` : (lines[0].replace(/^##\s*/, '') || 'Sạch');
    }
  } catch {
    $('projectGitSummary').textContent = 'Không xác định';
  }
}

function renderProjectOverviewActivity() {
  if (!state.current) return;
  const recent = (state.usage?.recent || []).filter(item => item.projectId === state.current.id || item.project === state.current.name);
  $('projectActionCount').textContent = formatNumber(recent.length);
  $('projectActivity').innerHTML = renderActivityRows(recent.slice(0,6));
}

function renderConnection(connection = {}) {
  const status = connection.status || 'stopped';
  const meta = statusMeta(status);
  const connected = status === 'connected';
  const domain = connection.domain || state.connectionConfig?.domain || '';

  $('sidebarStatusDot').className = `status-dot ${meta.tone}`;
  $('sidebarStatusText').textContent = meta.title;
  $('sidebarStatusSub').textContent = connected && domain ? domain : 'MCP cục bộ · 47820';
  $('navConnectionDot').className = `tiny-dot ${meta.tone}`;

  $('topConnectionBadge').className = `connection-badge ${meta.tone}`;
  $('topConnectionBadge').querySelector('.status-dot').className = `status-dot ${meta.tone}`;
  $('topConnectionBadge').querySelector('span:last-child').textContent = meta.title;
  $('quickCopyMcp').disabled = !connection.connectionUrl;

  $('heroStatusDot').className = `status-dot ${meta.tone}`;
  $('heroStatusTitle').textContent = meta.title;
  $('heroDomain').textContent = domain || (connection.mode === 'quick' ? connection.publicBaseUrl || 'Quick Tunnel' : 'Domain chưa cấu hình');
  $('heroUptime').textContent = `Uptime ${formatUptime(connection.uptimeSec || state.usage?.uptimeSec || 0)}`;
  $('heroConnectionDetail').textContent = connection.error || (connected ? `MCP đang sẵn sàng qua ${domain || connection.publicBaseUrl || 'Cloudflare'}. Đóng cửa sổ vẫn tiếp tục chạy nền.` : meta.detail);

  $('connectionBigIcon').querySelector('.status-dot').className = `status-dot ${meta.tone}`;
  $('connectionSummaryTitle').textContent = meta.title;
  $('connectionSummaryText').textContent = connection.error || (connected ? `Kết nối toàn cục đang hoạt động qua ${domain || connection.publicBaseUrl || 'Cloudflare'}.` : meta.detail);

  $('connectionUrl').value = connection.connectionUrl || '';
  $('copyConnection').disabled = !connection.connectionUrl;
  $('urlStatusDot').className = `status-dot ${connected ? 'success' : meta.tone}`;
  $('urlStatusText').textContent = connected ? 'Sẵn sàng cho ChatGPT' : meta.title;
  $('detailDomain').textContent = domain || '—';
  $('detailMode').textContent = connection.mode === 'quick' ? 'Quick Tunnel' : 'Domain riêng';
  renderInlineMessage(connection.error || (connected ? 'Cloudflare và MCP đã được xác minh.' : meta.detail), connection.error ? 'error' : connected ? 'success' : 'info');
}

function renderInlineMessage(message, tone = 'info') {
  $('connectionMessage').className = `inline-message ${tone}`;
  $('connectionMessage').textContent = message || '';
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
  $('cloudToken').placeholder = config.hasTunnelToken ? 'Đã lưu · nhập token mới để thay đổi' : 'eyJ...';
  $('clearCloudToken').classList.toggle('hidden', !config.hasTunnelToken);
}

function renderUsage() {
  const usage = state.usage;
  if (!usage) return;
  const a = usage.aggregate || {};
  const calls = Number(a.calls || 0);
  $('kpiCalls').textContent = formatNumber(calls);
  $('kpiCallsSub').textContent = `Trong ${usage.rangeDays || state.usageDays} ngày`;
  $('kpiRead').textContent = formatNumber(a.read || 0);
  $('kpiWrite').textContent = formatNumber((a.write || 0) + (a.manage || 0));
  $('kpiAutomation').textContent = formatNumber((a.task || 0) + (a.git || 0));
  $('kpiIn').textContent = formatBytes(a.bytesIn || 0);
  $('kpiErrors').textContent = formatNumber(a.errors || 0);
  $('kpiLatency').textContent = `Độ trễ TB ${calls ? formatDuration((a.durationMs || 0) / calls) : '0 ms'}`;
  $('heroUptime').textContent = `Uptime ${formatUptime(state.connection?.uptimeSec || usage.uptimeSec || 0)}`;
  renderUsageChart(usage.series || []);
  $('dashboardActivity').innerHTML = renderActivityRows((usage.recent || []).slice(0,7));
}

function renderUsageChart(series) {
  if (!series.length) {
    $('usageChart').innerHTML = `<div class="empty-block">Chưa có dữ liệu MCP.</div>`;
    return;
  }
  const totals = series.map(d => Number(d.calls || 0));
  const max = Math.max(1, ...totals);
  $('usageChart').innerHTML = series.map((d, index) => {
    const total = Number(d.calls || 0);
    const chartHeight = total ? Math.max(8, Math.round((total / max) * 180)) : 3;
    const read = Number(d.read || 0);
    const write = Number(d.write || 0) + Number(d.manage || 0);
    const task = Number(d.task || 0) + Number(d.git || 0) + Number(d.other || 0);
    const denominator = Math.max(1, read + write + task);
    const readH = Math.round(chartHeight * read / denominator);
    const writeH = Math.round(chartHeight * write / denominator);
    const taskH = Math.max(0, chartHeight - readH - writeH);
    const date = new Date(`${d.date}T12:00:00`);
    const showLabel = series.length <= 14 || index % 3 === 0 || index === series.length - 1;
    const label = showLabel ? date.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit' }) : '';
    return `<div class="chart-day" data-tip="${esc(`${d.date}: ${total} lượt`)}"><div class="chart-stack" style="height:${chartHeight}px"><div class="chart-segment read" style="height:${readH}px"></div><div class="chart-segment write" style="height:${writeH}px"></div><div class="chart-segment task" style="height:${taskH}px"></div></div><label>${label}</label></div>`;
  }).join('');
}

function renderActivityRows(items) {
  if (!items?.length) return `<div class="empty-block">Chưa có hoạt động ChatGPT nào được ghi nhận.</div>`;
  return items.map(item => {
    const cls = item.ok === false ? 'error' : item.category;
    const title = `${activityLabel(item.category, item.tool)}${item.project ? ` · ${item.project}` : ''}`;
    const detail = item.error || item.target || item.tool;
    return `<div class="activity-row"><span class="activity-glyph ${esc(cls)}">${esc(activityGlyph(item.category, item.ok))}</span><div class="activity-copy"><strong>${esc(title)}</strong><span>${esc(detail)}</span></div><div class="activity-meta"><strong>${esc(formatTime(item.at))}</strong><span>${esc(formatDuration(item.durationMs))} · ${esc(formatBytes((item.bytesIn || 0) + (item.bytesOut || 0)))}</span></div></div>`;
  }).join('');
}

function renderActivity() {
  const filter = $('activityFilter')?.value || 'all';
  let items = state.usage?.recent || [];
  if (filter === 'error') items = items.filter(item => item.ok === false);
  else if (filter !== 'all') items = items.filter(item => item.category === filter);
  $('activityList').innerHTML = renderActivityRows(items);
}

function renderSettings() {
  const settings = state.settings || {};
  $('settingCloseToTray').checked = settings.closeToTray !== false;
  $('settingLaunchAtLogin').checked = !!settings.launchAtLogin;
  $('settingActivityNotifications').checked = settings.activityNotifications !== false;
  $('appVersion').textContent = `v${state.appInfo?.version || '0.5.0'}`;
}

async function addProject() {
  try {
    const project = await api.addProject();
    if (!project) return;
    state.projects = await api.listProjects();
    renderProjects();
    renderDashboardProjects();
    toast(`Đã thêm dự án “${project.name}”.`);
    selectProject(project.id);
  } catch (error) { toast(error.message || String(error), 'error'); }
}

async function loadFiles() {
  if (!state.current) return;
  $('fileList').innerHTML = `<div class="empty-block">Đang tải danh sách tệp…</div>`;
  try {
    const files = await api.listFiles(state.current.id);
    state.fileCountCache.set(state.current.id, files.length);
    $('fileCount').textContent = `${formatNumber(files.length)} tệp`;
    $('projectFileCount').textContent = formatNumber(files.length);
    $('fileList').innerHTML = files.length ? files.map(f => `<button class="file-item" data-file-path="${esc(f)}"><span class="file-glyph">${esc(fileGlyph(f))}</span><span>${esc(f)}</span></button>`).join('') : `<div class="empty-block">Không tìm thấy file văn bản.</div>`;
    document.querySelectorAll('[data-file-path]').forEach(el => el.onclick = () => openFile(el.dataset.filePath, el));
  } catch (error) { $('fileList').innerHTML = `<div class="empty-block">${esc(error.message || String(error))}</div>`; }
}

function fileGlyph(file) {
  const ext = String(file).split('.').pop().toLowerCase();
  if (['js','jsx','ts','tsx','mjs','cjs'].includes(ext)) return 'JS';
  if (['json','yaml','yml','toml'].includes(ext)) return '{}';
  if (['md','txt'].includes(ext)) return '¶';
  if (['css','scss','html','vue','svelte'].includes(ext)) return '◇';
  if (ext === 'py') return 'Py';
  if (ext === 'php') return 'PHP';
  return '·';
}

async function openFile(rel, element) {
  document.querySelectorAll('.file-item').forEach(el => el.classList.toggle('active', el === element));
  $('fileTitle').textContent = rel;
  $('filePreview').textContent = 'Đang tải nội dung…';
  try { $('filePreview').textContent = await api.readFile(state.current.id, rel); }
  catch (error) { $('filePreview').textContent = error.message || String(error); }
}

async function saveAndConnect() {
  const button = $('saveAndConnect');
  button.disabled = true;
  button.textContent = 'Đang kết nối…';
  renderInlineMessage('Đang lưu cấu hình toàn cục và kiểm tra Cloudflare…', 'info');
  try {
    state.connectionConfig = await api.saveConnectionConfig({ mode: state.connectionMode, domain: $('cloudDomain').value.trim(), tunnelToken: $('cloudToken').value.trim() });
    $('cloudToken').value = '';
    renderConnectionConfig();
    const result = await api.startConnection();
    state.connection = result;
    renderConnection(result);
    if (result.status === 'connected') toast('Kết nối Cloudflare thành công.');
  } catch (error) {
    renderInlineMessage(error.message || String(error), 'error');
    toast(error.message || String(error), 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Lưu & kết nối';
  }
}

async function runDiagnostics() {
  const buttons = [$('diagnoseConnection'), $('heroDiagnose')];
  buttons.forEach(b => { if (b) b.disabled = true; });
  $('diagnosticResults').innerHTML = `<div class="diagnostic-placeholder">Đang chạy kiểm tra end-to-end…</div>`;
  try {
    const result = await api.diagnoseConnection();
    $('diagnosticResults').innerHTML = result.checks.map(item => `<div class="diagnostic-item ${item.ok ? 'ok' : 'bad'}"><span class="diagnostic-mark">${item.ok ? '✓' : '!'}</span><div><strong>${esc(item.name)}</strong><span>${esc(item.detail || (item.ok ? 'OK' : 'Không phản hồi'))}</span></div><small>${item.status || '—'} · ${item.ms} ms</small></div>`).join('');
    toast(result.ok ? 'Tất cả bước kết nối đều hoạt động.' : 'Có bước kiểm tra chưa đạt.', result.ok ? 'success' : 'error');
  } catch (error) {
    $('diagnosticResults').innerHTML = `<div class="diagnostic-placeholder">${esc(error.message || String(error))}</div>`;
    toast(error.message || String(error), 'error');
  } finally { buttons.forEach(b => { if (b) b.disabled = false; }); }
}

async function saveProjectPermissions() {
  if (!state.current) return;
  try {
    const updated = await api.updateProject({ id: state.current.id, name: state.current.name, permissions: {
      write: $('permWrite').checked,
      manageFiles: $('permManage').checked,
      tasks: $('permTasks').checked,
      gitWrite: $('permGit').checked
    }});
    state.current = updated;
    state.projects = state.projects.map(p => p.id === updated.id ? updated : p);
    renderProjectHeader();
    renderProjects();
    renderDashboardProjects();
    toast('Đã cập nhật quyền dự án.');
  } catch (error) { toast(error.message || String(error), 'error'); }
}

async function saveSettings() {
  try {
    state.settings = await api.updateSettings({
      closeToTray: $('settingCloseToTray').checked,
      launchAtLogin: $('settingLaunchAtLogin').checked,
      activityNotifications: $('settingActivityNotifications').checked
    });
    renderSettings();
    toast('Đã lưu cài đặt.');
  } catch (error) { toast(error.message || String(error), 'error'); }
}

document.querySelectorAll('[data-route]').forEach(el => el.addEventListener('click', () => routeTo(el.dataset.route)));
$('addProject').onclick = addProject;
$('dashboardAddProject').onclick = addProject;
$('quickCopyMcp').onclick = async () => { try { await api.copyConnection(); toast('Đã sao chép URL MCP.'); } catch (e) { toast(e.message || String(e), 'error'); } };

$('usageRange').onchange = async () => {
  state.usageDays = Number($('usageRange').value) || 14;
  await refreshUsage();
};
$('heroDiagnose').onclick = async () => { routeTo('connection'); await runDiagnostics(); };

$('modeCustom').onclick = () => setConnectionMode('custom');
$('modeQuick').onclick = () => setConnectionMode('quick');
$('toggleToken').onclick = () => {
  const input = $('cloudToken');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('toggleToken').textContent = input.type === 'password' ? 'Hiện' : 'Ẩn';
};
$('saveAndConnect').onclick = saveAndConnect;
$('restartConnection').onclick = async () => {
  try { renderConnection({ ...state.connection, status:'starting', error:'' }); const result = await api.startConnection(); state.connection = result; renderConnection(result); toast('Đã kết nối lại.'); }
  catch (e) { toast(e.message || String(e), 'error'); }
};
$('stopConnection').onclick = async () => {
  try { await api.stopConnection(); state.connection = await api.connectionStatus(); renderConnection(state.connection); toast('Đã ngắt Cloudflare Tunnel.', 'info'); }
  catch (e) { toast(e.message || String(e), 'error'); }
};
$('copyConnection').onclick = async () => { try { await api.copyConnection(); toast('Đã sao chép URL MCP.'); } catch (e) { toast(e.message || String(e), 'error'); } };
$('diagnoseConnection').onclick = runDiagnostics;
$('rotateConnection').onclick = async () => {
  if (!confirm('Đổi secret MCP? URL connector hiện tại trong ChatGPT sẽ ngừng hoạt động và bạn phải cập nhật URL mới.')) return;
  try { const result = await api.rotateConnection(); state.connection = result; renderConnection(result); toast('Đã đổi secret MCP.'); }
  catch (e) { toast(e.message || String(e), 'error'); }
};
$('clearCloudToken').onclick = async () => {
  if (!confirm('Xóa Tunnel Token đã lưu? Bạn sẽ cần nhập lại để kết nối domain riêng.')) return;
  try { state.connectionConfig = await api.clearTunnelToken(); renderConnectionConfig(); state.connection = await api.connectionStatus(); renderConnection(state.connection); toast('Đã xóa Tunnel Token.', 'info'); }
  catch (e) { toast(e.message || String(e), 'error'); }
};

$('activityFilter').onchange = renderActivity;
$('clearActivity').onclick = async () => {
  if (!confirm('Xóa toàn bộ thống kê và audit log ChatGPT trên máy này?')) return;
  try { state.usage = await api.clearUsage(); renderUsage(); renderActivity(); renderProjectOverviewActivity(); toast('Đã xóa lịch sử hoạt động.', 'info'); }
  catch (e) { toast(e.message || String(e), 'error'); }
};

['settingCloseToTray','settingLaunchAtLogin','settingActivityNotifications'].forEach(id => $(id).onchange = saveSettings);
$('hideToTray').onclick = async () => { await api.hideApp(); };

document.querySelectorAll('[data-project-tab]').forEach(el => el.onclick = () => setProjectTab(el.dataset.projectTab));
document.querySelectorAll('[data-project-tab-target]').forEach(el => el.onclick = () => setProjectTab(el.dataset.projectTabTarget));
$('refreshFiles').onclick = loadFiles;
$('searchButton').onclick = async () => {
  if (!state.current) return;
  const query = $('searchInput').value.trim();
  if (!query) return;
  $('searchResults').innerHTML = `<div class="empty-block">Đang tìm trong dự án…</div>`;
  try {
    const results = await api.search(state.current.id, query);
    $('searchResults').innerHTML = results.length ? results.map(r => `<article class="search-card"><strong>${esc(r.path)}</strong><pre>${esc(r.snippet)}</pre></article>`).join('') : `<div class="empty-block">Không tìm thấy kết quả phù hợp.</div>`;
  } catch (e) { $('searchResults').innerHTML = `<div class="empty-block">${esc(e.message || String(e))}</div>`; }
};
$('searchInput').addEventListener('keydown', event => { if (event.key === 'Enter') $('searchButton').click(); });
document.querySelectorAll('.quick-commands button').forEach(el => el.onclick = () => { $('taskInput').value = el.dataset.command; });
$('taskButton').onclick = async () => {
  if (!state.current) return;
  if (!state.current.permissions?.tasks) return toast('Quyền Tác vụ đang tắt.', 'error');
  const command = $('taskInput').value.trim();
  if (!command) return;
  $('taskOutput').textContent = 'Đang chạy…';
  try {
    const result = await api.runTask(state.current.id, command);
    $('taskOutput').textContent = `${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}`.trim() || `Đã hoàn tất (code ${result.code}).`;
  } catch (e) { $('taskOutput').textContent = e.message || String(e); }
};
$('gitStatus').onclick = async () => {
  if (!state.current) return;
  $('gitOutput').textContent = 'Đang tải Git status…';
  try { const r = await api.gitStatus(state.current.id); $('gitOutput').textContent = `${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}`.trim() || 'Working tree sạch.'; }
  catch (e) { $('gitOutput').textContent = e.message || String(e); }
};
$('gitDiff').onclick = async () => {
  if (!state.current) return;
  $('gitOutput').textContent = 'Đang tải Git diff…';
  try { const r = await api.gitDiff(state.current.id); $('gitOutput').textContent = `${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}`.trim() || 'Không có thay đổi chưa stage.'; }
  catch (e) { $('gitOutput').textContent = e.message || String(e); }
};
['permWrite','permManage','permTasks','permGit'].forEach(id => $(id).onchange = saveProjectPermissions);
$('removeProject').onclick = async () => {
  if (!state.current) return;
  const name = state.current.name;
  if (!confirm(`Gỡ “${name}” khỏi ChatCode? File thật trên máy sẽ không bị xóa.`)) return;
  try {
    await api.removeProject(state.current.id);
    state.projects = await api.listProjects();
    state.current = null;
    renderProjects(); renderDashboardProjects(); routeTo('dashboard');
    toast(`Đã gỡ “${name}” khỏi ChatCode.`, 'info');
  } catch (e) { toast(e.message || String(e), 'error'); }
};

init();
