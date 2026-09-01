(() => {
  const api = window.personalCode;
  if (!api || window.__chatcodeV08Loaded) return;
  window.__chatcodeV08Loaded = true;

  // Project Brain remains available to ChatGPT through MCP, but it is intentionally
  // headless in the desktop UI. ChatCode is a bridge/workspace; VS Code remains the editor.
  function mount() {
    document.getElementById('v08BrainCard')?.remove();
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
    if (event.target.closest('[data-project], [data-dproject], [data-project-tab="overview"]')) {
      setTimeout(() => { mount(); refreshVersion(); }, 180);
    }
  });
  mount();
  refreshVersion();
  setTimeout(() => { mount(); refreshVersion(); }, 500);
})();
