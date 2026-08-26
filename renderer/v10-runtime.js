(() => {
  const api = window.personalCode;
  if (!api || window.__chatcodeV10Loaded) return;
  window.__chatcodeV10Loaded = true;
  const $ = id => document.getElementById(id);
  const ACTIONS = ['write','rename','delete','task','gitStage','gitCommit'];

  function addCss() {
    if (document.querySelector('link[data-v10]')) return;
    const link = document.createElement('link'); link.rel='stylesheet'; link.href='v10.css'; link.dataset.v10='1'; document.head.appendChild(link);
  }

  function mount() {
    addCss();
    const tab = $('project-tab-permissions');
    if (!tab || $('v10WorkspaceMode')) return;
    tab.insertAdjacentHTML('afterbegin', `
      <article id="v10WorkspaceMode" class="card v10-workspace-card">
        <div class="card-head"><div><span class="eyebrow">V1.0 · TRUSTED WORKSPACE</span><h3>Chế độ làm việc của AI</h3><p>Safe giữ approval/permission hiện tại. Trusted cho AI toàn quyền local bên trong project, không hỏi từng thao tác.</p></div><span id="v10ModeBadge" class="v10-mode-badge">SAFE</span></div>
        <div class="v10-mode-grid">
          <button id="v10SafeMode" class="v10-mode-option"><i data-lucide="shield-check"></i><div><strong>Safe</strong><span>Permission + Safety Rules + Approval Center.</span></div></button>
          <button id="v10TrustedMode" class="v10-mode-option trusted"><i data-lucide="zap"></i><div><strong>Trusted</strong><span>Read/write/manage/task/local Git không hỏi từng action.</span></div></button>
        </div>
        <div id="v10TrustedOptions" class="v10-trusted-options hidden">
          <label class="v10-secret-toggle"><input id="v10AllowSecrets" type="checkbox"><div><strong>Cho phép đọc/ghi secrets trong workspace</strong><span>.env, wp-config.php, credentials… có thể được gửi vào cuộc hội thoại ChatGPT khi AI đọc chúng.</span></div></label>
          <div class="v10-boundaries"><span><i data-lucide="folder-lock"></i>Không thoát project root</span><span><i data-lucide="git-branch"></i>Git push: OFF</span><span><i data-lucide="terminal-square"></i>Command allowlist vẫn giữ đến Chặng 2</span></div>
        </div>
        <div id="v10ModeMessage" class="note v10-mode-note">Safe mode đang dùng các quyền và Safety Rules hiện tại.</div>
      </article>`);
    if (window.lucide?.createIcons) window.lucide.createIcons();
    bind();
    setTimeout(render, 80);
  }

  function activeProjectId() {
    return document.querySelector('.project-item.active')?.dataset.project || '';
  }

  async function currentProject() {
    const id = activeProjectId(); if (!id) return null;
    const list = await api.listProjects();
    return list.find(project => project.id === id) || null;
  }

  function safeRules(project) {
    const safety = project?.safety || {};
    const saved = safety._safeSafety || project?.safeSafety || {};
    const out = {};
    for (const action of ACTIONS) out[action] = saved[action] || safety[action] || ({write:'allow',gitStage:'allow'}[action] || 'ask');
    return out;
  }

  function safePermissions(project) {
    return project?.safety?._safePermissions || project?.safePermissions || project?.permissions || { write:false, manageFiles:false, tasks:false, gitWrite:false };
  }

  function setLegacyDisabled(trusted) {
    for (const id of ['permWrite','permManage','permTasks','permGit','savePermissions','saveSafety']) if ($(id)) $(id).disabled = trusted;
    document.querySelectorAll('[data-preset]').forEach(el => el.disabled = trusted);
    for (const id of ['safeWrite','safeRename','safeDelete','safeTask','safeGitStage','safeGitCommit']) if ($(id)) $(id).disabled = trusted;
    $('project-tab-permissions')?.classList.toggle('v10-is-trusted', trusted);
  }

  async function render() {
    const project = await currentProject().catch(() => null); if (!project || !$('v10WorkspaceMode')) return;
    const trusted = project.workspaceMode === 'trusted' || project.safety?._workspaceMode === 'trusted';
    $('v10SafeMode')?.classList.toggle('active', !trusted);
    $('v10TrustedMode')?.classList.toggle('active', trusted);
    if ($('v10ModeBadge')) { $('v10ModeBadge').textContent = trusted ? 'TRUSTED' : 'SAFE'; $('v10ModeBadge').classList.toggle('trusted', trusted); }
    $('v10TrustedOptions')?.classList.toggle('hidden', !trusted);
    if ($('v10AllowSecrets')) $('v10AllowSecrets').checked = !!(project.trusted?.allowSecrets || project.safety?._allowSecrets);
    if ($('v10ModeMessage')) $('v10ModeMessage').textContent = trusted
      ? 'Trusted đang hoạt động: ChatGPT không cần approval cho write/rename/delete/task/stage/commit local. Recovery Snapshot vẫn giữ nguyên.'
      : 'Safe mode đang dùng các quyền và Safety Rules hiện tại.';
    setLegacyDisabled(trusted);
    const pills = $('permissionPills');
    if (pills) {
      pills.querySelectorAll('.v10-workspace-pill').forEach(x => x.remove());
      pills.insertAdjacentHTML('afterbegin', `<span class="pill on v10-workspace-pill ${trusted?'trusted':''}">${trusted?'Trusted':'Safe'}</span>`);
    }
  }

  async function enableTrusted() {
    const project = await currentProject(); if (!project) return;
    if (project.workspaceMode === 'trusted' || project.safety?._workspaceMode === 'trusted') return;
    const ok = confirm('Bật Trusted Workspace?\n\nChatGPT sẽ được ghi/xóa/rename, chạy task và Git local trong project mà không hỏi từng thao tác. Project boundary và Git push vẫn bị khóa.');
    if (!ok) return;
    const savedPermissions = safePermissions(project), savedSafety = safeRules(project);
    await api.updateSafety(project.id, {
      write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow',
      _workspaceMode:'trusted', _allowSecrets:false,
      _safePermissions:savedPermissions, _safeSafety:savedSafety
    });
    location.reload();
  }

  async function enableSafe() {
    const project = await currentProject(); if (!project) return;
    if (!(project.workspaceMode === 'trusted' || project.safety?._workspaceMode === 'trusted')) return;
    const permissions = safePermissions(project), rules = safeRules(project);
    await api.updateSafety(project.id, { ...rules, _workspaceMode:'safe', _allowSecrets:false, _safePermissions:permissions, _safeSafety:rules });
    await api.updateProject({ id:project.id, permissions });
    location.reload();
  }

  async function toggleSecrets(event) {
    const project = await currentProject(); if (!project) return;
    const enabled = !!event.target.checked;
    if (enabled) {
      const ok = confirm('Cho phép secrets?\n\nAI có thể đọc/ghi .env, wp-config.php và credential files trong project. Nội dung đọc được có thể xuất hiện trong cuộc hội thoại ChatGPT.');
      if (!ok) { event.target.checked=false; return; }
    }
    await api.updateSafety(project.id, { ...(project.safety || {}), _workspaceMode:'trusted', _allowSecrets:enabled });
    await render();
  }

  function bind() {
    $('v10SafeMode')?.addEventListener('click', () => enableSafe().catch(error => alert(error.message || error)));
    $('v10TrustedMode')?.addEventListener('click', () => enableTrusted().catch(error => alert(error.message || error)));
    $('v10AllowSecrets')?.addEventListener('change', event => toggleSecrets(event).catch(error => { event.target.checked=!event.target.checked; alert(error.message || error); }));
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-project], [data-dproject], [data-project-tab="permissions"]')) setTimeout(() => { mount(); render(); }, 180);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true }); else mount();
})();
