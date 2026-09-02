(() => {
  function normalize(value) { return String(value || '').trim(); }

  function chatConversationKey(value) {
    const raw = normalize(value);
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      if (host !== 'chatgpt.com' && host !== 'www.chatgpt.com') return null;
      const conversation = parsed.pathname.match(/(?:^|\/)c\/([^/?#]+)/i);
      if (conversation) return `conversation:${conversation[1]}`;
      if (parsed.pathname === '/' || parsed.pathname === '') return 'new:/';
      if (/^\/g\/[^/]+\/?$/i.test(parsed.pathname)) return `new:${parsed.pathname.replace(/\/$/, '')}`;
      return null;
    } catch { return null; }
  }

  function createProjectTabLabelModel() {
    const metadata = new Map();
    let state = { tabs:[], active_tab_id:null, visible:false };

    function itemFor(tab) {
      if (!tab?.id) return null;
      if (!metadata.has(tab.id)) metadata.set(tab.id, { identity:null, label:'' });
      return metadata.get(tab.id);
    }

    function sync(next = {}) {
      state = next && typeof next === 'object' ? next : state;
      const alive = new Set();
      for (const tab of state.tabs || []) {
        if (!tab?.id) continue;
        alive.add(tab.id);
        const item = itemFor(tab);
        const identity = chatConversationKey(tab.url);
        const previous = item.identity;
        const previousConversation = previous?.startsWith('conversation:');
        const currentConversation = identity?.startsWith('conversation:');
        const previousNew = previous?.startsWith('new:');
        const currentNew = identity?.startsWith('new:');

        if (!identity) item.label = '';
        else if (previousConversation && currentNew) item.label = '';
        else if (previousConversation && currentConversation && previous !== identity) item.label = '';
        else if (previousNew && currentNew && previous !== identity) item.label = '';
        else if (!previous && currentConversation) item.label = '';

        item.identity = identity;
      }
      for (const id of metadata.keys()) if (!alive.has(id)) metadata.delete(id);
      return state;
    }

    function claim(projectLabel) {
      const label = normalize(projectLabel);
      if (!label || !state.visible) return false;
      const tab = (state.tabs || []).find(item => item.id === state.active_tab_id);
      if (!tab || !chatConversationKey(tab.url)) return false;
      const item = itemFor(tab);
      if (!item || item.label) return false;
      item.label = label.slice(0, 120);
      return true;
    }

    function labelFor(tabId) { return metadata.get(String(tabId || ''))?.label || ''; }
    function snapshot() { return state; }
    return { sync, claim, labelFor, snapshot };
  }

  function resolveProjectLabel(value, projects = []) {
    const wanted = normalize(value).toLowerCase();
    if (!wanted) return '';
    const project = (Array.isArray(projects) ? projects : []).find(item => {
      const id = normalize(item?.id).toLowerCase();
      const name = normalize(item?.name).toLowerCase();
      return wanted === id || wanted === name;
    });
    return normalize(project?.name);
  }

  function installBrowserProjectLabels(win) {
    const api = win?.personalCode;
    const doc = win?.document;
    if (!api?.onActivityChanged || !api?.onBrowserChanged || !api?.browserWorkspace || !doc) return null;
    if (win.__chatcodeBrowserProjectLabelsLoaded) return win.__chatcodeBrowserProjectLabelsLoaded;

    const model = createProjectTabLabelModel();
    let projects = [];
    let renderQueued = false;

    function render() {
      renderQueued = false;
      const state = model.snapshot();
      const buttons = [...doc.querySelectorAll('#browserTabs .browser-tab')];
      for (let index = 0; index < (state.tabs || []).length; index++) {
        const tab = state.tabs[index];
        const button = buttons[index];
        if (!button) continue;
        const title = button.querySelector('.browser-tab-title');
        const label = model.labelFor(tab.id);
        if (!label || !title) continue;
        title.textContent = label;
        button.dataset.projectLabel = label;
        button.title = `${label} · ${tab.title || tab.url || 'ChatGPT'}`;
      }
    }

    function scheduleRender() {
      if (renderQueued) return;
      renderQueued = true;
      const raf = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : callback => setTimeout(callback, 0);
      raf(render);
    }

    async function refreshProjects() {
      try { projects = await api.listProjects(); } catch { projects = []; }
      return projects;
    }

    api.onBrowserChanged(value => {
      model.sync(value);
      scheduleRender();
    });

    api.onActivityChanged(async entry => {
      let label = resolveProjectLabel(entry?.project, projects);
      if (!label) {
        await refreshProjects();
        label = resolveProjectLabel(entry?.project, projects);
      }
      if (label && model.claim(label)) scheduleRender();
    });

    Promise.all([
      api.browserWorkspace().then(value => model.sync(value)).catch(() => {}),
      refreshProjects()
    ]).then(scheduleRender);

    const installed = { model, refreshProjects, render };
    win.__chatcodeBrowserProjectLabelsLoaded = installed;
    return installed;
  }

  const exported = { chatConversationKey, createProjectTabLabelModel, resolveProjectLabel, installBrowserProjectLabels };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof window !== 'undefined') {
    window.ChatCodeBrowserProjectLabels = exported;
    installBrowserProjectLabels(window);
  }
})();
