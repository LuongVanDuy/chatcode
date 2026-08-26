(() => {
  if (window.__chatcodeV10Stage4Loaded) return;
  window.__chatcodeV10Stage4Loaded = true;
  const $ = id => document.getElementById(id);

  function mount() {
    const tab = $('project-tab-permissions');
    if (!tab || $('v10FastAgentPath')) return;
    const anchor = $('v10WorkSessions') || $('v10TerminalRuntime') || $('v10WorkspaceMode');
    if (!anchor) return;
    const link = document.createElement('link'); link.rel='stylesheet'; link.href='v10-stage4.css'; link.dataset.v10Stage4='1'; document.head.appendChild(link);
    anchor.insertAdjacentHTML('afterend', `
      <article id="v10FastAgentPath" class="card v104-agent-card">
        <div class="card-head">
          <div><span class="eyebrow">V1.0 · CHẶNG 4</span><h3>Fast Agent Path</h3><p>Đường mặc định 2 MCP calls cho task coding thường, dùng Project Brain + Work Session + Unified Patch + Trusted Terminal.</p></div>
          <span class="v10-mode-badge trusted">READY · 31 TOOLS</span>
        </div>
        <div class="v104-flow">
          <div><b>1</b><code>prepare_task(project, request)</code><span>Context + file contents + Git baseline + verification hints + task_id.</span></div>
          <i data-lucide="arrow-right"></i>
          <div><b>2</b><code>complete_task(task_id, patch, verify)</code><span>Patch transaction → verify → Brain/Git refresh → finish.</span></div>
        </div>
        <div class="v104-pills"><span>2-call normal path</span><span>same-session repair loop</span><span>rollback_work compatible</span><span>Git push OFF</span></div>
        <div class="note v104-note">Nếu verification fail, task giữ <code>active</code> và trả <code>needs_fix</code>; ChatGPT sửa tiếp bằng cùng <code>task_id</code> thay vì inspect/start lại từ đầu.</div>
      </article>`);
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-project], [data-dproject], [data-project-tab="permissions"]')) setTimeout(mount, 180);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true }); else mount();
})();
