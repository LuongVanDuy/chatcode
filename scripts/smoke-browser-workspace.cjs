const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  DEFAULT_HOME,
  NEW_TAB_HOME,
  BROWSER_PARTITION,
  BROWSER_ACCEPT_LANGUAGE,
  MAX_TABS,
  normalizeDirectUrl,
  normalizeBrowserInput,
  createBrowserWorkspace
} = require('../core/browser-workspace');

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.url = '';
    this.title = '';
    this.loading = false;
    this.history = [];
    this.historyIndex = -1;
    this.closed = false;
    this.windowOpenHandler = null;
  }
  async loadURL(url) {
    this.loading = true;
    this.emit('did-start-loading');
    this.url = String(url);
    this.title = this.url.includes('chatgpt.com') ? 'ChatGPT' : this.url.includes('google.com') ? 'Google' : this.url;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.url);
    this.historyIndex = this.history.length - 1;
    this.emit('did-navigate', {}, this.url);
    this.emit('page-title-updated', {}, this.title);
    this.loading = false;
    this.emit('did-stop-loading');
    return undefined;
  }
  getURL() { return this.url; }
  getTitle() { return this.title; }
  isLoading() { return this.loading; }
  canGoBack() { return this.historyIndex > 0; }
  canGoForward() { return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1; }
  goBack() { if (this.canGoBack()) { this.historyIndex -= 1; this.url = this.history[this.historyIndex]; this.emit('did-navigate', {}, this.url); } }
  goForward() { if (this.canGoForward()) { this.historyIndex += 1; this.url = this.history[this.historyIndex]; this.emit('did-navigate', {}, this.url); } }
  reload() { this.emit('did-start-loading'); this.emit('did-stop-loading'); }
  stop() { this.loading = false; this.emit('did-stop-loading'); }
  close() { this.closed = true; }
  isDestroyed() { return this.closed; }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
}

class FakeWebContentsView {
  constructor(options = {}) {
    this.options = options;
    this.webContents = options.webContents || new FakeWebContents();
    this.bounds = null;
  }
  setBounds(bounds) { this.bounds = { ...bounds }; }
}

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.sent = [];
    this.webContents = new EventEmitter();
    this.webContents.send = (...args) => this.sent.push(args);
    this.contentView = {
      children:new Set(),
      addChildView:view => this.contentView.children.add(view),
      removeChildView:view => this.contentView.children.delete(view)
    };
  }
  isDestroyed() { return this.destroyed; }
}

(async () => {
  assert.equal(normalizeDirectUrl('chatgpt.com'), 'https://chatgpt.com/');
  assert.equal(normalizeDirectUrl('localhost:3000/wp-admin'), 'http://localhost:3000/wp-admin');
  assert.equal(normalizeDirectUrl('javascript:alert(1)'), null);
  assert.equal(normalizeDirectUrl('file:///tmp/test.txt'), null);
  assert.match(normalizeBrowserInput('OpenAI API docs'), /^https:\/\/www\.google\.com\/search\?q=/);
  assert.equal(normalizeBrowserInput('javascript:alert(1)'), null);

  let permissionRequestHandler = null;
  let permissionCheckHandler = null;
  let beforeSendHeadersHandler = null;
  const session = {
    requestedPartition:null,
    fromPartition(partition) {
      this.requestedPartition = partition;
      return {
        webRequest:{ onBeforeSendHeaders(handler) { beforeSendHeadersHandler = handler; } },
        setPermissionRequestHandler(handler) { permissionRequestHandler = handler; },
        setPermissionCheckHandler(handler) { permissionCheckHandler = handler; }
      };
    }
  };
  const external = [];
  const shell = { async openExternal(url) { external.push(url); } };
  const changes = [];
  const workspace = createBrowserWorkspace({
    WebContentsView:FakeWebContentsView,
    session,
    shell,
    onChanged:value => changes.push(value)
  });
  const window = new FakeWindow();
  workspace.attachWindow(window);
  workspace.setBounds({ x:250.4, y:145.6, width:920.2, height:610.9 });
  workspace.setVisible(true);
  assert.equal(window.contentView.children.size, 0, 'lazy workspace must not allocate a view before init');

  let snap = await workspace.command('init');
  assert.equal(snap.tabs.length, 1);
  assert.equal(snap.tabs[0].url, DEFAULT_HOME);
  assert.equal(snap.locale, 'vi-VN');
  assert.equal(session.requestedPartition, BROWSER_PARTITION);
  assert.equal(window.contentView.children.size, 1);
  const firstId = snap.active_tab_id;
  const firstView = [...window.contentView.children][0];
  assert.deepEqual(firstView.bounds, { x:250, y:146, width:920, height:611 });
  assert.equal(firstView.options.webPreferences.partition, BROWSER_PARTITION);
  assert.equal(firstView.options.webPreferences.nodeIntegration, false);
  assert.equal(firstView.options.webPreferences.contextIsolation, true);
  assert.equal(firstView.options.webPreferences.sandbox, true);

  let localizedHeaders = null;
  beforeSendHeadersHandler({ requestHeaders:{ 'User-Agent':'ChatCode-Test' } }, value => { localizedHeaders = value.requestHeaders; });
  assert.equal(localizedHeaders['Accept-Language'], BROWSER_ACCEPT_LANGUAGE);
  assert.equal(localizedHeaders['User-Agent'], 'ChatCode-Test', 'locale header must preserve existing request headers');

  let mediaAllowed = null;
  permissionRequestHandler({}, 'media', value => { mediaAllowed = value; });
  let clipboardAllowed = null;
  permissionRequestHandler({}, 'clipboard-sanitized-write', value => { clipboardAllowed = value; });
  assert.equal(mediaAllowed, false);
  assert.equal(clipboardAllowed, true);
  assert.equal(permissionCheckHandler({}, 'media'), false);
  assert.equal(permissionCheckHandler({}, 'clipboard-sanitized-write'), true);

  snap = await workspace.command('new', { url:NEW_TAB_HOME });
  assert.equal(snap.tabs.length, 2);
  assert.notEqual(snap.active_tab_id, firstId);
  const secondId = snap.active_tab_id;
  assert.equal(window.contentView.children.size, 1, 'only active browser view may be attached');

  snap = await workspace.command('activate', { tab_id:firstId });
  assert.equal(snap.active_tab_id, firstId);
  assert.equal(window.contentView.children.size, 1);

  snap = await workspace.command('navigate', { input:'OpenAI API docs' });
  assert.match(snap.tabs.find(tab => tab.id === firstId).url, /^https:\/\/www\.google\.com\/search\?q=/);
  await assert.rejects(() => workspace.command('navigate', { input:'javascript:alert(1)' }), /giao thức/i);

  const firstContents = [...window.contentView.children][0].webContents;
  const popup = firstContents.windowOpenHandler({ url:'https://example.com/login', disposition:'foreground-tab' });
  assert.equal(popup.action, 'allow');
  const adopted = new FakeWebContents();
  adopted.url = 'https://example.com/login';
  popup.createWindow({ webContents:adopted });
  snap = workspace.snapshot();
  assert.equal(snap.tabs.length, 3);
  const popupId = snap.active_tab_id;
  assert.equal(snap.tabs.find(tab => tab.id === popupId).url, 'https://example.com/login');

  const popupContents = [...window.contentView.children][0].webContents;
  const background = popupContents.windowOpenHandler({ url:'https://example.org/', disposition:'background-tab' });
  const backgroundContents = new FakeWebContents();
  backgroundContents.url = 'https://example.org/';
  background.createWindow({ webContents:backgroundContents });
  snap = workspace.snapshot();
  assert.equal(snap.tabs.length, 4);
  assert.equal(snap.active_tab_id, popupId, 'background popup must not steal active tab');

  await workspace.command('external');
  assert.deepEqual(external, ['https://example.com/login']);

  workspace.setVisible(false);
  assert.equal(window.contentView.children.size, 0, 'hidden browser route must detach its view');
  workspace.setVisible(true);
  assert.equal(window.contentView.children.size, 1);

  await workspace.command('activate', { tab_id:secondId });
  await workspace.command('close', { tab_id:secondId });
  snap = workspace.snapshot();
  assert.equal(snap.tabs.some(tab => tab.id === secondId), false);
  assert.ok(snap.active_tab_id);

  while (workspace.snapshot().tabs.length < MAX_TABS) await workspace.command('new', { url:'https://example.com/' });
  await assert.rejects(() => workspace.command('new', { url:'https://example.net/' }), /tối đa/i);

  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'browser-workspace.js'), 'utf8');
  assert.ok(renderer.includes('body.browser-workspace-active .topbar{display:none!important}'), 'Browser route must hide the ChatCode page header');
  assert.ok(renderer.includes('body.browser-workspace-active .content{padding:0!important;overflow:hidden!important}'), 'Browser route must consume the full main area beside sidebar');
  assert.ok(renderer.includes("document.body.classList.toggle('browser-workspace-active', active)"), 'Fullscreen browser chrome must be scoped only to the active Browser route');
  assert.ok(renderer.includes('Trình duyệt ChatCode'), 'Browser-owned labels must be Vietnamese');
  assert.ok(renderer.includes('Phiên riêng'), 'Browser session note must be Vietnamese');

  assert.ok(changes.length > 0, 'workspace state changes must be observable by renderer');
  workspace.destroy();
  assert.equal(workspace.snapshot().tabs.length, 0);
  assert.equal(window.contentView.children.size, 0);

  console.log('Browser Workspace PASS: full sidebar-adjacent layout + vi-VN session + isolated tabs/popups + bounded lifecycle');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
