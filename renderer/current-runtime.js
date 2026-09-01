(() => {
  if (window.__chatcodeCurrentRuntimeLoaded) return;
  window.__chatcodeCurrentRuntimeLoaded = true;

  const COMPATIBILITY_MODULES = Object.freeze([
    'v07-runtime.js',
    'v08-runtime.js',
    'v081-runtime.js',
    'v09-runtime.js',
    'v091-runtime.js',
    'v10-runtime.js',
    'v10-stage3.js',
    'v10-stage4.js',
    'v102-runtime.js'
  ]);

  const NAV_ICONS = Object.freeze({
    dashboard: 'panels-top-left',
    connection: 'plug-zap',
    activity: 'activity',
    settings: 'settings'
  });

  const ACTION_ICONS = Object.freeze({
    addProject: ['folder-plus', 'Thêm dự án'],
    dashboardAddProject: ['folder-plus', 'Thêm dự án'],
    copyMcpTop: ['copy', 'Sao chép URL MCP'],
    heroDiagnose: ['stethoscope', 'Chẩn đoán'],
    diagnose: ['stethoscope', 'Chẩn đoán'],
    restartConnection: ['refresh-cw', 'Kết nối lại'],
    saveConnect: ['check', 'Lưu & kết nối'],
    stopConnection: ['square', 'Ngắt tunnel'],
    copyMcp: ['copy', 'Sao chép URL MCP'],
    copyDiagnostic: ['clipboard-copy', 'Sao chép báo cáo'],
    clearActivity: ['trash-2', 'Xóa lịch sử'],
    hideTray: ['panel-bottom-close', 'Ẩn xuống tray'],
    reindexProject: ['refresh-cw', 'Re-index'],
    removeProject: ['trash-2', 'Gỡ dự án'],
    refreshFiles: ['refresh-cw', 'Làm mới'],
    searchButton: ['search', 'Tìm kiếm'],
    taskButton: ['play', 'Chạy'],
    gitStatusButton: ['git-branch', 'Git status'],
    gitDiffButton: ['file-diff', 'Git diff'],
    savePermissions: ['check', 'Lưu quyền']
  });

  function loadScript(src) {
    return new Promise(resolve => {
      const key = `chatcode-runtime:${src}`;
      const existing = document.querySelector(`script[data-chatcode-runtime="${key}"]`);
      if (existing) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.chatcodeRuntime = key;
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }

  function ensureFoundationLast() {
    let link = document.querySelector('link[data-chatcode-ui-foundation]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'ui-foundation.css';
      link.dataset.chatcodeUiFoundation = '1';
    }
    document.head.appendChild(link);
    return link;
  }

  function iconNode(name) {
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', name);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function mountNavigationIcons() {
    document.querySelectorAll('.nav-link[data-route]').forEach(button => {
      const iconName = NAV_ICONS[button.dataset.route];
      if (!iconName) return;
      let holder = button.querySelector(':scope > .ui-nav-icon');
      const legacy = button.querySelector(':scope > span:first-child');
      if (!holder) {
        holder = document.createElement('span');
        holder.className = 'ui-nav-icon';
        holder.appendChild(iconNode(iconName));
        if (legacy) legacy.replaceWith(holder); else button.prepend(holder);
      }
    });
  }

  function mountActionIcons() {
    for (const [id, [iconName, label]] of Object.entries(ACTION_ICONS)) {
      const button = document.getElementById(id);
      if (!button || button.dataset.uiIconized === '1') continue;
      button.dataset.uiIconized = '1';
      const text = label || button.textContent.trim();
      button.replaceChildren(iconNode(iconName), document.createTextNode(text));
    }
  }

  function syncVersionBadge() {
    const badge = document.querySelector('.brand .version-badge');
    const version = document.getElementById('appVersion')?.textContent?.trim();
    if (badge && version && /^v?\d/.test(version)) badge.textContent = version.startsWith('v') ? version : `v${version}`;
  }

  function mountStage3Chrome() {
    document.body.dataset.uiStage = '3';
    mountNavigationIcons();
    mountActionIcons();
    syncVersionBadge();
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  async function boot() {
    ensureFoundationLast();
    for (const src of COMPATIBILITY_MODULES) await loadScript(src);
    ensureFoundationLast();
    mountStage3Chrome();
    setTimeout(mountStage3Chrome, 450);

    window.__chatcodeRenderer = Object.freeze({
      entry: 'current-runtime.js',
      stage: 3,
      compatibility_modules: [...COMPATIBILITY_MODULES],
      foundation: 'ui-foundation.css',
      icon_system: 'lucide'
    });
    window.dispatchEvent(new CustomEvent('chatcode:renderer-ready', { detail:window.__chatcodeRenderer }));
  }

  boot();
})();
