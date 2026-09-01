(() => {
  const api = window.personalCode;
  if (!api || window.__chatcodeV10Loaded) return;
  window.__chatcodeV10Loaded = true;
  const $ = id => document.getElementById(id);
  const ACTIONS = ['write','rename','delete','task','gitStage','gitCommit'];
  let terminalRefreshTimer = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const duration = ms => ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms/1000).toFixed(1)} s` : `${(ms/60000).toFixed(1)} min`;

  function addCss() {
    if (document.querySelector('link[data-v10]')) return;
    const link = document.createElement('link'); link.rel='stylesheet'; link.href='v10.css'; link.dataset.v10='1'; document.head.appendChild(link);
  }

  function mount() {
    addCss();
    const tab = $('project-tab-permissions');
    if (!tab) return;
    if (!$('v10WorkspaceMode')) {
      tab.insertAdjacentHTML('afterbegin', `
        <article id="v10WorkspaceMode" class="card v10-workspace-card">
          <div class="card-head"><div><span class="eyebrow">V1.0 · TRUSTED WORKSPACE</span><h3>Chế độ làm việc của AI</h3><p>Safe giữ approval/permission hiện tại. Trusted cho AI toàn quyền local bên trong project, không hỏi từng thao tác.</p></div><span id="v10ModeBadge" class="v10-mode-badge">SAFE</span></div>
          <div class="v10-mode-grid">
            <button id="v10SafeMode" class="v10-mode-option"><i data-lucide="shield-check"></i><div><strong>Safe</strong><span>Permission + Safety Rules + Approval Center.</span></div></button>
            <button id="v10TrustedMode" class="v10-mode-option trusted"><i data-lucide="zap"></i><div><strong>Trusted</strong><span>Read/write/manage/task/local Git không hỏi từng action.</span></div></button>
          </div>
          <div id="v10TrustedOptions" class="v10-trusted-options hidden">
            <label class="v10-secret-toggle"><input id="v10AllowSecrets" type="checkbox"><div><strong>Cho phép đọc/ghi secrets trong workspace</strong><span>.env, wp-config.php, credentials… có thể được gửi vào cuộc hội thoại ChatGPT khi AI đọc chúng.</span></div></label>
            <div class="v10-boundaries"><span><i data-lucide="folder-lock"></i>File tools không thoát project root</span><span><i data-lucide="git-branch"></i>Git push: OFF</span><span><i data-lucide="terminal-square"></i>Generic terminal: ON</span></div>
          </div>
          <div id="v10ModeMessage" class="note v10-mode-note">Safe mode đang dùng các quyền và Safety Rules hiện tại.</div>
        </article>`);
    }
    if (!$('v10TerminalRuntime')) {
      $('v10WorkspaceMode')?.insertAdjacentHTML('afterend', `
        <article id="v10TerminalRuntime" class="card v10-terminal-card">
          <div class="card-head"><div><span class="eyebrow">V1.0 · CHẶNG 2</span><h3>Terminal Runtime</h3><p>Shell thật cho Trusted Workspace, chạy ẩn trên Windows và giữ stdout/stderr trong ChatCode.</p></div><span id="v10TerminalBadge" class="v10-mode-badge">SAFE</span></div>
          <div class="v10-terminal-form">
            <input id="v10TerminalCommand" class="input" placeholder="npm run dev hoặc npm test && npm run build">
            <input id="v10TerminalCwd" class="input v10-cwd" value="." title="Thư mục làm việc tương đối trong project">
            <label class="v10-bg"><input id="v10TerminalBackground" type="checkbox" checked> chạy nền</label>
            <button id="v10TerminalRun" class="btn primary"><i data-lucide="play"></i> Run</button>
            <button id="v10TerminalRefresh" class="btn"><i data-lucide="refresh-cw"></i> Refresh</button>
          </div>
          <div id="v10TerminalNotice" class="note v10-terminal-note">Generic terminal chỉ bật ở Trusted Workspace.</div>
          <div id="v10TerminalJobs" class="v10-terminal-jobs"><div class="muted">Chưa có terminal job.</div></div>
        </article>`);
    }
    if (window.lucide?.createIcons) window.lucide.createIcons();
    bind();
    setTimeout(() => { render(); refreshTerminalJobs(); }, 80);
    if (!terminalRefreshTimer) terminalRefreshTimer = setInterval(() => {
      if ($('v10TerminalRuntime') && !$('v10TerminalRuntime').classList.contains('v10-terminal-disabled')) refreshTerminalJobs().catch(() => {});
    }, 2500);
  }

  function activeProjectId() { return document.querySelector('.project-item.active')?.dataset.project || ''; }

  async function currentProject() {
    const id = activeProjectId(); if (!id) return null;
    const list = await api.listProjects();
    return list.find(project => project.id === id) || null;
  }

  function safeRules(project) {
    const safety = project?.safety || {}, saved = safety._safeSafety || project?.safeSafety || {}, out = {};
    for (const action of ACTIONS) out[action] = saved[action] || safety[action] || ({write:'allow',gitStage:'allow'}[action] || 'ask');
    return out;
  }

  function safePermissions(project) { return project?.safety?._safePermissions || project?.safePermissions || project?.permissions || { write:false, manageFiles:false, tasks:false, gitWrite:false }; }

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

    $('v10TerminalRuntime')?.classList.toggle('v10-terminal-disabled', !trusted);
    if ($('v10TerminalRun')) $('v10TerminalRun').disabled = !trusted;
    if ($('v10TerminalCommand')) $('v10TerminalCommand').disabled = !trusted;
    if ($('v10TerminalCwd')) $('v10TerminalCwd').disabled = !trusted;
    if ($('v10TerminalBackground')) $('v10TerminalBackground').disabled = !trusted;
    if ($('v10TerminalBadge')) { $('v10TerminalBadge').textContent = trusted ? 'READY' : 'SAFE'; $('v10TerminalBadge').classList.toggle('trusted', trusted); }
    if ($('v10TerminalNotice')) $('v10TerminalNotice').textContent = trusted
      ? 'Terminal dùng cwd bên trong project và chạy ẩn. Lưu ý: đây không phải OS sandbox; process vẫn có quyền filesystem của tài khoản Windows. Git push/reset --hard vẫn bị khóa.'
      : 'Generic terminal chỉ bật ở Trusted Workspace. Safe vẫn dùng run_task với command allowlist.';

    const pills = $('permissionPills');
    if (pills) {
      pills.querySelectorAll('.v10-workspace-pill').forEach(x => x.remove());
      pills.insertAdjacentHTML('afterbegin', `<span class="pill on v10-workspace-pill ${trusted?'trusted':''}">${trusted?'Trusted':'Safe'}</span>`);
    }
  }

  async function refreshTerminalJobs() {
    const id = activeProjectId(); if (!id || !api.terminalJobs || !$('v10TerminalJobs')) return;
    const jobs = await api.terminalJobs(id).catch(() => []);
    if (!jobs.length) { $('v10TerminalJobs').innerHTML = '<div class="muted">Chưa có terminal job.</div>'; return; }
    $('v10TerminalJobs').innerHTML = jobs.map(job => {
      const active = ['running','stopping'].includes(job.status);
      return `<div class="v10-job" data-terminal-job="${esc(job.job_id)}">
        <div class="v10-job-main"><span class="v10-job-status ${esc(job.status)}">${esc(job.status)}</span><code>${esc(job.command)}</code></div>
        <div class="v10-job-meta"><span>cwd ${esc(job.cwd)}</span><span>PID ${esc(job.pid || '—')}</span><span>${esc(duration(job.duration_ms || 0))}</span>${job.background?'<span>background</span>':''}</div>
        <div class="v10-job-actions"><button class="btn small" data-terminal-output="${esc(job.job_id)}">Output</button>${active?`<button class="btn small danger" data-terminal-stop="${esc(job.job_id)}">Stop</button>`:''}</div>
        <pre class="v10-job-output hidden" data-terminal-pre="${esc(job.job_id)}"></pre>
      </div>`;
    }).join('');
  }

  async function showTerminalOutput(jobId) {
    const pre = document.querySelector(`[data-terminal-pre="${CSS.escape(jobId)}"]`); if (!pre) return;
    if (!pre.classList.contains('hidden')) { pre.classList.add('hidden'); return; }
    const job = await api.terminalJobStatus(jobId, { stdout_offset:0, stderr_offset:0 });
    const text = `${job.stdout || ''}${job.stderr ? `${job.stdout ? '\n' : ''}[stderr]\n${job.stderr}` : ''}` || '(chưa có output)';
    pre.textContent = text; pre.classList.remove('hidden');
  }

  async function runTerminal() {
    const project = await currentProject(); if (!project) return;
    const trusted = project.workspaceMode === 'trusted' || project.safety?._workspaceMode === 'trusted';
    if (!trusted) throw new Error('Hãy bật Trusted Workspace trước khi dùng generic terminal.');
    const command = String($('v10TerminalCommand')?.value || '').trim(); if (!command) return;
    const cwd = String($('v10TerminalCwd')?.value || '.').trim() || '.';
    const background = !!$('v10TerminalBackground')?.checked;
    $('v10TerminalRun').disabled = true;
    try { await api.execTerminal(project.id, command, { cwd, background }); await refreshTerminalJobs(); }
    finally { $('v10TerminalRun').disabled = false; }
  }

  async function enableTrusted() {
    const project = await currentProject(); if (!project) return;
    if (project.workspaceMode === 'trusted' || project.safety?._workspaceMode === 'trusted') return;
    const ok = confirm('Bật Trusted Workspace?\n\nChatGPT sẽ được ghi/xóa/rename, chạy terminal/task và Git local trong project mà không hỏi từng thao tác. File-tool project boundary và Git push vẫn bị khóa.');
    if (!ok) return;
    const savedPermissions = safePermissions(project), savedSafety = safeRules(project);
    await api.updateSafety(project.id, { write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow', _workspaceMode:'trusted', _allowSecrets:false, _safePermissions:savedPermissions, _safeSafety:savedSafety });
    await render();
    await refreshTerminalJobs();
  }

  async function enableSafe() {
    const project = await currentProject(); if (!project) return;
    if (!(project.workspaceMode === 'trusted' || project.safety?._workspaceMode === 'trusted')) return;
    const permissions = safePermissions(project), rules = safeRules(project);
    await api.updateSafety(project.id, { ...rules, _workspaceMode:'safe', _allowSecrets:false, _safePermissions:permissions, _safeSafety:rules });
    await api.updateProject({ id:project.id, permissions });
    await render();
    await refreshTerminalJobs();
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
    if ($('v10WorkspaceMode')?.dataset.bound === '1') return;
    $('v10WorkspaceMode').dataset.bound = '1';
    $('v10SafeMode')?.addEventListener('click', () => enableSafe().catch(error => alert(error.message || error)));
    $('v10TrustedMode')?.addEventListener('click', () => enableTrusted().catch(error => alert(error.message || error)));
    $('v10AllowSecrets')?.addEventListener('change', event => toggleSecrets(event).catch(error => { event.target.checked=!event.target.checked; alert(error.message || error); }));
    $('v10TerminalRun')?.addEventListener('click', () => runTerminal().catch(error => alert(error.message || error)));
    $('v10TerminalRefresh')?.addEventListener('click', () => refreshTerminalJobs().catch(error => alert(error.message || error)));
    $('v10TerminalCommand')?.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) runTerminal().catch(error => alert(error.message || error)); });
    $('v10TerminalJobs')?.addEventListener('click', event => {
      const output = event.target.closest('[data-terminal-output]');
      const stop = event.target.closest('[data-terminal-stop]');
      if (output) showTerminalOutput(output.dataset.terminalOutput).catch(error => alert(error.message || error));
      if (stop) api.stopTerminalJob(stop.dataset.terminalStop).then(refreshTerminalJobs).catch(error => alert(error.message || error));
    });
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-project], [data-dproject], [data-project-tab="permissions"]')) setTimeout(() => { mount(); render(); refreshTerminalJobs(); }, 180);
  });
  api.onTerminalChanged?.(job => { if (!job?.project_id || job.project_id === activeProjectId()) setTimeout(() => refreshTerminalJobs().catch(() => {}), 80); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true }); else mount();
})();
