(function freshInstallWorkspace() {
  const freshApi = window.personalCode;
  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const state = { catalog:null, tasks:[], poll:null, refreshing:false };

  function statusLabel(value) {
    return ({
      ready:'Sẵn sàng',
      running:'Đang cài',
      interrupted:'Bị gián đoạn',
      failed:'Chưa hoàn tất',
      completed:'Hoàn tất'
    })[value] || String(value || '—');
  }

  function checkpointLabel(value) {
    return ({
      created:'Khởi tạo',
      discovered:'Đã nhận diện hosting',
      uploaded:'Đã upload bootstrap/theme',
      installed:'Đã cài WordPress',
      verified:'Đã verify remote',
      completed:'SITE_READY'
    })[value] || String(value || '—');
  }

  function formatBytes(value) {
    let n = Math.max(0, Number(value || 0));
    if (!n) return '—';
    const units = ['B','KB','MB','GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function message(text, tone = '') {
    const box = byId('freshInstallMessage');
    if (!box) return;
    box.textContent = text || '';
    box.className = `message ${tone}`;
  }

  function renderCatalog() {
    const catalog = state.catalog;
    if (!catalog) return;
    const select = byId('freshTheme');
    const current = select?.value || 'bricks';
    const options = [
      { id:'bricks', label:'Bricks 2.4 · Bricks Child active', version:'2.4' },
      { id:'wordpress-default', label:'WordPress mặc định', version:'latest' }
    ];
    for (const item of catalog.package_library || []) {
      if (item.kind !== 'theme' || item.id === 'bricks') continue;
      options.push({ id:item.id, label:`${item.slug || item.id} · ${item.version || 'custom'}`, version:item.version || 'custom' });
    }
    if (select) {
      select.innerHTML = options.map(item => `<option value="${escapeHtml(item.id)}" data-version="${escapeHtml(item.version)}">${escapeHtml(item.label)}</option>`).join('');
      if (options.some(item => item.id === current)) select.value = current;
      else select.value = 'bricks';
    }
    const ready = !!catalog.readiness?.bricks_2_4;
    const hash = String(catalog.readiness?.bricks_2_4_sha256 || '');
    const bytes = Number(catalog.readiness?.bricks_2_4_bytes || 0);
    const status = byId('freshBricksStatus');
    if (status) status.innerHTML = ready
      ? `<div class="fresh-ready ok"><i>✓</i><div><strong>Bricks 2.4 đã sẵn sàng</strong><span>${formatBytes(bytes)} · SHA256 ${escapeHtml(hash.slice(0,16))}…</span></div></div>`
      : '<div class="fresh-ready warn"><i>!</i><div><strong>Chưa có Bricks 2.4</strong><span>Chọn ZIP chính thức một lần để dùng cho mọi Fresh Install.</span></div></div>';
    const pluginReady = !!catalog.readiness?.duyanhwebpro_1_9_4;
    const pluginHash = String(catalog.readiness?.duyanhwebpro_1_9_4_sha256 || '');
    const pluginBytes = Number(catalog.readiness?.duyanhwebpro_1_9_4_bytes || 0);
    const pluginStatus = byId('freshDuyAnhStatus');
    if (pluginStatus) pluginStatus.innerHTML = pluginReady
      ? `<div class="fresh-ready ok"><i>✓</i><div><strong>Fallback 1.9.4 đã sẵn sàng</strong><span>${formatBytes(pluginBytes)} · SHA256 ${escapeHtml(pluginHash.slice(0,16))}…</span></div></div>`
      : '<div class="fresh-ready warn"><i>!</i><div><strong>Chưa có fallback local</strong><span>Không bắt buộc. Fast path vẫn tải plugin từ vendor updater.</span></div></div>';
    renderThemeReadiness();
  }

  function renderThemeReadiness() {
    const target = byId('freshThemeReadiness');
    const select = byId('freshTheme');
    if (!target || !select || !state.catalog) return;
    if (select.value === 'bricks') {
      target.innerHTML = state.catalog.readiness?.bricks_2_4
        ? '<span class="fresh-dot success"></span><span>Package Bricks 2.4 đã cache. Bricks Child được tạo server-side.</span>'
        : '<span class="fresh-dot warning"></span><span>Cần thêm ZIP Bricks 2.4 trước khi bấm cài.</span>';
      return;
    }
    if (select.value === 'wordpress-default') {
      target.innerHTML = '<span class="fresh-dot success"></span><span>Không cần upload private theme package.</span>';
      return;
    }
    target.innerHTML = '<span class="fresh-dot success"></span><span>Theme ZIP đã có trong Package Cache.</span>';
  }

  function taskActions(task) {
    const id = escapeHtml(task.id);
    const buttons = [];
    if (['failed','interrupted','ready'].includes(task.status)) buttons.push(`<button class="btn small" data-fresh-retry="${id}">Thử lại</button>`);
    if (task.status === 'completed') buttons.push(`<button class="btn small primary" data-fresh-copy="${id}">Sao chép wp-admin</button>`);
    if (task.status !== 'running') buttons.push(`<button class="btn small danger-outline" data-fresh-remove="${id}">Xóa lịch sử</button>`);
    return buttons.join('');
  }

  function renderTasks() {
    const list = byId('freshTaskList');
    if (!list) return;
    if (!state.tasks.length) {
      list.innerHTML = '<div class="empty">Chưa có Fresh Install task.</div>';
      return;
    }
    list.innerHTML = state.tasks.map(task => {
      const percent = Math.max(0, Math.min(100, Number(task.percent || (task.status === 'completed' ? 100 : 0))));
      const connection = task.connection
        ? `${escapeHtml(String(task.connection.protocol || '').toUpperCase())} · ${escapeHtml(task.connection.host || '')} · ${escapeHtml(task.connection.remotePath || '')}`
        : 'Đang chờ auto-discovery';
      const error = task.error ? `<div class="fresh-task-error"><strong>${escapeHtml(task.error_code || 'ERROR')}</strong><span>${escapeHtml(task.error)}</span></div>` : '';
      const detail = task.failure_detail?.blockingEntries?.length
        ? `<div class="fresh-blocking">Đang có: ${task.failure_detail.blockingEntries.slice(0,8).map(escapeHtml).join(', ')}</div>`
        : '';
      const logs = Array.isArray(task.logs) ? task.logs.slice(-4) : [];
      return `<article class="card fresh-task" data-task-id="${escapeHtml(task.id)}">
        <div class="fresh-task-top">
          <div><span class="fresh-task-status ${escapeHtml(task.status)}">${escapeHtml(statusLabel(task.status))}</span><strong>${escapeHtml(task.domain)}</strong><small>${connection}</small></div>
          <code>${escapeHtml(String(task.id).slice(0,8))}</code>
        </div>
        <div class="fresh-task-stage"><b>${escapeHtml(task.message || checkpointLabel(task.checkpoint))}</b><span>${escapeHtml(task.current || checkpointLabel(task.checkpoint))}</span></div>
        <div class="fresh-progress"><div><span style="width:${percent}%"></span></div><b>${percent}%</b></div>
        <div class="fresh-checkpoint"><span>Checkpoint</span><strong>${escapeHtml(checkpointLabel(task.checkpoint))}</strong><span>Attempt</span><strong>${Number(task.attempt_count || 0)}</strong></div>
        ${error}${detail}
        ${logs.length ? `<div class="fresh-task-logs">${logs.map(line => `<span>${escapeHtml(line)}</span>`).join('')}</div>` : ''}
        <div class="fresh-task-actions">${taskActions(task)}</div>
      </article>`;
    }).join('');

    list.querySelectorAll('[data-fresh-retry]').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        try { await freshApi.retryFreshInstall(button.dataset.freshRetry); await refresh(); }
        catch (error) { message(error.message || String(error),'error'); }
        finally { button.disabled = false; }
      };
    });
    list.querySelectorAll('[data-fresh-copy]').forEach(button => {
      button.onclick = async () => {
        try {
          const result = await freshApi.copyFreshInstallCredentials(button.dataset.freshCopy);
          message(`Đã sao chép tài khoản · ${result.wp_admin_url}`,'success');
        } catch (error) { message(error.message || String(error),'error'); }
      };
    });
    list.querySelectorAll('[data-fresh-remove]').forEach(button => {
      button.onclick = async () => {
        if (!confirm('Xóa task này khỏi lịch sử ChatCode? Website trên hosting không bị xóa.')) return;
        try { await freshApi.removeFreshInstall(button.dataset.freshRemove); await refresh(); }
        catch (error) { message(error.message || String(error),'error'); }
      };
    });
  }

  function schedulePoll() {
    clearTimeout(state.poll);
    if (state.tasks.some(task => task.status === 'running')) {
      state.poll = setTimeout(() => refresh().catch(() => {}), 1400);
    }
  }

  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      const [catalog,tasks] = await Promise.all([
        freshApi.freshInstallCatalog(),
        freshApi.listFreshInstalls()
      ]);
      state.catalog = catalog;
      state.tasks = tasks || [];
      renderCatalog();
      renderTasks();
      schedulePoll();
    } finally {
      state.refreshing = false;
    }
  }

  async function pickBricks() {
    try {
      const result = await freshApi.pickBricksPackage();
      if (!result) return;
      message('Đã thêm Bricks 2.4 vào Package Cache.','success');
      await refresh();
    } catch (error) { message(error.message || String(error),'error'); }
  }

  async function pickDuyAnh() {
    try {
      const result = await freshApi.pickDuyAnhPackage();
      if (!result) return;
      message('Đã thêm DuyAnhWebPro 1.9.4 fallback vào Package Cache.','success');
      await refresh();
    } catch (error) { message(error.message || String(error),'error'); }
  }

  async function pickTheme() {
    try {
      const result = await freshApi.pickThemePackage();
      if (!result) return;
      await refresh();
      const select = byId('freshTheme');
      if (select && [...select.options].some(option => option.value === result.id)) select.value = result.id;
      renderThemeReadiness();
      message(`Đã thêm theme ${result.slug || result.id} vào Package Cache.`,'success');
    } catch (error) { message(error.message || String(error),'error'); }
  }

  async function submit(event) {
    event.preventDefault();
    const button = byId('freshInstallSubmit');
    const themeSelect = byId('freshTheme');
    const option = themeSelect?.selectedOptions?.[0];
    const payload = {
      domain:byId('freshDomain').value,
      username:byId('freshUsername').value,
      password:byId('freshPassword').value,
      bricksLicenseKey:byId('freshBricksLicense').value,
      theme:{
        id:themeSelect?.value || 'bricks',
        version:option?.dataset?.version || (themeSelect?.value === 'bricks' ? '2.4' : '')
      }
    };
    button.disabled = true;
    button.textContent = 'Đang tạo task…';
    message('');
    try {
      const task = await freshApi.createFreshInstall(payload);
      byId('freshPassword').value = '';
      byId('freshBricksLicense').value = '';
      await freshApi.startFreshInstall(task.id);
      message(`Đã bắt đầu cài ${task.domain}.`,'success');
      await refresh();
    } catch (error) {
      message(error.message || String(error),'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Cài WordPress';
    }
  }

  function bind() {
    const form = byId('freshInstallForm');
    if (!form) return;
    form.addEventListener('submit',submit);
    byId('freshPickBricks').onclick = pickBricks;
    byId('freshPickDuyAnh').onclick = pickDuyAnh;
    byId('freshAddTheme').onclick = pickTheme;
    byId('freshRefresh').onclick = () => refresh().catch(error => message(error.message || String(error),'error'));
    byId('freshTheme').onchange = renderThemeReadiness;
    byId('freshTogglePassword').onclick = () => {
      const input = byId('freshPassword');
      input.type = input.type === 'password' ? 'text' : 'password';
      byId('freshTogglePassword').textContent = input.type === 'password' ? 'Hiện' : 'Ẩn';
    };
    freshApi.onFreshInstallChanged?.(() => {
      clearTimeout(state.poll);
      state.poll = setTimeout(() => refresh().catch(() => {}),250);
    });
    refresh().catch(error => message(error.message || String(error),'error'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',bind,{ once:true });
  else bind();
})();