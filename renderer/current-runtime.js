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

  async function boot() {
    // Load early to avoid a light-theme flash, then move it to the end again after
    // compatibility modules have mounted any feature-specific stylesheets.
    ensureFoundationLast();
    for (const src of COMPATIBILITY_MODULES) await loadScript(src);
    ensureFoundationLast();

    window.__chatcodeRenderer = Object.freeze({
      entry: 'current-runtime.js',
      compatibility_modules: [...COMPATIBILITY_MODULES],
      foundation: 'ui-foundation.css'
    });
    if (window.lucide?.createIcons) window.lucide.createIcons();
    window.dispatchEvent(new CustomEvent('chatcode:renderer-ready', { detail:window.__chatcodeRenderer }));
  }

  boot();
})();
