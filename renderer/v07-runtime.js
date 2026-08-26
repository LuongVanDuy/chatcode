(() => {
  const api = window.personalCode;
  if (!api || window.__chatcodeV07Loaded) return;
  window.__chatcodeV07Loaded = true;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const time = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('vi-VN', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' }); };
  const bytes = value => { const n=Number(value||0); if(n<1024)return `${n} B`; if(n<1048576)return `${(n/1024).toLocaleString('vi-VN',{maximumFractionDigits:1})} KB`; return `${(n/1048576).toLocaleString('vi-VN',{maximumFractionDigits:1})} MB`; };
  const state = { approvals: [], backups: [], update: null, settings: null, currentProjectId: '' };

  function toast(message, type='success') {
    const host = $('toastContainer') || document.body;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 220); }, 3200);
  }

  function addCss() {
    if (document.querySelector('link[data-v07]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'v07.css'; link.dataset.v07 = '1';
    document.head.appendChild(link);
  }

  function mountShell() {
    addCss();
    const badge = document.querySelector('.version-badge'); if (badge) badge.textContent = 'v0.7';
    const nav = document.querySelector('.sidebar .nav');
    if (nav && !$('v07SafetyNav')) {
      const btn = document.createElement('button');
      btn.id='v07SafetyNav'; btn.className='nav-link'; btn.dataset.v07Route='safety';
      btn.innerHTML='<span>◇</span>Safety Center<b id="approvalBadge" class="nav-badge hidden">0</b>';
      const activity = [...nav.querySelectorAll('.nav-link')].find(x => x.dataset.route === 'activity');
      nav.insertBefore(btn, activity || null);
    }
    const healthGrid = document.querySelector('.health-grid');
    if (healthGrid && !$('healthSafety')) {
      healthGrid.classList.add('five');
      healthGrid.insertAdjacentHTML('beforeend','<article class="health-card clickable" data-v07-route="safety"><div><span>SAFETY</span><strong id="healthSafety">Không chờ duyệt</strong></div><i id="healthSafetyDot" class="dot success"></i><small id="healthSafetyMeta">Recovery + approval</small></article>');
    }
    const heroActions = document.querySelector('.hero .row');
    if (heroActions && !heroActions.querySelector('[data-v07-route=safety]')) heroActions.insertAdjacentHTML('beforeend','<button class="btn" data-v07-route="safety">Safety Center</button>');
    mountSafetyRoute(); mountSettings(); mountProjectSafety(); mountApprovalModal(); mountConnectionExtra();
  }

  function mountSafetyRoute() {
    const content = document.querySelector('.content');
    if (!content || $('route-safety')) return;
    content.insertAdjacentHTML('beforeend', `
      <section id="route-safety" class="route"><div class="page">
        <div class="page-head"><div><span class="eyebrow">SAFETY CENTER</span><h2>Kiểm soát thao tác của AI</h2><p>Action ở chế độ “Hỏi” sẽ dừng tối đa 90 giây để chờ bạn duyệt.</p></div><div class="row"><button id="clearApprovalSession" class="btn">Xóa quyền trong phiên</button><button id="refreshSafety" class="btn">Làm mới</button></div></div>
        <div class="safety-summary-grid"><article class="safety-summary"><span>CHỜ DUYỆT</span><strong id="safetyPending">0</strong><small>Tool call đang chờ</small></article><article class="safety-summary"><span>RECOVERY</span><strong id="safetyBackups">0</strong><small>Snapshot cục bộ</small></article><article class="safety-summary"><span>TIMEOUT</span><strong id="safetyTimeout">60s</strong><small>Tự từ chối khi hết hạn</small></article><article class="safety-summary"><span>BACKUP</span><strong id="safetyBackupMode">Bật</strong><small>Trước overwrite/delete/rename</small></article></div>
        <div class="two-col"><article class="card"><div class="card-head"><div><span class="eyebrow">APPROVAL QUEUE</span><h3>Yêu cầu đang chờ</h3></div></div><div id="approvalList" class="approval-list"></div></article><article class="card"><div class="card-head"><div><span class="eyebrow">RECOVERY</span><h3>Khôi phục file gần đây</h3></div><button id="clearRecovery" class="link-btn danger">Xóa tất cả</button></div><div id="backupList" class="backup-list"></div></article></div>
        <article class="card"><div class="card-head"><div><span class="eyebrow">CONFIG BACKUP</span><h3>Sao lưu / khôi phục cấu hình</h3><p>Không xuất Tunnel Token hoặc MCP secret ra file JSON.</p></div><div class="row"><button id="exportConfig" class="btn">Sao lưu cấu hình</button><button id="importConfig" class="btn">Khôi phục cấu hình</button></div></div><div class="note">Backup chứa danh sách project, permissions, Safety Rules, domain và cài đặt công khai. Secret của máy hiện tại luôn được giữ nguyên khi import.</div></article>
      </div></section>`);
  }

  function mountSettings() {
    const list = document.querySelector('#route-settings .settings-list');
    if (list && !$('settingBackup')) {
      list.insertAdjacentHTML('beforeend', '<label class="setting"><div><strong>Tự tạo recovery snapshot</strong><span>Backup file trước overwrite, delete hoặc rename từ MCP/AI.</span></div><input id="settingBackup" type="checkbox"></label><label class="setting"><div><strong>Tự kiểm tra cập nhật</strong><span>Kiểm tra GitHub Releases tối đa khoảng 2 lần/ngày.</span></div><input id="settingAutoUpdate" type="checkbox"></label><label class="setting"><div><strong>Timeout chờ phê duyệt</strong><span>Nếu không phản hồi, action tự bị từ chối.</span></div><select id="settingApprovalTimeout"><option value="30">30 giây</option><option value="60">60 giây</option><option value="90">90 giây</option></select></label>');
    }
    const about = document.querySelector('#route-settings .about');
    if (about && !$('v07UpdateCard')) about.insertAdjacentHTML('beforebegin', '<article id="v07UpdateCard" class="card update-card"><div class="card-head"><div><span class="eyebrow">UPDATE</span><h3>Cập nhật ứng dụng</h3><p id="updateText">Nguồn cập nhật: GitHub Releases.</p></div><span id="updateState" class="update-state">Chưa kiểm tra</span></div><div class="update-progress hidden" id="updateProgress"><i id="updateProgressBar"></i></div><div class="row"><button id="checkUpdate" class="btn">Kiểm tra cập nhật</button><button id="downloadUpdate" class="btn primary hidden">Tải bản mới</button><button id="installUpdate" class="btn primary hidden">Cài bản đã tải</button></div></article>');
  }

  function mountProjectSafety() {
    const tab = $('project-tab-permissions');
    if (!tab || $('v07SafetyRules')) return;
    tab.insertAdjacentHTML('beforeend', `<article id="v07SafetyRules" class="card safety-rules-card" style="margin-top:18px"><div class="card-head"><div><span class="eyebrow">SAFETY RULES</span><h3>Khi nào ChatGPT phải hỏi bạn?</h3><p>Cho phép = chạy ngay · Hỏi = Approval Center · Chặn = luôn từ chối.</p></div><button id="saveSafety" class="btn primary">Lưu Safety Rules</button></div><div class="safety-rule-grid">
      ${[['safeWrite','Ghi / thay thế file'],['safeRename','Rename / move'],['safeDelete','Xóa file'],['safeTask','Chạy task'],['safeGitStage','Git stage'],['safeGitCommit','Git commit']].map(([id,label])=>`<label><span>${label}</span><select id="${id}"><option value="allow">Cho phép</option><option value="ask">Hỏi xác nhận</option><option value="deny">Chặn</option></select></label>`).join('')}
    </div></article>`);
  }

  function mountApprovalModal() {
    if ($('approvalOverlay')) return;
    document.body.insertAdjacentHTML('beforeend', '<div id="approvalOverlay" class="approval-overlay hidden" role="dialog" aria-modal="true"><div class="approval-modal"><div class="approval-mark">!</div><div><span class="eyebrow">CHATGPT ĐANG CHỜ</span><h2 id="approvalModalTitle">Cần xác nhận thao tác</h2><p id="approvalModalProject">—</p></div><div class="approval-target"><span>Mục tiêu</span><strong id="approvalModalTarget">—</strong><small id="approvalModalDetail"></small></div><div class="approval-actions"><button id="approvalDeny" class="btn danger-outline">Từ chối</button><button id="approvalOnce" class="btn">Cho phép 1 lần</button><button id="approvalSession" class="btn">Cho phép phiên này</button><button id="approvalAlways" class="btn primary">Luôn cho phép</button></div><small id="approvalExpiry" class="approval-expiry">Yêu cầu sẽ tự hết hạn.</small></div></div>');
  }

  function mountConnectionExtra() {
    const list = document.querySelector('#route-connection .detail-list');
    if (list && !$('detailRotated')) list.insertAdjacentHTML('beforeend','<div><span>Secret đổi gần nhất</span><strong id="detailRotated">Chưa ghi nhận</strong></div>');
  }

  function showSafety() {
    document.querySelectorAll('.route').forEach(x => x.classList.toggle('active', x.id === 'route-safety'));
    document.querySelectorAll('.nav-link').forEach(x => x.classList.remove('active'));
    $('v07SafetyNav')?.classList.add('active');
    if ($('pageEyebrow')) $('pageEyebrow').textContent='SAFETY CENTER';
    if ($('pageTitle')) $('pageTitle').textContent='Kiểm soát AI';
    if ($('pageSubtitle')) $('pageSubtitle').textContent='Phê duyệt action nhạy cảm, recovery snapshot và backup cấu hình.';
    refreshSafety();
  }

  function renderApprovals() {
    const list = state.approvals || [];
    $('approvalBadge')?.classList.toggle('hidden', !list.length);
    if ($('approvalBadge')) $('approvalBadge').textContent=String(list.length);
    if ($('healthSafety')) $('healthSafety').textContent=list.length ? `${list.length} chờ duyệt` : 'Không chờ duyệt';
    if ($('healthSafetyDot')) $('healthSafetyDot').className=`dot ${list.length?'warning':'success'}`;
    if ($('healthSafetyMeta')) $('healthSafetyMeta').textContent=list.length ? 'ChatGPT đang chờ phản hồi' : 'Recovery + approval';
    if ($('safetyPending')) $('safetyPending').textContent=String(list.length);
    if ($('approvalList')) $('approvalList').innerHTML=list.length ? list.map(item=>`<div class="approval-item pending"><div class="approval-item-head"><div><strong>${esc(item.actionLabel)}</strong><p>${esc(item.project)} · ${esc(item.target||'')}</p></div><small>${time(item.createdAt)}</small></div><p>${esc(item.detail||'')}</p><div class="approval-item-actions"><button class="btn small danger-outline" data-approval="${esc(item.id)}" data-decision="deny">Từ chối</button><button class="btn small" data-approval="${esc(item.id)}" data-decision="allow-once">Cho phép 1 lần</button><button class="btn small" data-approval="${esc(item.id)}" data-decision="allow-session">Phiên này</button><button class="btn small primary" data-approval="${esc(item.id)}" data-decision="allow-always">Luôn cho phép</button></div></div>`).join('') : '<div class="empty">Không có yêu cầu đang chờ.</div>';
    renderApprovalModal();
  }

  function renderApprovalModal() {
    const item = state.approvals?.[0]; const overlay=$('approvalOverlay'); if(!overlay)return;
    overlay.classList.toggle('hidden', !item);
    if(!item)return;
    $('approvalModalTitle').textContent=item.actionLabel||item.action;
    $('approvalModalProject').textContent=item.project||'';
    $('approvalModalTarget').textContent=item.target||'—';
    $('approvalModalDetail').textContent=item.detail||'';
    $('approvalExpiry').textContent=`Tự hết hạn: ${time(item.expiresAt)}`;
  }

  function renderBackups() {
    const list=state.backups||[];
    if($('safetyBackups'))$('safetyBackups').textContent=String(list.length);
    if($('backupList'))$('backupList').innerHTML=list.length?list.slice(0,80).map(item=>`<div class="backup-item"><div class="backup-item-head"><div><strong>${esc(item.path)}</strong><p>${esc(item.project)} · ${esc(item.reason)}</p></div><small>${time(item.createdAt)}</small></div><p>${bytes(item.size)}</p><div class="backup-item-actions"><button class="btn small primary" data-restore="${esc(item.id)}">Khôi phục</button><button class="btn small danger-outline" data-remove-backup="${esc(item.id)}">Xóa snapshot</button></div></div>`).join(''):'<div class="empty">Chưa có recovery snapshot.</div>';
  }

  function renderSettings() {
    const s=state.settings||{};
    if($('settingBackup'))$('settingBackup').checked=!!s.backupBeforeChanges;
    if($('settingAutoUpdate'))$('settingAutoUpdate').checked=!!s.autoUpdateCheck;
    if($('settingApprovalTimeout'))$('settingApprovalTimeout').value=String(s.approvalTimeoutSec||60);
    if($('safetyTimeout'))$('safetyTimeout').textContent=`${s.approvalTimeoutSec||60}s`;
    if($('safetyBackupMode'))$('safetyBackupMode').textContent=s.backupBeforeChanges?'Bật':'Tắt';
  }

  function renderUpdate() {
    const u=state.update||{}; if(!$('updateState'))return;
    const labels={idle:'Chưa kiểm tra',checking:'Đang kiểm tra','no-release':'Chưa có Release','up-to-date':'Đã mới nhất',available:'Có bản mới','available-no-asset':'Có Release mới',downloading:'Đang tải',downloaded:'Đã tải',installing:'Đang cài',error:'Lỗi'};
    $('updateState').textContent=labels[u.state]||u.state||'Chưa kiểm tra';
    $('updateText').textContent=u.error|| (u.latestVersion?`Hiện tại ${u.currentVersion} · mới nhất ${u.latestVersion}`:'Nguồn cập nhật: GitHub Releases.');
    $('downloadUpdate')?.classList.toggle('hidden',u.state!=='available');
    $('installUpdate')?.classList.toggle('hidden',u.state!=='downloaded');
    const downloading=u.state==='downloading'; $('updateProgress')?.classList.toggle('hidden',!downloading);
    if(downloading&&$('updateProgressBar'))$('updateProgressBar').style.width=`${u.totalBytes?Math.min(100,u.downloadedBytes/u.totalBytes*100):10}%`;
  }

  async function renderProjectSafety() {
    const active=document.querySelector('.project-item.active');
    const projectId=active?.dataset.project || state.currentProjectId;
    if(!projectId)return;
    state.currentProjectId=projectId;
    try{
      const projects=await api.listProjects(); const p=projects.find(x=>x.id===projectId); if(!p)return;
      const s=p.safety||{};
      const mapping={safeWrite:'write',safeRename:'rename',safeDelete:'delete',safeTask:'task',safeGitStage:'gitStage',safeGitCommit:'gitCommit'};
      for(const [id,key] of Object.entries(mapping))if($(id))$(id).value=s[key]||({write:'allow',gitStage:'allow'}[key]||'ask');
    }catch{}
  }

  async function refreshSafety() {
    try {
      const [approvals,backups,settings,update,cfg]=await Promise.all([api.listApprovals(),api.listBackups(''),api.getSettings(),api.updateStatus(),api.connectionConfig()]);
      state.approvals=approvals;state.backups=backups;state.settings=settings;state.update=update;
      renderApprovals();renderBackups();renderSettings();renderUpdate();
      if($('detailRotated'))$('detailRotated').textContent=time(cfg.tokenRotatedAt);
    } catch(error) { toast(error.message||String(error),'error'); }
  }

  async function respond(id,decision){try{await api.respondApproval(id,decision);state.approvals=await api.listApprovals();renderApprovals();if(decision==='allow-always')setTimeout(renderProjectSafety,150);toast(decision==='deny'?'Đã từ chối thao tác':'Đã phê duyệt thao tác',decision==='deny'?'error':'success')}catch(error){toast(error.message||String(error),'error')}}
  async function saveProjectSafety(){const active=document.querySelector('.project-item.active');const id=active?.dataset.project||state.currentProjectId;if(!id)return toast('Hãy chọn dự án trước.','error');try{await api.updateSafety(id,{write:$('safeWrite').value,rename:$('safeRename').value,delete:$('safeDelete').value,task:$('safeTask').value,gitStage:$('safeGitStage').value,gitCommit:$('safeGitCommit').value});toast('Đã lưu Safety Rules')}catch(error){toast(error.message||String(error),'error')}}
  async function saveNewSetting(patch){try{state.settings=await api.updateSettings(patch);renderSettings();toast('Đã lưu cài đặt')}catch(error){toast(error.message||String(error),'error')}}

  document.addEventListener('click', async event => {
    const route=event.target.closest('[data-v07-route]'); if(route){event.preventDefault();showSafety();return;}
    const approval=event.target.closest('[data-approval]');if(approval){await respond(approval.dataset.approval,approval.dataset.decision);return;}
    const restore=event.target.closest('[data-restore]');if(restore){if(!confirm('Khôi phục snapshot này và ghi đè file hiện tại?'))return;try{const r=await api.restoreBackup(restore.dataset.restore);toast(`Đã khôi phục ${r.path}`);state.backups=await api.listBackups('');renderBackups()}catch(error){toast(error.message||String(error),'error')}return;}
    const remove=event.target.closest('[data-remove-backup]');if(remove){try{await api.removeBackup(remove.dataset.removeBackup);state.backups=await api.listBackups('');renderBackups()}catch(error){toast(error.message||String(error),'error')}return;}
    if(event.target.closest('[data-project], [data-dproject], [data-project-tab="permissions"]'))setTimeout(renderProjectSafety,180);
  });

  function bind() {
    $('refreshSafety')?.addEventListener('click',refreshSafety);
    $('clearApprovalSession')?.addEventListener('click',async()=>{await api.clearApprovalSession();toast('Đã xóa quyền tạm trong phiên')});
    $('clearRecovery')?.addEventListener('click',async()=>{if(!confirm('Xóa toàn bộ recovery snapshot?'))return;await api.clearBackups('');state.backups=[];renderBackups();toast('Đã xóa recovery snapshot')});
    $('exportConfig')?.addEventListener('click',async()=>{try{const r=await api.exportConfig();if(r)toast(`Đã sao lưu ${r.projectCount} dự án`)}catch(error){toast(error.message||String(error),'error')}});
    $('importConfig')?.addEventListener('click',async()=>{if(!confirm('Khôi phục sẽ thay danh sách project và cài đặt công khai. Secret hiện tại được giữ nguyên. Tiếp tục?'))return;try{const r=await api.importConfig();if(r){toast(`Đã khôi phục ${r.projectCount} dự án`);setTimeout(()=>location.reload(),700)}}catch(error){toast(error.message||String(error),'error')}});
    $('saveSafety')?.addEventListener('click',saveProjectSafety);
    $('settingBackup')?.addEventListener('change',e=>saveNewSetting({backupBeforeChanges:e.target.checked}));
    $('settingAutoUpdate')?.addEventListener('change',e=>saveNewSetting({autoUpdateCheck:e.target.checked}));
    $('settingApprovalTimeout')?.addEventListener('change',e=>saveNewSetting({approvalTimeoutSec:Number(e.target.value)}));
    $('checkUpdate')?.addEventListener('click',async()=>{try{state.update=await api.checkUpdate();renderUpdate();toast(state.update.state==='available'?'Có bản cập nhật mới':'Đã kiểm tra cập nhật')}catch(error){toast(error.message||String(error),'error')}});
    $('downloadUpdate')?.addEventListener('click',async()=>{try{state.update=await api.downloadUpdate();renderUpdate();toast('Đã tải installer mới')}catch(error){toast(error.message||String(error),'error')}});
    $('installUpdate')?.addEventListener('click',async()=>{if(!confirm('Mở installer bản mới và thoát ChatCode?'))return;try{await api.installUpdate()}catch(error){toast(error.message||String(error),'error')}});
    $('approvalDeny')?.addEventListener('click',()=>state.approvals[0]&&respond(state.approvals[0].id,'deny'));
    $('approvalOnce')?.addEventListener('click',()=>state.approvals[0]&&respond(state.approvals[0].id,'allow-once'));
    $('approvalSession')?.addEventListener('click',()=>state.approvals[0]&&respond(state.approvals[0].id,'allow-session'));
    $('approvalAlways')?.addEventListener('click',()=>state.approvals[0]&&respond(state.approvals[0].id,'allow-always'));
    $('rotateSecret')?.addEventListener('click',()=>setTimeout(refreshSafety,1200));
    api.onApprovalChanged(list=>{state.approvals=list;renderApprovals()});
    api.onApprovalAttention(()=>{setTimeout(refreshSafety,50)});
    api.onBackupsChanged(async()=>{state.backups=await api.listBackups('');renderBackups()});
    api.onUpdateChanged(value=>{state.update=value;renderUpdate()});
  }

  mountShell(); bind(); refreshSafety(); setTimeout(renderProjectSafety,400);
})();
