(() => {
  if (window.__chatcodeBrowserWorkspaceLoaded) return;
  window.__chatcodeBrowserWorkspaceLoaded = true;

  const api = window.personalCode;
  if (!api?.browserWorkspace || !api?.browserCommand) return;

  let state = { tabs:[], active_tab_id:null, visible:false, max_tabs:10 };
  let initialized = false;
  let route = null;
  let viewport = null;
  let resizeObserver = null;

  function icon(name) {
    const node = document.createElement('i');
    node.setAttribute('data-lucide', name);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function refreshIcons() {
    try { window.lucide?.createIcons?.(); } catch {}
  }

  function ensureStyles() {
    if (document.getElementById('browserWorkspaceStyles')) return;
    const style = document.createElement('style');
    style.id = 'browserWorkspaceStyles';
    style.textContent = `
      body.browser-workspace-active .topbar{display:none!important}
      body.browser-workspace-active .content{padding:0!important;overflow:hidden!important}
      #route-browser.browser-route{height:100vh;min-height:0;margin:0;overflow:hidden}
      #route-browser.browser-route.active{display:block}
      .browser-workspace{height:100%;min-height:0;display:flex;flex-direction:column;border:0;border-radius:0;overflow:hidden;background:var(--ui-surface)}
      .browser-tabbar{height:38px;min-height:38px;display:flex;align-items:flex-end;gap:3px;padding:5px 7px 0;background:#1f2022;border-bottom:1px solid var(--ui-border-soft)}
      .browser-tabs{flex:1;min-width:0;display:flex;align-items:flex-end;gap:3px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}.browser-tabs::-webkit-scrollbar{display:none}
      .browser-tab{min-width:112px;max-width:210px;height:31px;padding:0 7px 0 10px;border:1px solid transparent;border-bottom:0;border-radius:7px 7px 0 0;background:transparent;color:var(--ui-muted);display:flex;align-items:center;gap:7px;cursor:pointer}
      .browser-tab:hover{background:var(--ui-hover);color:var(--ui-text-2)}.browser-tab.active{background:var(--ui-surface-2);border-color:var(--ui-border);color:var(--ui-text)}
      .browser-tab-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;font-size:11.5px;font-weight:500}
      .browser-tab-loading{width:6px;height:6px;flex:none;border-radius:50%;background:var(--ui-accent);opacity:.8}.browser-tab:not(.loading) .browser-tab-loading{background:#666a71;opacity:.55}
      .browser-tab-close{width:20px;height:20px;min-width:20px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--ui-muted);display:grid;place-items:center;cursor:pointer;font-size:15px;line-height:1}.browser-tab-close:hover{background:rgba(255,255,255,.08);color:var(--ui-text)}
      .browser-new-tab{width:30px;height:30px;min-width:30px;margin-bottom:1px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ui-muted);display:grid;place-items:center;cursor:pointer}.browser-new-tab:hover{background:var(--ui-hover);color:var(--ui-text)}.browser-new-tab svg{width:14px;height:14px}
      .browser-toolbar{height:44px;min-height:44px;padding:6px 8px;display:flex;align-items:center;gap:6px;background:var(--ui-surface-2);border-bottom:1px solid var(--ui-border-soft)}
      .browser-tool{width:30px;height:30px;min-width:30px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ui-text-2);display:grid;place-items:center;cursor:pointer}.browser-tool:hover:not(:disabled){background:var(--ui-hover);color:var(--ui-text)}.browser-tool:disabled{opacity:.28;cursor:default}.browser-tool svg{width:15px;height:15px}
      .browser-address-form{flex:1;min-width:120px;margin:0}.browser-address{width:100%;height:31px!important;min-height:31px!important;padding:5px 11px!important;border:1px solid var(--ui-border)!important;border-radius:8px!important;background:#1c1d1f!important;color:var(--ui-text)!important;font-size:11.5px!important;box-shadow:none!important}.browser-address:focus{border-color:rgba(154,174,255,.48)!important;box-shadow:0 0 0 2px rgba(154,174,255,.08)!important}
      .browser-quick{height:30px;padding:0 9px;border:1px solid var(--ui-border);border-radius:6px;background:transparent;color:var(--ui-text-2);display:flex;align-items:center;gap:6px;font-size:11px;font-weight:500;cursor:pointer}.browser-quick:hover{background:var(--ui-hover);color:var(--ui-text)}.browser-quick svg{width:13px;height:13px}
      .browser-viewport{position:relative;flex:1;min-height:0;background:#fff;overflow:hidden}.browser-placeholder{position:absolute;inset:0;display:grid;place-items:center;background:var(--ui-bg);color:var(--ui-muted);text-align:center}.browser-placeholder>div{max-width:420px;padding:24px}.browser-placeholder svg{width:26px;height:26px;margin-bottom:9px;color:var(--ui-faint)}.browser-placeholder strong{display:block;margin-bottom:4px;color:var(--ui-text);font-size:13px}.browser-placeholder span{display:block;font-size:11.5px;line-height:1.55}
      .browser-session-note{height:24px;min-height:24px;padding:0 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#1f2022;border-top:1px solid var(--ui-border-soft);color:var(--ui-faint);font-size:9.5px}.browser-session-note b{color:var(--ui-muted);font-weight:500}.browser-session-note .browser-error{color:var(--ui-danger);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media(max-width:900px){.browser-quick span{display:none}.browser-quick{width:30px;padding:0;justify-content:center}.browser-tab{min-width:96px}.browser-session-note>span:first-child{display:none}}
    `;
    document.head.appendChild(style);
  }

  function ensureRoute() {
    route = document.getElementById('route-browser');
    if (route) return route;
    const content = document.querySelector('.main .content');
    if (!content) return null;

    route = document.createElement('section');
    route.id = 'route-browser';
    route.className = 'route browser-route';
    route.innerHTML = `
      <div class="browser-workspace">
        <div class="browser-tabbar">
          <div id="browserTabs" class="browser-tabs"></div>
          <button id="browserNewTab" class="browser-new-tab" type="button" title="Tab mới"><i data-lucide="plus" aria-hidden="true"></i></button>
        </div>
        <div class="browser-toolbar">
          <button id="browserBack" class="browser-tool" type="button" title="Quay lại"><i data-lucide="chevron-left" aria-hidden="true"></i></button>
          <button id="browserForward" class="browser-tool" type="button" title="Tiến tới"><i data-lucide="chevron-right" aria-hidden="true"></i></button>
          <button id="browserReload" class="browser-tool" type="button" title="Tải lại"><i data-lucide="rotate-cw" aria-hidden="true"></i></button>
          <form id="browserAddressForm" class="browser-address-form"><input id="browserAddress" class="browser-address" autocomplete="off" spellcheck="false" placeholder="Nhập địa chỉ hoặc tìm kiếm Google"></form>
          <button id="browserChatGPT" class="browser-quick" type="button" title="Mở ChatGPT"><i data-lucide="sparkles" aria-hidden="true"></i><span>ChatGPT</span></button>
          <button id="browserExternal" class="browser-tool" type="button" title="Mở bằng trình duyệt ngoài"><i data-lucide="external-link" aria-hidden="true"></i></button>
        </div>
        <div id="browserViewport" class="browser-viewport">
          <div id="browserPlaceholder" class="browser-placeholder"><div><i data-lucide="globe-2" aria-hidden="true"></i><strong>Trình duyệt ChatCode</strong><span>ChatGPT và website mở trực tiếp trong ChatCode. Phiên đăng nhập được giữ riêng và không đưa vào MCP.</span></div></div>
        </div>
        <div class="browser-session-note"><span>Phiên riêng · <b>persist:chatcode-browser</b> · không tích hợp Node</span><span id="browserStatus">Sẵn sàng</span></div>
      </div>`;
    content.appendChild(route);
    viewport = document.getElementById('browserViewport');
    return route;
  }

  function ensureNavigation() {
    if (document.getElementById('browserNav')) return;
    const connection = document.querySelector('.nav-link[data-route="connection"]');
    const nav = connection?.parentElement || document.querySelector('.sidebar .nav');
    if (!nav) return;
    const button = document.createElement('button');
    button.id = 'browserNav';
    button.className = 'nav-link';
    button.dataset.route = 'browser';
    const holder = document.createElement('span');
    holder.className = 'ui-nav-icon';
    holder.appendChild(icon('globe-2'));
    button.append(holder, document.createTextNode('Trình duyệt'));
    button.addEventListener('click', () => showBrowser());
    if (connection) connection.after(button);
    else nav.appendChild(button);
  }

  function activeTab() {
    return (state.tabs || []).find(tab => tab.id === state.active_tab_id) || null;
  }

  function setStatus(message, error = false) {
    const node = document.getElementById('browserStatus');
    if (!node) return;
    node.textContent = String(message || 'Sẵn sàng');
    node.classList.toggle('browser-error', !!error);
  }

  function renderTabs() {
    const holder = document.getElementById('browserTabs');
    if (!holder) return;
    holder.replaceChildren();
    for (const tab of state.tabs || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `browser-tab${tab.id === state.active_tab_id ? ' active' : ''}${tab.loading ? ' loading' : ''}`;
      button.title = tab.title || tab.url || 'Tab';
      const dot = document.createElement('span');
      dot.className = 'browser-tab-loading';
      const title = document.createElement('span');
      title.className = 'browser-tab-title';
      title.textContent = tab.title || 'Tab mới';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'browser-tab-close';
      close.title = 'Đóng tab';
      close.textContent = '×';
      close.addEventListener('click', event => {
        event.stopPropagation();
        run('close', { tab_id:tab.id });
      });
      button.append(dot, title, close);
      button.addEventListener('click', () => run('activate', { tab_id:tab.id }));
      holder.appendChild(button);
    }
  }

  function renderState(next) {
    if (next && typeof next === 'object') state = next;
    renderTabs();
    const tab = activeTab();
    const address = document.getElementById('browserAddress');
    if (address && document.activeElement !== address) address.value = tab?.url || '';
    const back = document.getElementById('browserBack');
    const forward = document.getElementById('browserForward');
    const reload = document.getElementById('browserReload');
    const external = document.getElementById('browserExternal');
    if (back) back.disabled = !tab?.canGoBack;
    if (forward) forward.disabled = !tab?.canGoForward;
    if (external) external.disabled = !tab?.url;
    if (reload) {
      reload.title = tab?.loading ? 'Dừng tải' : 'Tải lại';
      reload.replaceChildren(icon(tab?.loading ? 'x' : 'rotate-cw'));
    }
    const placeholder = document.getElementById('browserPlaceholder');
    if (placeholder) placeholder.style.display = tab ? 'none' : 'grid';
    refreshIcons();
  }

  async function run(action, payload = {}) {
    try {
      setStatus('Đang xử lý…');
      const next = await api.browserCommand(action, payload);
      renderState(next);
      setStatus('Sẵn sàng');
      if (route?.classList.contains('active')) updateBounds();
      return next;
    } catch (error) {
      setStatus(error?.message || String(error), true);
      return null;
    }
  }

  function updateBounds() {
    if (!viewport || !route?.classList.contains('active')) return;
    const rect = viewport.getBoundingClientRect();
    api.browserSetBounds({ x:rect.x, y:rect.y, width:rect.width, height:rect.height }).catch?.(() => {});
  }

  async function syncVisibility() {
    const active = !!route?.classList.contains('active');
    document.body.classList.toggle('browser-workspace-active', active);
    try { await api.browserSetVisible(active); } catch {}
    if (active) {
      if (!initialized) {
        initialized = true;
        await run('init');
      }
      requestAnimationFrame(updateBounds);
    }
  }

  async function showBrowser() {
    if (!route) return;
    if (typeof window.routeTo === 'function') window.routeTo('browser');
    else {
      document.querySelectorAll('.route').forEach(node => node.classList.toggle('active', node === route));
      document.querySelectorAll('.nav-link[data-route]').forEach(node => node.classList.toggle('active', node.dataset.route === 'browser'));
      localStorage.setItem('route', 'browser');
    }
    await syncVisibility();
  }

  function bindControls() {
    document.getElementById('browserNewTab')?.addEventListener('click', () => run('new', { url:'https://www.google.com/' }));
    document.getElementById('browserBack')?.addEventListener('click', () => run('back'));
    document.getElementById('browserForward')?.addEventListener('click', () => run('forward'));
    document.getElementById('browserReload')?.addEventListener('click', () => run(activeTab()?.loading ? 'stop' : 'reload'));
    document.getElementById('browserChatGPT')?.addEventListener('click', () => run('home'));
    document.getElementById('browserExternal')?.addEventListener('click', () => run('external'));
    document.getElementById('browserAddressForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const input = document.getElementById('browserAddress')?.value || '';
      run('navigate', { input });
    });
  }

  async function mount() {
    ensureStyles();
    if (!ensureRoute()) return;
    ensureNavigation();
    bindControls();
    refreshIcons();

    try { renderState(await api.browserWorkspace()); } catch {}
    api.onBrowserChanged?.(value => renderState(value));

    const observer = new MutationObserver(() => syncVisibility());
    observer.observe(route, { attributes:true, attributeFilter:['class'] });
    resizeObserver = new ResizeObserver(() => updateBounds());
    if (viewport) resizeObserver.observe(viewport);
    window.addEventListener('resize', updateBounds, { passive:true });

    if (localStorage.getItem('route') === 'browser') await showBrowser();
  }

  mount();
})();
