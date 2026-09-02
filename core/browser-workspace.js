const DEFAULT_HOME = 'https://chatgpt.com/';
const NEW_TAB_HOME = 'https://www.google.com/';
const BROWSER_PARTITION = 'persist:chatcode-browser';
const BROWSER_ACCEPT_LANGUAGE = 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7';
const MAX_TABS = 10;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const EXTERNAL_PROTOCOLS = new Set(['mailto:', 'tel:']);

function normalizeDirectUrl(value, { allowBlank = true } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (allowBlank && raw === 'about:blank') return raw;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(raw)) return `http://${raw}`;

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  if (/^[^\s/]+\.[^\s]+(?:[/?#].*)?$/i.test(raw)) {
    try { return new URL(`https://${raw}`).toString(); } catch { return null; }
  }
  return null;
}

function normalizeBrowserInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const direct = normalizeDirectUrl(raw);
  if (direct) return direct;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

function normalizeBounds(value = {}) {
  const number = input => Math.max(0, Math.round(Number(input) || 0));
  return {
    x:number(value.x),
    y:number(value.y),
    width:number(value.width),
    height:number(value.height)
  };
}

function createBrowserWorkspace({ WebContentsView, session, shell, onChanged = () => {} } = {}) {
  if (typeof WebContentsView !== 'function') throw new Error('WebContentsView không khả dụng.');
  const tabs = new Map();
  let mainWindow = null;
  let activeTabId = null;
  let attachedTabId = null;
  let visible = false;
  let bounds = { x:0, y:0, width:0, height:0 };
  let sequence = 0;
  let partitionConfigured = false;
  let disposed = false;

  function configurePartition() {
    if (partitionConfigured || !session?.fromPartition) return;
    const isolatedSession = session.fromPartition(BROWSER_PARTITION);
    if (isolatedSession?.webRequest?.onBeforeSendHeaders) {
      isolatedSession.webRequest.onBeforeSendHeaders((details, callback) => {
        callback({
          requestHeaders:{
            ...(details?.requestHeaders || {}),
            'Accept-Language':BROWSER_ACCEPT_LANGUAGE
          }
        });
      });
    }
    if (isolatedSession?.setPermissionRequestHandler) {
      isolatedSession.setPermissionRequestHandler((_contents, permission, callback) => {
        callback(permission === 'clipboard-sanitized-write');
      });
    }
    if (isolatedSession?.setPermissionCheckHandler) {
      isolatedSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write');
    }
    partitionConfigured = true;
  }

  function activeTab() { return tabs.get(activeTabId) || null; }

  function tabSnapshot(tab) {
    const contents = tab?.view?.webContents;
    if (!contents) return null;
    let url = tab.url || '';
    let title = tab.title || 'Tab mới';
    let loading = false;
    let canGoBack = false;
    let canGoForward = false;
    try { url = contents.getURL?.() || url; } catch {}
    try { title = contents.getTitle?.() || title; } catch {}
    try { loading = !!contents.isLoading?.(); } catch {}
    try { canGoBack = !!contents.canGoBack?.(); } catch {}
    try { canGoForward = !!contents.canGoForward?.(); } catch {}
    return { id:tab.id, title:String(title || 'Tab mới').slice(0,120), url:String(url || ''), loading, canGoBack, canGoForward };
  }

  function snapshot() {
    return {
      enabled:true,
      visible,
      active_tab_id:activeTabId,
      max_tabs:MAX_TABS,
      partition:BROWSER_PARTITION,
      locale:'vi-VN',
      tabs:[...tabs.values()].map(tabSnapshot).filter(Boolean)
    };
  }

  function emit() {
    const value = snapshot();
    try { onChanged(value); } catch {}
    return value;
  }

  function removeAttachedView() {
    if (!attachedTabId || !mainWindow || mainWindow.isDestroyed?.()) { attachedTabId = null; return; }
    const tab = tabs.get(attachedTabId);
    if (tab) {
      try { mainWindow.contentView?.removeChildView(tab.view); } catch {}
    }
    attachedTabId = null;
  }

  function syncAttachedView() {
    if (!mainWindow || mainWindow.isDestroyed?.()) { attachedTabId = null; return; }
    const tab = activeTab();
    const shouldAttach = visible && tab && bounds.width > 0 && bounds.height > 0;
    if (!shouldAttach) { removeAttachedView(); return; }

    if (attachedTabId && attachedTabId !== tab.id) removeAttachedView();
    if (attachedTabId !== tab.id) {
      try { mainWindow.contentView?.addChildView(tab.view); attachedTabId = tab.id; } catch { attachedTabId = null; return; }
    }
    try { tab.view.setBounds(bounds); } catch {}
  }

  function updateFromContents(tab) {
    const contents = tab?.view?.webContents;
    if (!contents || contents.isDestroyed?.()) return;
    try { tab.url = contents.getURL?.() || tab.url; } catch {}
    try { tab.title = contents.getTitle?.() || tab.title; } catch {}
    emit();
  }

  function openExternal(value) {
    const raw = String(value || '').trim();
    if (!raw || !shell?.openExternal) return false;
    try {
      const parsed = new URL(raw);
      if (!ALLOWED_PROTOCOLS.has(parsed.protocol) && !EXTERNAL_PROTOCOLS.has(parsed.protocol)) return false;
      shell.openExternal(raw).catch?.(() => {});
      return true;
    } catch { return false; }
  }

  function createView(adoptedWebContents = null) {
    configurePartition();
    if (adoptedWebContents) return new WebContentsView({ webContents:adoptedWebContents });
    return new WebContentsView({
      webPreferences:{
        partition:BROWSER_PARTITION,
        sandbox:true,
        contextIsolation:true,
        nodeIntegration:false,
        webSecurity:true,
        allowRunningInsecureContent:false,
        spellcheck:true
      }
    });
  }

  function configureContents(tab) {
    const contents = tab.view.webContents;
    const refresh = () => updateFromContents(tab);
    for (const event of ['did-start-loading','did-stop-loading','did-navigate','did-navigate-in-page','page-title-updated']) {
      contents.on?.(event, refresh);
    }
    contents.on?.('did-fail-load', refresh);
    contents.on?.('render-process-gone', refresh);
    contents.on?.('will-navigate', (event, target) => {
      const direct = normalizeDirectUrl(target);
      if (direct) return;
      event?.preventDefault?.();
      openExternal(target);
    });

    contents.setWindowOpenHandler?.(details => {
      const target = normalizeDirectUrl(details?.url);
      if (!target) {
        openExternal(details?.url);
        return { action:'deny' };
      }
      if (tabs.size >= MAX_TABS) {
        if (details?.disposition !== 'background-tab') openExternal(target);
        return { action:'deny' };
      }
      return {
        action:'allow',
        createWindow:options => {
          const childView = createView(options?.webContents || null);
          const child = registerTab(childView, {
            url:target,
            title:'Đang mở…',
            activate:details?.disposition !== 'background-tab',
            skipLoad:!!options?.webContents
          });
          return child.view.webContents;
        }
      };
    });
  }

  function registerTab(view, { url = '', title = 'Tab mới', activate = true, skipLoad = false } = {}) {
    if (tabs.size >= MAX_TABS) throw new Error(`Trình duyệt chỉ mở tối đa ${MAX_TABS} tab.`);
    const id = `browser-tab-${++sequence}`;
    const tab = { id, view, url, title };
    tabs.set(id, tab);
    configureContents(tab);
    if (!activeTabId || activate) activeTabId = id;
    syncAttachedView();
    emit();
    if (!skipLoad && url) view.webContents.loadURL(url).catch(() => updateFromContents(tab));
    return tab;
  }

  function createTab(value = NEW_TAB_HOME, activate = true) {
    const target = normalizeBrowserInput(value);
    if (!target) throw new Error('Địa chỉ không hợp lệ hoặc giao thức không được phép.');
    return registerTab(createView(), { url:target, title:'Đang mở…', activate });
  }

  function closeTab(id, { ensureOne = true } = {}) {
    const tabId = String(id || activeTabId || '');
    const tab = tabs.get(tabId);
    if (!tab) return snapshot();
    const ids = [...tabs.keys()];
    const index = ids.indexOf(tabId);
    if (attachedTabId === tabId) removeAttachedView();
    tabs.delete(tabId);
    try { if (!tab.view.webContents.isDestroyed?.()) tab.view.webContents.close?.(); } catch {}

    if (activeTabId === tabId) {
      const remaining = [...tabs.keys()];
      activeTabId = remaining[Math.min(index, Math.max(0, remaining.length - 1))] || null;
    }
    if (ensureOne && tabs.size === 0 && !disposed) createTab(NEW_TAB_HOME, true);
    syncAttachedView();
    return emit();
  }

  function setActive(id) {
    const tabId = String(id || '');
    if (!tabs.has(tabId)) throw new Error('Không tìm thấy tab trình duyệt.');
    activeTabId = tabId;
    syncAttachedView();
    return emit();
  }

  async function navigate(value, id = activeTabId) {
    const tab = tabs.get(String(id || ''));
    if (!tab) throw new Error('Không có tab trình duyệt đang hoạt động.');
    const target = normalizeBrowserInput(value);
    if (!target) throw new Error('Địa chỉ không hợp lệ hoặc giao thức không được phép.');
    await tab.view.webContents.loadURL(target);
    updateFromContents(tab);
    return snapshot();
  }

  async function command(action, payload = {}) {
    const name = String(action || '').trim().toLowerCase();
    if (name === 'init') {
      if (!tabs.size) createTab(DEFAULT_HOME, true);
      return emit();
    }
    if (name === 'new') { createTab(payload.url || NEW_TAB_HOME, payload.activate !== false); return snapshot(); }
    if (name === 'close') return closeTab(payload.tab_id || payload.id);
    if (name === 'activate') return setActive(payload.tab_id || payload.id);
    if (name === 'navigate') return navigate(payload.input ?? payload.url, payload.tab_id || activeTabId);
    if (name === 'home') return navigate(DEFAULT_HOME, payload.tab_id || activeTabId);

    const tab = tabs.get(String(payload.tab_id || activeTabId || ''));
    if (!tab) throw new Error('Không có tab trình duyệt đang hoạt động.');
    const contents = tab.view.webContents;
    if (name === 'back') { if (contents.canGoBack?.()) contents.goBack(); return emit(); }
    if (name === 'forward') { if (contents.canGoForward?.()) contents.goForward(); return emit(); }
    if (name === 'reload') { contents.reload?.(); return emit(); }
    if (name === 'stop') { contents.stop?.(); return emit(); }
    if (name === 'external') { openExternal(contents.getURL?.() || tab.url); return snapshot(); }
    throw new Error(`Lệnh trình duyệt không hỗ trợ: ${name}`);
  }

  function attachWindow(window) {
    if (!window || window === mainWindow) return snapshot();
    removeAttachedView();
    mainWindow = window;
    window.webContents?.on?.('did-start-loading', () => {
      if (window !== mainWindow) return;
      visible = false;
      syncAttachedView();
    });
    window.on?.('closed', () => {
      if (window !== mainWindow) return;
      removeAttachedView();
      mainWindow = null;
    });
    syncAttachedView();
    return snapshot();
  }

  function setBounds(value) {
    bounds = normalizeBounds(value);
    syncAttachedView();
    return true;
  }

  function setVisible(value) {
    visible = !!value;
    syncAttachedView();
    emit();
    return true;
  }

  function destroy() {
    disposed = true;
    removeAttachedView();
    for (const tab of tabs.values()) {
      try { if (!tab.view.webContents.isDestroyed?.()) tab.view.webContents.close?.(); } catch {}
    }
    tabs.clear();
    activeTabId = null;
    visible = false;
  }

  return { snapshot, command, attachWindow, setBounds, setVisible, destroy };
}

let installed = null;
function installBrowserWorkspace() {
  if (installed) return installed;
  const { app, ipcMain, WebContentsView, session, shell } = require('electron');
  let workspaceWindow = null;
  const workspace = createBrowserWorkspace({
    WebContentsView,
    session,
    shell,
    onChanged:value => {
      const window = workspaceWindow;
      if (window && !window.isDestroyed?.()) window.webContents.send('browser:changed', value);
    }
  });

  app.on('browser-window-created', (_event, window) => {
    if (workspaceWindow && !workspaceWindow.isDestroyed?.()) return;
    workspaceWindow = window;
    workspace.attachWindow(window);
    window.on?.('closed', () => { if (workspaceWindow === window) workspaceWindow = null; });
  });

  ipcMain.handle('browser:workspace', () => workspace.snapshot());
  ipcMain.handle('browser:command', (_event, action, payload) => workspace.command(action, payload || {}));
  ipcMain.handle('browser:bounds', (_event, value) => workspace.setBounds(value || {}));
  ipcMain.handle('browser:visible', (_event, value) => workspace.setVisible(value));

  app.on('before-quit', () => workspace.destroy());
  installed = workspace;
  return workspace;
}

module.exports = {
  DEFAULT_HOME,
  NEW_TAB_HOME,
  BROWSER_PARTITION,
  BROWSER_ACCEPT_LANGUAGE,
  MAX_TABS,
  normalizeDirectUrl,
  normalizeBrowserInput,
  normalizeBounds,
  createBrowserWorkspace,
  installBrowserWorkspace
};
