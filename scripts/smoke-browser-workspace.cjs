const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
const {
  MODE_STANDARD,
  MODE_MAXIMUM,
  QOS_DSCP,
  MAX_BROWSER_TABS,
  createBrowserPerformanceService
} = require('../core/browser-performance');
const {
  chatConversationKey,
  createProjectTabLabelModel,
  resolveProjectLabel
} = require('../renderer/browser-project-labels');

let nextPid = 4200;
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
    this.backgroundThrottling = true;
    this.pid = ++nextPid;
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
  setBackgroundThrottling(value) { this.backgroundThrottling = !!value; }
  getBackgroundThrottling() { return this.backgroundThrottling; }
  getOSProcessId() { return this.pid; }
}

class FakeWebContentsView {
  constructor(options = {}) {
    this.options = options;
    this.webContents = options.webContents || new FakeWebContents();
    if (options.webPreferences?.backgroundThrottling != null) {
      this.webContents.backgroundThrottling = !!options.webPreferences.backgroundThrottling;
    }
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

  assert.equal(chatConversationKey('https://chatgpt.com/'), 'new:/');
  assert.equal(chatConversationKey('https://chatgpt.com/c/abc-123'), 'conversation:abc-123');
  assert.equal(chatConversationKey('https://chatgpt.com/g/g-test'), 'new:/g/g-test');
  assert.equal(chatConversationKey('https://www.google.com/'), null);
  const configuredProjects = [
    { id:'project-a', name:'boncauinax.vn' },
    { id:'project-b', name:'longkhai' }
  ];
  assert.equal(resolveProjectLabel('project-a', configuredProjects), 'boncauinax.vn');
  assert.equal(resolveProjectLabel('BONCAUINAX.VN', configuredProjects), 'boncauinax.vn');
  assert.equal(resolveProjectLabel('CHATCODE-GPT', configuredProjects), '');

  const labels = createProjectTabLabelModel();
  labels.sync({ visible:true, active_tab_id:'tab-a', tabs:[
    { id:'tab-a', url:'https://chatgpt.com/', title:'ChatGPT' },
    { id:'tab-b', url:'https://www.google.com/', title:'Google' }
  ] });
  assert.equal(labels.claim('boncauinax.vn'), true, 'first real project must claim the active new ChatGPT conversation');
  assert.equal(labels.labelFor('tab-a'), 'boncauinax.vn');
  assert.equal(labels.claim('longkhai'), false, 'later reference projects must not replace the conversation owner');
  labels.sync({ visible:true, active_tab_id:'tab-a', tabs:[
    { id:'tab-a', url:'https://chatgpt.com/c/conversation-a', title:'ChatGPT' },
    { id:'tab-b', url:'https://www.google.com/', title:'Google' }
  ] });
  assert.equal(labels.labelFor('tab-a'), 'boncauinax.vn', 'new-chat to /c/... transition must preserve the project owner');
  labels.sync({ visible:true, active_tab_id:'tab-a', tabs:[
    { id:'tab-a', url:'https://chatgpt.com/', title:'ChatGPT' },
    { id:'tab-b', url:'https://www.google.com/', title:'Google' }
  ] });
  assert.equal(labels.labelFor('tab-a'), '', 'returning from a conversation to New Chat must reset the old project');
  assert.equal(labels.claim('longkhai'), true);
  labels.sync({ visible:true, active_tab_id:'tab-a', tabs:[
    { id:'tab-a', url:'https://chatgpt.com/c/conversation-b', title:'ChatGPT' },
    { id:'tab-b', url:'https://www.google.com/', title:'Google' }
  ] });
  assert.equal(labels.labelFor('tab-a'), 'longkhai');
  labels.sync({ visible:true, active_tab_id:'tab-a', tabs:[
    { id:'tab-a', url:'https://chatgpt.com/c/conversation-c', title:'ChatGPT' },
    { id:'tab-b', url:'https://www.google.com/', title:'Google' }
  ] });
  assert.equal(labels.labelFor('tab-a'), '', 'switching to a different existing conversation must not leak the previous project label');
  labels.sync({ visible:true, active_tab_id:'tab-b', tabs:[
    { id:'tab-a', url:'https://chatgpt.com/c/conversation-c', title:'ChatGPT' },
    { id:'tab-b', url:'https://www.google.com/', title:'Google' }
  ] });
  assert.equal(labels.claim('boncauinax.vn'), false, 'non-ChatGPT tabs must never claim a project label');

  const perfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-browser-performance-'));
  const gpuSwitches = new Set();
  const priorityCalls = [];
  const fakeApp = {
    getPath(name) { assert.equal(name, 'userData'); return perfDir; },
    commandLine:{
      appendSwitch(name) { gpuSwitches.add(name); },
      hasSwitch(name) { return gpuSwitches.has(name); }
    },
    async whenReady() {},
    getGPUFeatureStatus() { return { gpu_compositing:'enabled', webgl:'enabled', video_decode:'enabled' }; },
    async getGPUInfo() {
      return { gpuDevice:[{ active:true, vendorId:4318, deviceId:1, deviceString:'NVIDIA GeForce RTX Test', driverVendor:'NVIDIA', driverVersion:'999.0' }] };
    }
  };
  const fakeOs = {
    constants:{ priority:{ PRIORITY_HIGH:-14, PRIORITY_NORMAL:0 } },
    setPriority(pid, priority) { priorityCalls.push({ pid, priority }); },
    networkInterfaces() { return { Ethernet:[] }; }
  };
  const fakeExecFile = (_file, args, _options, callback) => {
    const command = String(args?.[args.length - 1] || '');
    if (command.includes('Get-NetAdapter')) {
      callback(null, JSON.stringify({ Name:'Ethernet', InterfaceDescription:'Test LAN', LinkSpeed:'1 Gbps', MediaType:'802.3' }), '');
      return;
    }
    if (command.includes('Get-NetQosPolicy')) {
      callback(null, 'null', '');
      return;
    }
    callback(null, '', '');
  };
  const performance = createBrowserPerformanceService({
    app:fakeApp,
    osModule:fakeOs,
    execFileImpl:fakeExecFile,
    processRef:{ platform:'win32', execPath:'C:\\Program Files\\ChatCode\\ChatCode Cá Nhân.exe' }
  });
  const boot = performance.applyStartupFlags();
  assert.equal(boot.mode, MODE_MAXIMUM, 'maximum browser performance must be the default for this release');
  assert.equal(boot.gpuSwitch, true);
  assert.equal(gpuSwitches.has('force_high_performance_gpu'), true, 'maximum mode must request the discrete GPU before Chromium starts');
  let perfSnap = await performance.snapshot();
  assert.equal(perfSnap.maximum, true);
  assert.equal(perfSnap.memory.keepTabsWarm, true);
  assert.equal(perfSnap.memory.hardMemoryLimit, false);
  assert.equal(perfSnap.network.bandwidthThrottle, false);
  assert.equal(perfSnap.network.adapters[0].linkSpeed, '1 Gbps');
  assert.equal(perfSnap.qos.installed, false);
  assert.equal(perfSnap.qos.dscp, null);
  assert.equal(QOS_DSCP, 46);
  assert.equal(MAX_BROWSER_TABS, 8);

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
    performance,
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
  assert.equal(snap.performance_mode, MODE_MAXIMUM);
  assert.equal(snap.max_tabs, 8);
  assert.equal(session.requestedPartition, BROWSER_PARTITION);
  assert.equal(window.contentView.children.size, 1);
  const firstId = snap.active_tab_id;
  const firstView = [...window.contentView.children][0];
  const firstPid = firstView.webContents.getOSProcessId();
  assert.deepEqual(firstView.bounds, { x:250, y:146, width:920, height:611 });
  assert.equal(firstView.options.webPreferences.partition, BROWSER_PARTITION);
  assert.equal(firstView.options.webPreferences.nodeIntegration, false);
  assert.equal(firstView.options.webPreferences.contextIsolation, true);
  assert.equal(firstView.options.webPreferences.sandbox, true);
  assert.equal(firstView.options.webPreferences.backgroundThrottling, false, 'maximum mode must create warm unthrottled browser contents');
  assert.equal(firstView.webContents.getBackgroundThrottling(), false);
  assert.ok(priorityCalls.some(call => call.pid === firstPid && call.priority === -14), 'active browser renderer must receive HIGH priority');

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
  const secondView = [...window.contentView.children][0];
  const secondPid = secondView.webContents.getOSProcessId();
  assert.equal(window.contentView.children.size, 1, 'only active browser view may be attached');
  assert.ok(priorityCalls.some(call => call.pid === firstPid && call.priority === 0), 'previous tab must return to NORMAL CPU priority');
  assert.ok(priorityCalls.some(call => call.pid === secondPid && call.priority === -14), 'new active tab must receive HIGH CPU priority');

  snap = await workspace.command('activate', { tab_id:firstId });
  assert.equal(snap.active_tab_id, firstId);
  assert.equal(window.contentView.children.size, 1);

  const standard = performance.setMode(MODE_STANDARD);
  assert.equal(standard.restartRequired, true, 'disabling discrete-GPU startup flag requires a restart');
  assert.equal(workspace.snapshot().performance_mode, MODE_STANDARD);
  assert.equal([...window.contentView.children][0].webContents.getBackgroundThrottling(), true, 'standard mode must restore Chromium background throttling live');
  const maximum = performance.setMode(MODE_MAXIMUM);
  assert.equal(maximum.restartRequired, false);
  assert.equal([...window.contentView.children][0].webContents.getBackgroundThrottling(), false);

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
  assert.equal(adopted.getBackgroundThrottling(), false, 'adopted popup WebContents must receive live maximum-performance throttling policy');

  const popupContents = [...window.contentView.children][0].webContents;
  const background = popupContents.windowOpenHandler({ url:'https://example.org/', disposition:'background-tab' });
  const backgroundContents = new FakeWebContents();
  backgroundContents.url = 'https://example.org/';
  background.createWindow({ webContents:backgroundContents });
  snap = workspace.snapshot();
  assert.equal(snap.tabs.length, 4);
  assert.equal(snap.active_tab_id, popupId, 'background popup must not steal active tab');
  assert.equal(backgroundContents.getBackgroundThrottling(), false, 'background tabs stay warm in maximum mode');

  await workspace.command('external');
  assert.deepEqual(external, ['https://example.com/login']);

  const activeBeforeHide = [...window.contentView.children][0].webContents.getOSProcessId();
  workspace.setVisible(false);
  assert.equal(window.contentView.children.size, 0, 'hidden browser route must detach its view');
  assert.ok(priorityCalls.some(call => call.pid === activeBeforeHide && call.priority === 0), 'hidden Browser Workspace must release HIGH CPU priority');
  workspace.setVisible(true);
  assert.equal(window.contentView.children.size, 1);
  assert.ok(priorityCalls.some(call => call.pid === activeBeforeHide && call.priority === -14), 'visible active tab must regain HIGH CPU priority');

  await workspace.command('activate', { tab_id:secondId });
  await workspace.command('close', { tab_id:secondId });
  snap = workspace.snapshot();
  assert.equal(snap.tabs.some(tab => tab.id === secondId), false);
  assert.ok(snap.active_tab_id);

  while (workspace.snapshot().tabs.length < MAX_TABS) await workspace.command('new', { url:'https://example.com/' });
  await assert.rejects(() => workspace.command('new', { url:'https://example.net/' }), /tối đa/i);

  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'browser-workspace.js'), 'utf8');
  const projectLabels = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'browser-project-labels.js'), 'utf8');
  const performanceRenderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'browser-performance.js'), 'utf8');
  const performanceCore = fs.readFileSync(path.join(__dirname, '..', 'core', 'browser-performance.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(__dirname, '..', 'bootstrap-main.js'), 'utf8');
  assert.ok(renderer.includes('body.browser-workspace-active .topbar{display:none!important}'), 'Browser route must hide the ChatCode page header');
  assert.ok(renderer.includes('body.browser-workspace-active .content{padding:0!important;overflow:hidden!important}'), 'Browser route must consume the full main area beside sidebar');
  assert.ok(renderer.includes("document.body.classList.toggle('browser-workspace-active', active)"), 'Fullscreen browser chrome must be scoped only to the active Browser route');
  assert.ok(renderer.includes('Trình duyệt ChatCode'), 'Browser-owned labels must be Vietnamese');
  assert.ok(renderer.includes('Phiên riêng'), 'Browser session note must be Vietnamese');
  assert.ok(projectLabels.includes('api.onActivityChanged'), 'Project labels must reuse the existing activity event instead of adding a new MCP channel');
  assert.ok(projectLabels.includes("doc.querySelectorAll('#browserTabs .browser-tab')"), 'Project labels may only decorate ChatCode browser chrome, not the ChatGPT DOM');
  assert.ok(preload.includes("await load('browser-project-labels.js', 'browser-project-labels')"), 'Project-label module must load after Browser Workspace');
  assert.ok(preload.includes("await load('browser-performance.js', 'browser-performance')"), 'Browser Performance settings must load after Browser Workspace');
  assert.ok(bootstrap.indexOf("installBrowserPerformance") < bootstrap.indexOf("installBrowserWorkspace"), 'GPU startup flags must be installed before Browser Workspace');
  assert.ok(performanceCore.includes("appendSwitch?.('force_high_performance_gpu')"), 'maximum mode must use Electron high-performance discrete-GPU switch');
  assert.ok(performanceCore.includes('PRIORITY_HIGH'), 'active browser renderer must use Windows/Node HIGH process priority');
  assert.ok(performanceCore.includes('setBackgroundThrottling?.(!maximum)'), 'performance mode must control Chromium background throttling live');
  assert.ok(performanceCore.includes('New-NetQosPolicy'), 'QoS install must use the Windows NetQos policy API');
  assert.ok(performanceCore.includes("-Verb RunAs"), 'QoS install/remove must request explicit Administrator approval');
  assert.ok(performanceCore.includes('DSCPAction ${QOS_DSCP}'), 'QoS policy must apply the bounded DSCP value');
  assert.ok(performanceCore.includes('windowsHide:true'), 'all non-UAC PowerShell diagnostics must stay hidden');
  assert.ok(performanceRenderer.includes('Hiệu năng trình duyệt'), 'performance controls must be visible in Vietnamese Settings UI');
  assert.ok(performanceRenderer.includes('Cài QoS ưu tiên'), 'QoS must be an explicit user action, not silent elevation');

  assert.ok(changes.length > 0, 'workspace state changes must be observable by renderer');
  workspace.destroy();
  assert.equal(workspace.snapshot().tabs.length, 0);
  assert.equal(window.contentView.children.size, 0);
  fs.rmSync(perfDir, { recursive:true, force:true });

  console.log('Browser Workspace PASS: project labels + maximum CPU/RAM/GPU mode + LAN/QoS diagnostics + 8-tab bounded lifecycle');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
