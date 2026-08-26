(() => {
  const api = window.personalCode;
  if (!api || window.__chatcodeV08Loaded) return;
  window.__chatcodeV08Loaded = true;

  function mount() {
    const badge = document.querySelector('.version-badge');
    if (badge) badge.textContent = 'v0.8';

    const overview = document.getElementById('project-tab-overview');
    if (overview && !document.getElementById('v08BrainCard')) {
      overview.insertAdjacentHTML('afterbegin', `
        <article id="v08BrainCard" class="card" style="margin-bottom:18px;background:linear-gradient(135deg,#fff 0%,#f6f9ff 100%)">
          <div class="card-head"><div><span class="eyebrow">PROJECT BRAIN · V0.8</span><h3>Code Intelligence đã sẵn sàng cho ChatGPT</h3><p>Brain lập chỉ mục framework, ngôn ngữ, symbol, import graph, references và context theo tác vụ. Cache tự làm mới khi Project Index thay đổi.</p></div><span class="pill on">18 MCP tools</span></div>
          <div class="pills"><span class="pill on">project_brain</span><span class="pill on">find_symbols</span><span class="pill on">find_references</span><span class="pill on">related_files</span><span class="pill on">project_context</span></div>
        </article>`);
    }
  }

  async function refreshVersion() {
    try {
      const info = await api.appInfo();
      const badge = document.querySelector('.version-badge');
      if (badge) badge.textContent = `v${info.version}`;
      const appVersion = document.getElementById('appVersion');
      if (appVersion) appVersion.textContent = `v${info.version}`;
    } catch {}
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-project], [data-dproject], [data-project-tab="overview"]')) setTimeout(mount, 180);
  });
  mount();
  refreshVersion();
  setTimeout(mount, 500);
})();
