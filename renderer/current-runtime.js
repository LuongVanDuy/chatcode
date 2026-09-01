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

    /* Permissions polish: one calm hierarchy instead of stacked legacy cards. */
    #project-tab-permissions{display:flex;flex-direction:column;gap:14px}
    #project-tab-permissions>.two-col{display:grid;grid-template-columns:minmax(260px,.88fr) minmax(360px,1.12fr);gap:0;margin:0;border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);overflow:hidden;background:var(--ui-surface)}
    #project-tab-permissions>.two-col>.card{margin:0!important;padding:14px 16px!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
    #project-tab-permissions>.two-col>.card:first-child{border-right:1px solid var(--ui-border-soft)!important}
    #project-tab-permissions .preset-grid{display:flex;flex-direction:column;gap:6px}
    #project-tab-permissions .preset-grid button{min-height:48px;padding:9px 11px!important;border:1px solid var(--ui-border)!important;border-radius:var(--ui-radius-md)!important;background:var(--ui-surface-2)!important;color:var(--ui-text-2)!important;text-align:left;box-shadow:none!important}
    #project-tab-permissions .preset-grid button:hover:not(:disabled){background:var(--ui-hover)!important;color:var(--ui-text)!important}
    #project-tab-permissions .perm{min-height:52px;padding:9px 2px!important;border-bottom:1px solid var(--ui-border-soft)!important;background:transparent!important;color:var(--ui-text)!important}
    #project-tab-permissions .perm:last-of-type{border-bottom:0!important}
    #project-tab-permissions .perm strong{color:var(--ui-text)!important}.project-tab#project-tab-permissions .perm span{color:var(--ui-muted)!important}
    #project-tab-permissions input[type="checkbox"]{accent-color:var(--ui-accent);color-scheme:dark}
    #project-tab-permissions input[type="checkbox"]:disabled{opacity:.42}

    #v10WorkspaceMode{margin:0!important;padding:0 0 15px!important;border:0!important;border-bottom:1px solid var(--ui-border-soft)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
    #v10WorkspaceMode .card-head{margin-bottom:10px}.v10-mode-badge{padding:5px 8px!important;border:1px solid var(--ui-border)!important;background:var(--ui-surface-2)!important;color:var(--ui-muted)!important}.v10-mode-badge.trusted{background:rgba(120,189,142,.08)!important;border-color:rgba(120,189,142,.24)!important;color:var(--ui-success)!important}
    .v10-mode-grid{gap:8px!important;margin:0!important}.v10-mode-option{min-height:70px!important;padding:12px!important;border:1px solid var(--ui-border)!important;border-radius:var(--ui-radius-md)!important;background:var(--ui-surface-2)!important;color:var(--ui-text)!important;box-shadow:none!important}.v10-mode-option:hover{background:var(--ui-hover)!important;border-color:rgba(255,255,255,.14)!important}.v10-mode-option.active{border-color:rgba(154,174,255,.48)!important;background:var(--ui-active)!important;box-shadow:none!important}.v10-mode-option.trusted.active{border-color:rgba(154,174,255,.55)!important;background:var(--ui-accent-bg)!important;box-shadow:none!important}.v10-mode-option strong{color:var(--ui-text)!important;font-size:13px!important;margin-bottom:2px!important}.v10-mode-option span{color:var(--ui-muted)!important;font-size:11.5px!important}.v10-mode-option svg{width:17px!important;height:17px!important;color:var(--ui-text-2)}
    .v10-trusted-options{gap:9px!important;margin-top:10px!important}.v10-secret-toggle{padding:10px 11px!important;border:1px solid var(--ui-border)!important;border-radius:var(--ui-radius-md)!important;background:var(--ui-surface-2)!important;color:var(--ui-text)!important}.v10-secret-toggle strong{color:var(--ui-text)!important;font-size:12px!important}.v10-secret-toggle span{color:var(--ui-muted)!important;font-size:11px!important}.v10-boundaries{gap:6px!important}.v10-boundaries span{padding:5px 8px!important;border:1px solid var(--ui-border)!important;border-radius:999px!important;background:transparent!important;color:var(--ui-muted)!important;font-size:10.5px!important}.v10-mode-note{margin-top:10px!important;padding:9px 0 0!important;border:0!important;border-top:1px solid var(--ui-border-soft)!important;border-radius:0!important;background:transparent!important;color:var(--ui-muted)!important}

    #v07SafetyRules{margin:0!important;padding:15px 0 0!important;border:0!important;border-top:1px solid var(--ui-border-soft)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
    #v07SafetyRules .card-head{margin-bottom:10px}.safety-rules-card .safety-rule-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:0!important;border:1px solid var(--ui-border)!important;border-radius:var(--ui-radius-lg)!important;overflow:hidden;background:var(--ui-surface)!important}.safety-rules-card .safety-rule-grid label{min-width:0;padding:10px 12px!important;border:0!important;border-right:1px solid var(--ui-border-soft)!important;border-bottom:1px solid var(--ui-border-soft)!important;border-radius:0!important;background:transparent!important;color:var(--ui-text)!important;box-shadow:none!important}.safety-rules-card .safety-rule-grid label:nth-child(3n){border-right:0!important}.safety-rules-card .safety-rule-grid label:nth-last-child(-n+3){border-bottom:0!important}.safety-rules-card .safety-rule-grid span{color:var(--ui-text-2)!important;font-size:11px!important;font-weight:600!important}.safety-rules-card .safety-rule-grid select{margin-top:6px!important;min-height:30px!important;padding:5px 8px!important;background:var(--ui-surface-2)!important;color:var(--ui-text)!important;border-color:var(--ui-border)!important}

    .ui-permission-advanced{margin:0;border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);background:var(--ui-surface);overflow:hidden}.ui-permission-advanced>summary{list-style:none;min-height:44px;padding:11px 14px;display:flex;align-items:center;gap:9px;color:var(--ui-text-2);font-size:12px;font-weight:600;cursor:pointer;user-select:none}.ui-permission-advanced>summary::-webkit-details-marker{display:none}.ui-permission-advanced>summary:before{content:'›';width:16px;color:var(--ui-muted);font-size:18px;line-height:1;transition:transform .14s ease}.ui-permission-advanced[open]>summary:before{transform:rotate(90deg)}.ui-permission-advanced>summary:hover{background:var(--ui-hover);color:var(--ui-text)}.ui-permission-advanced-body{padding:0 14px 14px}.ui-permission-advanced-body>.card{margin:0!important;padding:14px 0!important;border:0!important;border-top:1px solid var(--ui-border-soft)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}.ui-permission-advanced-body>.card:first-child{border-top:1px solid var(--ui-border-soft)!important}.ui-permission-advanced .v10-terminal-form input{background:var(--ui-surface-2)!important}.ui-permission-advanced .v10-job{border-color:var(--ui-border)!important;background:var(--ui-surface-2)!important}.ui-permission-advanced .v10-job-main code,.ui-permission-advanced .v10-job-meta{color:var(--ui-text-2)!important}

    /* Real switches: a single compact control, no bright legacy checkbox chrome. */
    #route-settings .setting input[type="checkbox"]{position:relative!important;appearance:none!important;-webkit-appearance:none!important;width:34px!important;height:18px!important;min-height:18px!important;flex:0 0 34px!important;padding:0!important;margin:0!important;border:1px solid rgba(255,255,255,.14)!important;border-radius:999px!important;background:var(--ui-surface-3)!important;background-image:none!important;box-shadow:none!important;cursor:pointer;transition:background .14s ease,border-color .14s ease}
    #route-settings .setting input[type="checkbox"]::after{content:'';position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#d7d9de;box-shadow:0 1px 2px rgba(0,0,0,.28);transition:transform .14s ease,background .14s ease}
    #route-settings .setting input[type="checkbox"]:checked{background:#6478df!important;border-color:#7889e7!important;background-image:none!important}
    #route-settings .setting input[type="checkbox"]:checked::after{transform:translateX(16px);background:#fff}
    #route-settings .setting input[type="checkbox"]:hover{border-color:rgba(255,255,255,.22)!important}.setting input[type="checkbox"]:disabled{opacity:.42!important;cursor:not-allowed!important}

    /* Neutral log language shared by Activity, Terminal, Work Session, Git/Task and Support. */
    .activity-list,.support-events{background:#18191b!important;border:1px solid var(--ui-border)!important;border-radius:var(--ui-radius-md)!important;color:var(--ui-text-2)!important;box-shadow:none!important;overflow:auto}.activity-log-head{background:var(--ui-surface-2)!important;color:var(--ui-muted)!important;border-bottom:1px solid var(--ui-border)!important}.activity-log-line{background:transparent!important;border-bottom:1px solid var(--ui-border-soft)!important;color:var(--ui-text-2)!important}.activity-log-line:hover{background:var(--ui-hover)!important}.activity-log-time,.activity-log-duration{color:var(--ui-faint)!important}.activity-log-tool{color:var(--ui-accent-strong)!important;font-weight:600!important}.activity-log-project{color:var(--ui-text-2)!important}.activity-log-target{color:#d4d6da!important}.activity-log-line.ok .activity-log-status{color:var(--ui-success)!important}.activity-log-line.failed .activity-log-status{color:var(--ui-danger)!important}.activity-log-error{color:#f0a6a6!important;background:rgba(220,125,125,.075)!important;border-left:2px solid var(--ui-danger)!important}
    #route-activity .activity-list{border:1px solid var(--ui-border)!important;border-radius:var(--ui-radius-md)!important}
    .code,.v10-job-output,.v103-detail{background:#17181a!important;color:#d5d7dc!important;border:1px solid var(--ui-border)!important;border-radius:var(--ui-radius-md)!important;box-shadow:none!important}.v10-job-output{padding:10px 11px!important}.v103-detail{padding:11px!important}.support-note{background:var(--ui-surface-2)!important;color:var(--ui-text)!important;border:1px solid var(--ui-border)!important;border-radius:var(--ui-radius-md)!important;box-shadow:none!important}.support-note:focus{background:var(--ui-surface-2)!important;border-color:rgba(154,174,255,.5)!important;box-shadow:0 0 0 2px rgba(154,174,255,.10)!important}.support-events{background:#18191b!important}.support-event{border-bottom:1px solid var(--ui-border-soft)!important}.support-event:hover{background:var(--ui-hover)!important}.support-event>span,.support-event small{color:var(--ui-muted)!important}.support-event code{color:var(--ui-text-2)!important}.support-event.marker{background:rgba(154,174,255,.07)!important;box-shadow:inset 2px 0 0 var(--ui-accent)!important}.support-event.risk{box-shadow:inset 2px 0 0 var(--ui-warning)!important}
    .v103-session{background:var(--ui-surface-2)!important;border-color:var(--ui-border)!important}.v103-session-top>code,.v103-metrics span{color:var(--ui-muted)!important}.v103-metrics span,.v103-files code{background:transparent!important;border-color:var(--ui-border)!important;color:var(--ui-text-2)!important}.v103-metrics b{color:var(--ui-text)!important}

    @media(max-width:900px){#route-connection>.page>.two-col{grid-template-columns:1fr!important}#route-connection>.page>.two-col>.card:first-child{border-right:0!important;border-bottom:1px solid var(--ui-border-soft)!important}.settings-safety-panel .safety-summary-grid{grid-template-columns:repeat(2,1fr)}#project-tab-permissions>.two-col{grid-template-columns:1fr}#project-tab-permissions>.two-col>.card:first-child{border-right:0!important;border-bottom:1px solid var(--ui-border-soft)!important}.safety-rules-card .safety-rule-grid{grid-template-columns:1fr!important}.safety-rules-card .safety-rule-grid label{border-right:0!important;border-bottom:1px solid var(--ui-border-soft)!important}.safety-rules-card .safety-rule-grid label:last-child{border-bottom:0!important}}
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

  function groupAdvancedPermissionTools() {
    const tab = document.getElementById('project-tab-permissions');
    if (!tab) return;
    let details = document.getElementById('uiPermissionAdvanced');
    if (!details) {
      details = document.createElement('details');
      details.id = 'uiPermissionAdvanced';
      details.className = 'ui-permission-advanced';
      const summary = document.createElement('summary');
      summary.textContent = 'Công cụ nâng cao';
      const body = document.createElement('div');
      body.className = 'ui-permission-advanced-body';
      details.append(summary, body);
      const safety = document.getElementById('v07SafetyRules');
      tab.insertBefore(details, safety || null);
    }
    const body = details.querySelector('.ui-permission-advanced-body');
    for (const id of ['v10TerminalRuntime', 'v10WorkSessions', 'v10FastAgentPath']) {
      const card = document.getElementById(id);
      if (card && card.parentElement !== body) body.appendChild(card);
    }
  }

  function cleanupLegacyWorkspaceUi() {
    document.getElementById('v08BrainCard')?.remove();
    groupAdvancedPermissionTools();
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
      revision: 'permissions-log-polish',
      compatibility_modules: [...COMPATIBILITY_MODULES],
      foundation: 'ui-foundation.css',
      icon_system: 'lucide'
    });
    window.dispatchEvent(new CustomEvent('chatcode:renderer-ready', { detail:window.__chatcodeRenderer }));
  }

  boot();
})();
