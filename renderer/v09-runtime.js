(() => {
  const api = window.personalCode;
  if (!api || window.__chatcodeV09Loaded) return;
  window.__chatcodeV09Loaded = true;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const time = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('vi-VN', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' }); };
  let saveTimer = null;

  function css() {
    if (document.querySelector('link[data-v09]')) return;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'v09.css'; link.dataset.v09 = '1'; document.head.appendChild(link);
  }

  function panel() {
    const page = document.querySelector('#route-settings .page');
    if (!page || document.getElementById('supportJournal')) return;
    const about = page.querySelector('.about');
    const card = document.createElement('article');
    card.id = 'supportJournal'; card.className = 'card support-journal';
    card.innerHTML = `
      <div class="card-head support-head">
        <div><span class="eyebrow">SUPPORT JOURNAL</span><h3>Ghi chú lỗi & Terminal Audit</h3><p>Ghi lại lỗi trong lúc làm việc. Process log chỉ lưu metadata đã che secret, không lưu stdout/stderr hay nội dung file.</p></div>
        <span id="supportSaveState" class="support-save-state">Đã lưu</span>
      </div>
      <textarea id="supportNote" class="support-note" rows="7" maxlength="24000" placeholder="Ví dụ: 22:15 — mở project X, terminal đen nháy 1 lần khi reconnect...\n22:21 — context checkout ưu tiên sai file..."></textarea>
      <div class="support-actions">
        <button id="supportSave" class="btn primary"><i data-lucide="save"></i>Lưu ghi chú</button>
        <button id="supportMarkTerminal" class="btn danger-outline"><i data-lucide="scan-line"></i>Vừa thấy terminal nháy</button>
        <button id="supportOpenFolder" class="btn"><i data-lucide="folder-open"></i>Mở thư mục log</button>
        <button id="supportCopy" class="btn"><i data-lucide="clipboard-copy"></i>Copy báo cáo</button>
        <button id="supportGitHub" class="btn"><i data-lucide="github"></i>Gửi lên GitHub</button>
      </div>
      <div class="support-event-head"><strong>Process gần nhất</strong><span id="supportEventCount">0 event</span></div>
      <div id="supportEvents" class="support-events"><div class="empty">Chưa có process event.</div></div>`;
    if (about) page.insertBefore(card, about); else page.appendChild(card);
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  async function saveNote(silent = false) {
    const box = document.getElementById('supportNote'), state = document.getElementById('supportSaveState');
    if (!box) return;
    try {
      if (state) state.textContent = 'Đang lưu…';
      await api.saveSupportNote(box.value);
      if (state) state.textContent = silent ? 'Tự động lưu' : 'Đã lưu';
    } catch (error) { if (state) state.textContent = `Lỗi lưu: ${String(error?.message || error).slice(0,80)}`; }
  }

  async function renderEvents() {
    const host = document.getElementById('supportEvents'), count = document.getElementById('supportEventCount');
    if (!host) return;
    try {
      const events = await api.supportEvents(18);
      if (count) count.textContent = `${events.length} event gần nhất`;
      if (!events.length) { host.innerHTML = '<div class="empty">Chưa có process event.</div>'; return; }
      host.innerHTML = events.map(item => {
        const marker = item.type === 'terminal-flash-marker';
        const status = marker ? 'MARK' : String(item.phase || 'event').toUpperCase();
        const detail = marker ? (item.note || 'Terminal vừa nháy') : `${item.source || 'process'} · ${item.executable || 'unknown'}${item.durationMs ? ` · ${item.durationMs} ms` : ''}`;
        return `<div class="support-event ${marker ? 'marker' : item.consoleRisk ? 'risk' : ''}"><span>${time(item.at)}</span><b>${escapeHtml(status)}</b><code>${escapeHtml(detail)}</code><small>${marker ? 'người dùng đánh dấu' : item.windowsHide ? 'hidden' : 'visible/default'}</small></div>`;
      }).join('');
    } catch (error) { host.innerHTML = `<div class="empty">Không đọc được process log: ${escapeHtml(error?.message || error)}</div>`; }
  }

  async function init() {
    css(); panel();
    const box = document.getElementById('supportNote');
    if (!box) return;
    try { box.value = await api.supportNote(); } catch {}
    box.addEventListener('input', () => {
      const state = document.getElementById('supportSaveState'); if (state) state.textContent = 'Chưa lưu';
      clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNote(true), 900);
    });
    document.getElementById('supportSave')?.addEventListener('click', () => saveNote(false));
    document.getElementById('supportMarkTerminal')?.addEventListener('click', async () => {
      try { await api.markTerminalFlash('Người dùng bấm “Vừa thấy terminal nháy” trong Support Journal.'); await renderEvents(); const state=document.getElementById('supportSaveState'); if(state)state.textContent='Đã đánh dấu timestamp'; } catch {}
    });
    document.getElementById('supportOpenFolder')?.addEventListener('click', () => api.openSupportFolder().catch(() => {}));
    document.getElementById('supportCopy')?.addEventListener('click', async () => { await saveNote(true); await api.copySupportReport(); const state=document.getElementById('supportSaveState'); if(state)state.textContent='Đã copy support report'; });
    document.getElementById('supportGitHub')?.addEventListener('click', async () => { await saveNote(true); await api.openSupportGitHubIssue(); });
    await renderEvents();
    setInterval(() => { if (document.getElementById('route-settings')?.classList.contains('active')) renderEvents(); }, 12000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
})();
