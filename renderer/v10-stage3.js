(() => {
  const api = window.personalCode;
  if (!api || window.__chatcodeV10Stage3Loaded) return;
  window.__chatcodeV10Stage3Loaded = true;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let timer = null;

  function activeProjectId() { return document.querySelector('.project-item.active')?.dataset.project || ''; }

  function mount() {
    const tab = $('project-tab-permissions');
    if (!tab || $('v10WorkSessions')) return;
    const anchor = $('v10TerminalRuntime') || $('v10WorkspaceMode');
    if (!anchor) return;
    const link = document.createElement('link'); link.rel='stylesheet'; link.href='v10-stage3.css'; link.dataset.v10Stage3='1'; document.head.appendChild(link);
    anchor.insertAdjacentHTML('afterend', `
      <article id="v10WorkSessions" class="card v103-work-card">
        <div class="card-head">
          <div><span class="eyebrow">V1.0 · CHẶNG 3</span><h3>Work Sessions & Unified Patch</h3><p>Phiên làm việc kiểu Codex: baseline Git, unified diff, command history, Recovery và rollback toàn phiên.</p></div>
          <div class="v103-head-actions"><span id="v103WorkBadge" class="v10-mode-badge">0 SESSION</span><button id="v103Refresh" class="btn"><i data-lucide="refresh-cw"></i> Refresh</button></div>
        </div>
        <div class="note v103-note">ChatGPT tạo session bằng <code>start_work</code>, sửa bằng <code>apply_patch</code>, rồi <code>finish_work</code>. Bạn có thể theo dõi và rollback tại đây.</div>
        <div id="v103WorkList" class="v103-work-list"><div class="muted">Chưa có work session.</div></div>
      </article>`);
    $('v103Refresh')?.addEventListener('click', () => refresh().catch(error => alert(error.message || error)));
    $('v103WorkList')?.addEventListener('click', event => {
      const detail = event.target.closest('[data-work-detail]');
      const rollback = event.target.closest('[data-work-rollback]');
      if (detail) toggleDetail(detail.dataset.workDetail).catch(error => alert(error.message || error));
      if (rollback) rollbackSession(rollback.dataset.workRollback).catch(error => alert(error.message || error));
    });
    if (window.lucide?.createIcons) window.lucide.createIcons();
    refresh().catch(() => {});
    if (!timer) timer = setInterval(() => { if ($('v10WorkSessions')) refresh().catch(() => {}); }, 3000);
  }

  function statusLabel(status) {
    return ({ active:'ACTIVE', completed:'DONE', verification_failed:'VERIFY FAIL', rolled_back:'ROLLED BACK', rollback_partial:'ROLLBACK PARTIAL' })[status] || String(status || 'UNKNOWN').toUpperCase();
  }

  async function refresh() {
    const id = activeProjectId(); if (!id || !api.listWorkSessions || !$('v103WorkList')) return;
    const sessions = await api.listWorkSessions(id).catch(() => []);
    const active = sessions.filter(item => item.status === 'active').length;
    if ($('v103WorkBadge')) { $('v103WorkBadge').textContent = `${sessions.length} SESSION${active ? ` · ${active} ACTIVE` : ''}`; $('v103WorkBadge').classList.toggle('trusted', active > 0); }
    if (!sessions.length) { $('v103WorkList').innerHTML = '<div class="muted">Chưa có work session. Khi ChatGPT gọi start_work, phiên sẽ xuất hiện ở đây.</div>'; return; }
    $('v103WorkList').innerHTML = sessions.slice(0,10).map(session => {
      const canRollback = !['rolled_back','rollback_partial'].includes(session.status) && (session.operations?.length || 0) > 0;
      return `<div class="v103-session" data-work-session="${esc(session.work_session_id)}">
        <div class="v103-session-top"><div><span class="v103-status ${esc(session.status)}">${esc(statusLabel(session.status))}</span><strong>${esc(session.goal || 'Work session')}</strong></div><code>${esc(String(session.work_session_id).slice(0,8))}</code></div>
        <div class="v103-metrics"><span><b>${session.changed_files?.length || 0}</b> files</span><span><b>${session.commands?.length || 0}</b> commands</span><span><b>${session.recovery_points?.length || 0}</b> snapshots</span><span>${esc(session.workspace_mode || 'safe')}</span></div>
        <div class="v103-files">${(session.changed_files || []).slice(0,8).map(file => `<code>${esc(file)}</code>`).join('') || '<span class="muted">Chưa đổi file</span>'}</div>
        <div class="v103-actions"><button class="btn small" data-work-detail="${esc(session.work_session_id)}">Git diff / chi tiết</button>${canRollback ? `<button class="btn small danger" data-work-rollback="${esc(session.work_session_id)}">Rollback session</button>` : ''}</div>
        <pre class="v103-detail hidden" data-work-pre="${esc(session.work_session_id)}"></pre>
      </div>`;
    }).join('');
  }

  async function toggleDetail(id) {
    const pre = document.querySelector(`[data-work-pre="${CSS.escape(id)}"]`); if (!pre) return;
    if (!pre.classList.contains('hidden')) { pre.classList.add('hidden'); return; }
    const value = await api.workSessionStatus(id);
    const commands = (value.commands || []).map(item => `${item.status || '?'} ${item.exit_code ?? ''}  ${item.command}`).join('\n');
    const ops = (value.operations || []).map(item => `${item.operation}  ${item.path}${item.snapshot_id ? `  snapshot:${String(item.snapshot_id).slice(0,8)}` : ''}`).join('\n');
    const diff = value.current?.git?.diff || '(Git diff trống hoặc project không phải Git repo)';
    pre.textContent = `GOAL\n${value.goal || '(trống)'}\n\nOPERATIONS\n${ops || '(chưa có)'}\n\nCOMMANDS\n${commands || '(chưa có)'}\n\nGIT DIFF\n${diff}`;
    pre.classList.remove('hidden');
  }

  async function rollbackSession(id) {
    const ok = confirm('Rollback toàn bộ work session?\n\nChatCode sẽ khôi phục file theo trạng thái trước từng thay đổi của session và refresh Project Brain.');
    if (!ok) return;
    const result = await api.rollbackWorkSession(id);
    if (!result?.ok) alert(`Rollback chưa hoàn chỉnh: ${(result?.errors || []).length} lỗi. Xem chi tiết session.`);
    await refresh();
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-project], [data-dproject], [data-project-tab="permissions"]')) setTimeout(() => { mount(); refresh(); }, 180);
  });
  api.onActivityChanged?.(() => setTimeout(() => refresh().catch(() => {}), 100));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true }); else mount();
})();
