(() => {
  const api = window.personalCode;
  if (!api || window.__chatcodeV081Loaded) return;
  window.__chatcodeV081Loaded = true;
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const logTime = value => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString('vi-VN', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
  };

  function addCss() {
    if (document.querySelector('link[data-v081]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'v081.css'; link.dataset.v081 = '1';
    document.head.appendChild(link);
  }

  function iconSlot(selector, name) {
    const el = document.querySelector(selector);
    if (!el) return;
    let slot = el.querySelector(':scope > span:first-child');
    if (!slot) { slot = document.createElement('span'); el.prepend(slot); }
    slot.className = 'icon-slot';
    slot.innerHTML = `<i data-lucide="${name}"></i>`;
  }
  function buttonIcon(selector, name, cleanPrefix = '') {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el || el.querySelector(':scope > [data-v081-icon]')) return;
    if (cleanPrefix && el.textContent.startsWith(cleanPrefix)) el.textContent = el.textContent.slice(cleanPrefix.length).trim();
    const icon = document.createElement('i');
    icon.dataset.lucide = name; icon.dataset.v081Icon = '1';
    el.prepend(icon); el.classList.add('iconified');
  }

  function installIcons() {
    iconSlot('.nav-link[data-route="dashboard"]', 'layout-dashboard');
    iconSlot('.nav-link[data-route="connection"]', 'plug-zap');
    iconSlot('.nav-link[data-route="activity"]', 'scroll-text');
    iconSlot('.nav-link[data-route="settings"]', 'settings-2');
    iconSlot('#v07SafetyNav', 'shield-check');
    buttonIcon('#addProject', 'folder-plus', '＋');
    buttonIcon('#dashboardAddProject', 'folder-plus', '＋');
    buttonIcon('#copyMcpTop', 'copy');
    buttonIcon('#heroDiagnose', 'stethoscope');
    buttonIcon('#diagnose', 'stethoscope');
    buttonIcon('#restartConnection', 'refresh-cw');
    buttonIcon('#saveConnect', 'save');
    buttonIcon('#stopConnection', 'unplug');
    buttonIcon('#copyMcp', 'copy');
    buttonIcon('#copyDiagnostic', 'clipboard-copy');
    buttonIcon('#reindexProject', 'refresh-cw', '↻');
    buttonIcon('#removeProject', 'folder-minus');
    buttonIcon('#hideTray', 'panel-bottom-close');
    buttonIcon('#checkUpdate', 'refresh-cw');
    buttonIcon('#downloadUpdate', 'download');
    buttonIcon('#installUpdate', 'package-check');
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  function polishText() {
    const notify = $('settingNotify')?.closest('.setting');
    if (notify) {
      const title = notify.querySelector('strong');
      const text = notify.querySelector('span');
      if (title) title.textContent = 'Thông báo khi tác vụ hoàn tất';
      if (text) text.textContent = 'Chỉ hiện một thông báo sau khi run_task hoàn tất; không báo mỗi lần ghi file hoặc Git.';
    }
    $('saveConnect')?.closest('.row')?.classList.add('v081-connection-actions');
    const empty = document.querySelector('#diagnostics .empty');
    if (empty) empty.textContent = 'Bấm “Chẩn đoán” để test Local MCP → DNS hệ thống → Cloudflare HTTPS → Public MCP initialize → tools/list → cloudflared.';
  }

  window.activityRows = function(items) {
    if (!Array.isArray(items) || !items.length) return '<div class="empty">Chưa có hoạt động MCP.</div>';
    const head = '<div class="activity-log-head"><span>Thời gian</span><span>Trạng thái</span><span>Tool</span><span>Project</span><span>Mục tiêu</span><span>Độ trễ</span></div>';
    const rows = items.map(item => {
      const ok = item.ok !== false;
      const error = !ok && item.error ? `<div class="activity-log-error">${escapeHtml(item.error)}</div>` : '';
      return `<div class="activity-log-line ${ok ? 'ok' : 'failed'}"><span class="activity-log-time">${logTime(item.at)}</span><span class="activity-log-status">${ok ? 'OK' : 'ERR'}</span><span class="activity-log-tool">${escapeHtml(item.tool || item.category || 'unknown')}</span><span class="activity-log-project">${escapeHtml(item.project || '—')}</span><span class="activity-log-target">${escapeHtml(item.target || '—')}</span><span class="activity-log-duration">${Math.max(0, Number(item.durationMs) || 0)} ms</span>${error}</div>`;
    }).join('');
    return head + rows;
  };

  async function version() {
    try {
      const info = await api.appInfo();
      document.querySelectorAll('.version-badge').forEach(el => { el.textContent = `v${info.version}`; });
      if ($('appVersion')) $('appVersion').textContent = `v${info.version}`;
    } catch {}
  }

  addCss();
  polishText();
  installIcons();
  version();
  try { window.renderActivity?.(); window.renderUsage?.(); } catch {}
})();
