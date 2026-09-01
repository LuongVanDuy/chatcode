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

  const CLEANUP_CSS = `
    /* 1.0.11 cleanup: ChatCode is a bridge/workspace, not a second code editor. */
    #route-dashboard .two-col{grid-template-columns:1fr!important}
    #route-dashboard .two-col>article:has(#dashboardActivity),
    #route-dashboard article:has(#dashboardProjects){display:none!important}

    #route-activity>.page>.card{padding:0!important;border:0!important;background:transparent!important;border-radius:0!important}
    #route-activity .activity-list{border-top:1px solid var(--ui-border-soft);border-bottom:1px solid var(--ui-border-soft)}
    #route-activity .activity-row{padding-left:4px;padding-right:4px}

    #route-connection .connection-banner{padding:4px 0 16px!important;border:0!important;border-bottom:1px solid var(--ui-border-soft)!important;border-radius:0!important;background:transparent!important}
    #route-connection>.page>.two-col{gap:0;border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);overflow:hidden;background:var(--ui-surface)}
    #route-connection>.page>.two-col>.card{border:0!important;border-radius:0!important;background:transparent!important}
    #route-connection>.page>.two-col>.card:first-child{border-right:1px solid var(--ui-border-soft)!important}
    #route-connection>.page>article.card:not(.connection-banner){padding:14px 0!important;border:0!important;border-top:1px solid var(--ui-border-soft)!important;border-radius:0!important;background:transparent!important}
    #route-connection .watch-grid>div{background:transparent!important;border-color:var(--ui-border-soft)!important}

    #project-tab-overview .two-col{grid-template-columns:1fr!important}
    #project-tab-overview .two-col>article:has(#indexDetails){display:none!important}
    [data-project-tab="files"],[data-project-tab="search"],#project-tab-files,#project-tab-search{display:none!important}
    #v08BrainCard{display:none!important}

    /* Stable switch drawing without pseudo-elements on replaced input controls. */
    #route-settings .setting input[type="checkbox"]{appearance:none!important;-webkit-appearance:none!important;width:38px!important;height:22px!important;min-height:22px!important;flex:0 0 38px!important;padding:0!important;margin:0!important;border:1px solid var(--ui-border)!important;border-radius:999px!important;background-color:var(--ui-surface-3)!important;background-image:radial-gradient(circle at 9px 50%,#f4f4f5 0 6px,transparent 6.5px)!important;background-repeat:no-repeat!important;box-shadow:none!important;cursor:pointer;transition:background-color .15s ease,background-image .15s ease}
    #route-settings .setting input[type="checkbox"]:checked{background-color:#697eea!important;border-color:#7f91f2!important;background-image:radial-gradient(circle at 28px 50%,#fff 0 6px,transparent 6.5px)!important}
    #route-settings .setting input[type="checkbox"]:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}

    .settings-safety-launch{display:flex;align-items:center;gap:14px;padding:14px 2px;border-top:1px solid var(--ui-border-soft);border-bottom:1px solid var(--ui-border-soft)}
    .settings-safety-launch>div{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}.settings-safety-launch strong{font-size:13px;font-weight:600}.settings-safety-launch span{color:var(--ui-muted);font-size:11.5px}
    .settings-safety-panel{display:flex;flex-direction:column;gap:16px;padding:4px 0 10px}.settings-safety-panel.hidden{display:none!important}
    .settings-safety-panel>.page-head{align-items:center;padding-top:4px}.settings-safety-panel>.page-head .eyebrow{display:none}.settings-safety-panel>.page-head h2{font-size:17px}.settings-safety-panel>.page-head p{font-size:11.5px}
    .settings-safety-panel .safety-summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);overflow:hidden;background:var(--ui-surface)}
    .settings-safety-panel .safety-summary{min-width:0;padding:12px 14px!important;border:0!important;border-right:1px solid var(--ui-border-soft)!important;border-radius:0!important;background:var(--ui-surface)!important;color:var(--ui-text)!important;box-shadow:none!important}
    .settings-safety-panel .safety-summary:last-child{border-right:0!important}.settings-safety-panel .safety-summary span,.settings-safety-panel .safety-summary small{color:var(--ui-muted)!important}.settings-safety-panel .safety-summary strong{color:var(--ui-text)!important}
    .settings-safety-panel .card,.settings-safety-panel .approval-item,.settings-safety-panel .backup-item,.settings-safety-panel .safety-rule-grid label{background:var(--ui-surface)!important;border-color:var(--ui-border)!important;color:var(--ui-text)!important;box-shadow:none!important}
    .settings-safety-panel .approval-item p,.settings-safety-panel .backup-item p,.settings-safety-panel .approval-item small,.settings-safety-panel .backup-item small,.settings-safety-panel .safety-rule-grid span{color:var(--ui-muted)!important}
    .settings-safety-panel .approval-list,.settings-safety-panel .backup-list{color:var(--ui-text)!important}

    @media(max-width:900px){#route-connection>.page>.two-col{grid-template-columns:1fr!important}#route-connection>.page>.two-col>.card:first-child{border-right:0!important;border-bottom:1px solid var(--ui-border-soft)!important}.settings-safety-panel .safety-summary-grid{grid-template-columns:repeat(2,1fr)}}
  `;

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

  function ensureCleanupStyles() {
    let style = document.getElementById('chatcode-ui-cleanup-1011');
    if (!style) {
      style = document.createElement('style');
      style.id = 'chatcode-ui-cleanup-1011';
      style.textContent = CLEANUP_CSS;
    }
    document.head.appendChild(style);
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

  function moveSafetyIntoSettings() {
    document.getElementById('v07SafetyNav')?.remove();
    document.getElementById('healthSafety')?.closest('.health-card')?.remove();
    document.querySelector('.health-grid')?.classList.remove('five');
    document.querySelectorAll('[data-v07-route="safety"]').forEach(el => el.remove());

    const settingsPage = document.querySelector('#route-settings .page');
    const route = document.getElementById('route-safety');
    if (!settingsPage || !route || document.getElementById('settingsSafetyPanel')) return;
    const source = route.querySelector(':scope > .page') || route;
    const about = settingsPage.querySelector('.about');

    const launch = document.createElement('article');
    launch.id = 'settingsSafetyLaunch';
    launch.className = 'settings-safety-launch';
    launch.innerHTML = '<div><strong>Kiểm soát AI & Safety</strong><span>Phê duyệt thao tác nhạy cảm, recovery snapshot và backup cấu hình.</span></div><button id="toggleSafetySettings" class="btn"><i data-lucide="shield-check" aria-hidden="true"></i><span>Mở</span></button>';

    const panel = document.createElement('section');
    panel.id = 'settingsSafetyPanel';
    panel.className = 'settings-safety-panel hidden';
    while (source.firstChild) panel.appendChild(source.firstChild);

    settingsPage.insertBefore(launch, about || null);
    settingsPage.insertBefore(panel, about || null);
    route.remove();

    const toggle = document.getElementById('toggleSafetySettings');
    toggle?.addEventListener('click', () => {
      const opening = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !opening);
      const label = toggle.querySelector('span');
      if (label) label.textContent = opening ? 'Thu gọn' : 'Mở';
      if (opening) document.getElementById('refreshSafety')?.click();
    });
  }

  function cleanupLegacyWorkspaceUi() {
    document.getElementById('v08BrainCard')?.remove();
  }

  function mountStage3Chrome() {
    document.body.dataset.uiStage = '3';
    ensureCleanupStyles();
    moveSafetyIntoSettings();
    cleanupLegacyWorkspaceUi();
    mountNavigationIcons();
    mountActionIcons();
    syncVersionBadge();
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  async function boot() {
    ensureFoundationLast();
    for (const src of COMPATIBILITY_MODULES) await loadScript(src);
    ensureFoundationLast();
    ensureCleanupStyles();
    mountStage3Chrome();
    setTimeout(mountStage3Chrome, 450);
    setTimeout(mountStage3Chrome, 900);

    window.__chatcodeRenderer = Object.freeze({
      entry: 'current-runtime.js',
      stage: 3,
      revision: '1.0.11-cleanup',
      compatibility_modules: [...COMPATIBILITY_MODULES],
      foundation: 'ui-foundation.css',
      icon_system: 'lucide'
    });
    window.dispatchEvent(new CustomEvent('chatcode:renderer-ready', { detail:window.__chatcodeRenderer }));
  }

  boot();
})();
