(() => {
  if (window.__chatcodeBrowserPerformanceLoaded) return;
  window.__chatcodeBrowserPerformanceLoaded = true;

  const api = window.personalCode;
  if (!api?.browserPerformance || !api?.browserPerformanceSetMode) return;

  let snapshot = null;
  let busy = false;

  function ensureStyles() {
    if (document.getElementById('browserPerformanceStyles')) return;
    const style = document.createElement('style');
    style.id = 'browserPerformanceStyles';
    style.textContent = `
      .browser-performance-card{margin-top:16px}
      .browser-performance-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:16px}
      .browser-performance-head h3{margin:3px 0 5px}.browser-performance-head p{margin:0;color:var(--ui-muted);font-size:12px;line-height:1.55}
      .browser-performance-mode{display:flex;gap:4px;padding:3px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface-2);flex:none}
      .browser-performance-mode button{height:30px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:var(--ui-muted);font-size:11px;font-weight:600;cursor:pointer}
      .browser-performance-mode button.active{background:var(--ui-surface);color:var(--ui-text);box-shadow:0 1px 3px rgba(0,0,0,.12)}
      .browser-performance-mode button:disabled{opacity:.5;cursor:default}
      .browser-performance-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}
      .browser-performance-stat{min-width:0;padding:12px;border:1px solid var(--ui-border-soft);border-radius:9px;background:var(--ui-surface-2)}
      .browser-performance-stat span{display:block;margin-bottom:5px;color:var(--ui-faint);font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
      .browser-performance-stat strong{display:block;color:var(--ui-text);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .browser-performance-stat small{display:block;margin-top:4px;color:var(--ui-muted);font-size:10px;line-height:1.35}
      .browser-performance-details{display:grid;grid-template-columns:1fr 1fr;gap:0 18px;margin-top:4px;border-top:1px solid var(--ui-border-soft)}
      .browser-performance-detail{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--ui-border-soft);font-size:11px}
      .browser-performance-detail span{color:var(--ui-muted)}.browser-performance-detail strong{color:var(--ui-text);font-weight:600;text-align:right;overflow-wrap:anywhere}
      .browser-performance-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}
      .browser-performance-note{margin-top:12px;padding:10px 12px;border:1px solid var(--ui-border-soft);border-radius:8px;background:var(--ui-surface-2);color:var(--ui-muted);font-size:10.5px;line-height:1.55}
      .browser-performance-note.warning{border-color:rgba(218,164,60,.35);color:var(--ui-text-2)}
      .browser-performance-status{margin-left:auto;color:var(--ui-muted);font-size:10.5px}.browser-performance-status.error{color:var(--ui-danger)}
      @media(max-width:1050px){.browser-performance-grid{grid-template-columns:1fr 1fr}.browser-performance-details{grid-template-columns:1fr}.browser-performance-head{flex-direction:column}.browser-performance-status{width:100%;margin-left:0}}
    `;
    document.head.appendChild(style);
  }

  function ensureCard() {
    let card = document.getElementById('browserPerformanceCard');
    if (card) return card;
    const page = document.querySelector('#route-settings .page.narrow');
    if (!page) return null;
    card = document.createElement('article');
    card.id = 'browserPerformanceCard';
    card.className = 'card browser-performance-card';
    card.innerHTML = `
      <div class="browser-performance-head">
        <div><span class="eyebrow">BROWSER PERFORMANCE</span><h3>Hiệu năng trình duyệt</h3><p>Ưu tiên CPU, RAM, GPU rời và mạng cho Browser Workspace. Không thay đổi MCP, Fast Agent hay Project Scope.</p></div>
        <div class="browser-performance-mode" role="group" aria-label="Chế độ hiệu năng">
          <button type="button" data-browser-performance-mode="standard">Tiêu chuẩn</button>
          <button type="button" data-browser-performance-mode="maximum">Tối đa</button>
        </div>
      </div>
      <div class="browser-performance-grid">
        <div class="browser-performance-stat"><span>CPU</span><strong id="browserPerfCpu">—</strong><small id="browserPerfCpuMeta">Đang kiểm tra</small></div>
        <div class="browser-performance-stat"><span>RAM</span><strong id="browserPerfRam">—</strong><small id="browserPerfRamMeta">Đang kiểm tra</small></div>
        <div class="browser-performance-stat"><span>GPU</span><strong id="browserPerfGpu">—</strong><small id="browserPerfGpuMeta">Đang kiểm tra</small></div>
        <div class="browser-performance-stat"><span>LAN / QoS</span><strong id="browserPerfNetwork">—</strong><small id="browserPerfNetworkMeta">Đang kiểm tra</small></div>
      </div>
      <div class="browser-performance-details">
        <div class="browser-performance-detail"><span>Background throttling</span><strong id="browserPerfThrottle">—</strong></div>
        <div class="browser-performance-detail"><span>Tab giữ nóng trong RAM</span><strong id="browserPerfWarm">—</strong></div>
        <div class="browser-performance-detail"><span>GPU high-performance</span><strong id="browserPerfGpuSwitch">—</strong></div>
        <div class="browser-performance-detail"><span>GPU compositing</span><strong id="browserPerfCompositing">—</strong></div>
        <div class="browser-performance-detail"><span>Giới hạn tab</span><strong id="browserPerfTabs">—</strong></div>
        <div class="browser-performance-detail"><span>Bandwidth throttle</span><strong id="browserPerfBandwidth">—</strong></div>
        <div class="browser-performance-detail"><span>Windows QoS</span><strong id="browserPerfQos">—</strong></div>
        <div class="browser-performance-detail"><span>DSCP</span><strong id="browserPerfDscp">—</strong></div>
      </div>
      <div id="browserPerfRestart" class="browser-performance-note warning" style="display:none">GPU high-performance được cấu hình trước khi Chromium khởi động. Hãy thoát hoàn toàn và mở lại ChatCode để áp dụng thay đổi GPU.</div>
      <div class="browser-performance-note">QoS cần quyền Administrator một lần. ChatCode chỉ tạo policy cho chính executable của ứng dụng, không giới hạn bandwidth. Router/switch phải hỗ trợ DSCP thì ưu tiên mạng mới có thêm hiệu lực.</div>
      <div class="browser-performance-actions">
        <button id="browserPerfRefresh" class="btn" type="button">Làm mới chẩn đoán</button>
        <button id="browserPerfInstallQos" class="btn primary" type="button">Cài QoS ưu tiên</button>
        <button id="browserPerfRemoveQos" class="btn" type="button">Gỡ QoS</button>
        <span id="browserPerfStatus" class="browser-performance-status">Sẵn sàng</span>
      </div>`;
    const about = page.querySelector('.card.about');
    if (about) page.insertBefore(card, about);
    else page.appendChild(card);
    bind(card);
    return card;
  }

  function text(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value ?? '—');
  }

  function setStatus(value, error = false) {
    const node = document.getElementById('browserPerfStatus');
    if (!node) return;
    node.textContent = String(value || 'Sẵn sàng');
    node.classList.toggle('error', !!error);
  }

  function gpuLabel(gpu) {
    const device = gpu?.activeDevice;
    if (!device) return gpu?.switchActive ? 'GPU hiệu năng cao' : 'GPU hệ thống';
    return device.deviceString || device.vendorString || device.driverVendor || (device.vendorId != null ? `GPU ${device.vendorId}` : 'GPU hệ thống');
  }

  function render(value) {
    if (value && typeof value === 'object') snapshot = value;
    const s = snapshot || {};
    document.querySelectorAll('[data-browser-performance-mode]').forEach(button => {
      button.classList.toggle('active', button.dataset.browserPerformanceMode === s.mode);
      button.disabled = busy;
    });

    text('browserPerfCpu', s.cpu?.activePriority || 'NORMAL');
    text('browserPerfCpuMeta', s.maximum ? 'Tab active ưu tiên HIGH' : 'Ưu tiên hệ thống mặc định');
    text('browserPerfRam', s.memory?.keepTabsWarm ? 'Giữ tab nóng' : 'Tiêu chuẩn');
    text('browserPerfRamMeta', s.memory?.hardMemoryLimit ? 'Có giới hạn cứng' : 'Không đặt hard RAM limit');
    text('browserPerfGpu', gpuLabel(s.gpu));
    text('browserPerfGpuMeta', s.gpu?.switchActive ? 'Discrete GPU được ưu tiên' : 'Theo lựa chọn của hệ thống');

    const adapters = Array.isArray(s.network?.adapters) ? s.network.adapters : [];
    const adapter = adapters.find(item => item.linkSpeed) || adapters[0] || null;
    text('browserPerfNetwork', adapter?.linkSpeed || adapter?.name || 'Không xác định');
    text('browserPerfNetworkMeta', s.qos?.installed ? 'QoS đang hoạt động' : 'Chưa cài QoS ưu tiên');

    text('browserPerfThrottle', s.cpu?.backgroundThrottling === false ? 'Tắt' : 'Bật');
    text('browserPerfWarm', s.memory?.keepTabsWarm ? 'Có · không discard' : 'Theo Chromium');
    text('browserPerfGpuSwitch', s.gpu?.switchActive ? 'Đã bật' : 'Chưa bật');
    text('browserPerfCompositing', s.gpu?.features?.gpu_compositing || 'Không xác định');
    text('browserPerfTabs', s.maxTabs ? `${s.maxTabs} tab` : '—');
    text('browserPerfBandwidth', s.network?.bandwidthThrottle ? 'Có giới hạn' : 'Không giới hạn');
    text('browserPerfQos', s.qos?.installed ? `Đã cài · precedence ${s.qos?.precedence ?? 255}` : (s.qos?.supported === false ? 'Không khả dụng' : 'Chưa cài'));
    text('browserPerfDscp', s.qos?.installed ? String(s.qos?.dscp ?? s.qos?.policyDscp ?? 46) : '46 khi bật');

    const restart = document.getElementById('browserPerfRestart');
    if (restart) restart.style.display = s.gpu?.restartRequired ? 'block' : 'none';
    const install = document.getElementById('browserPerfInstallQos');
    const remove = document.getElementById('browserPerfRemoveQos');
    if (install) install.disabled = busy || s.qos?.supported === false || !!s.qos?.installed;
    if (remove) remove.disabled = busy || !s.qos?.installed;
  }

  async function refresh(message = 'Đang kiểm tra…') {
    if (busy) return;
    busy = true;
    render(snapshot);
    setStatus(message);
    try {
      snapshot = await api.browserPerformance();
      render(snapshot);
      setStatus('Sẵn sàng');
    } catch (error) {
      setStatus(error?.message || String(error), true);
    } finally {
      busy = false;
      render(snapshot);
    }
  }

  async function setMode(mode) {
    if (busy) return;
    busy = true;
    render(snapshot);
    setStatus('Đang áp dụng chế độ…');
    try {
      await api.browserPerformanceSetMode(mode);
      snapshot = await api.browserPerformance();
      render(snapshot);
      setStatus(mode === 'maximum' ? 'Đã bật Hiệu năng tối đa' : 'Đã chuyển về Tiêu chuẩn');
    } catch (error) {
      setStatus(error?.message || String(error), true);
    } finally {
      busy = false;
      render(snapshot);
    }
  }

  async function installQos() {
    if (busy) return;
    busy = true;
    render(snapshot);
    setStatus('Chờ xác nhận Administrator…');
    try {
      await api.browserPerformanceInstallQos();
      snapshot = await api.browserPerformance();
      render(snapshot);
      setStatus('Đã cài QoS ưu tiên');
    } catch (error) {
      setStatus(error?.message || 'Không thể cài QoS.', true);
    } finally {
      busy = false;
      render(snapshot);
    }
  }

  async function removeQos() {
    if (busy) return;
    busy = true;
    render(snapshot);
    setStatus('Chờ xác nhận Administrator…');
    try {
      await api.browserPerformanceRemoveQos();
      snapshot = await api.browserPerformance();
      render(snapshot);
      setStatus('Đã gỡ QoS');
    } catch (error) {
      setStatus(error?.message || 'Không thể gỡ QoS.', true);
    } finally {
      busy = false;
      render(snapshot);
    }
  }

  function bind(card) {
    card.querySelectorAll('[data-browser-performance-mode]').forEach(button => {
      button.addEventListener('click', () => setMode(button.dataset.browserPerformanceMode));
    });
    document.getElementById('browserPerfRefresh')?.addEventListener('click', () => refresh());
    document.getElementById('browserPerfInstallQos')?.addEventListener('click', installQos);
    document.getElementById('browserPerfRemoveQos')?.addEventListener('click', removeQos);
  }

  function mount() {
    ensureStyles();
    if (!ensureCard()) return;
    refresh();
  }

  mount();
})();
