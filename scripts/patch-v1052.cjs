const fs = require('fs');
const path = require('path');

function load(file) { return fs.readFileSync(file, 'utf8'); }
function save(file, text) { fs.writeFileSync(file, text, 'utf8'); }
function replaceOnce(text, find, replace, label) {
  const count = text.split(find).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one marker, got ${count}`);
  return text.replace(find, replace);
}
function replaceBetween(text, start, end, replacement, label) {
  const a = text.indexOf(start);
  if (a < 0) throw new Error(`${label}: start marker missing`);
  const b = text.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`${label}: end marker missing`);
  return text.slice(0, a) + replacement + text.slice(b);
}
function patch(file, fn) { const before = load(file); const after = fn(before); if (before === after) throw new Error(`${file}: no change`); save(file, after); }

patch('core/store.js', text => {
  text = replaceOnce(text,
    "  const workspaceMode = raw?._workspaceMode === 'trusted' ? 'trusted' : 'safe';",
    "  const requestedMode = String(raw?._workspaceMode || 'safe');\n  const workspaceMode = requestedMode === 'machine' ? 'machine' : requestedMode === 'trusted' ? 'trusted' : 'safe';",
    'store workspace mode');
  text = replaceOnce(text,
    "    _allowSecrets: workspaceMode === 'trusted' && !!raw?._allowSecrets,",
    "    _allowSecrets: workspaceMode === 'machine' || (workspaceMode === 'trusted' && !!raw?._allowSecrets),",
    'store secrets');
  text = replaceOnce(text,
    "  if (workspaceMode === 'trusted') {",
    "  if (workspaceMode !== 'safe') {",
    'store allow rules');
  text = replaceOnce(text,
    "      const permissions = workspaceMode === 'trusted' ? { ...FULL_PERMISSIONS } : rawPermissions;",
    "      const permissions = workspaceMode !== 'safe' ? { ...FULL_PERMISSIONS } : rawPermissions;",
    'store permissions');
  text = replaceOnce(text,
    "        trusted: { allowSecrets:workspaceMode === 'trusted' && !!safety._allowSecrets, allowGitPush:false },",
    "        trusted: { allowSecrets:workspaceMode === 'machine' || (workspaceMode === 'trusted' && !!safety._allowSecrets), allowGitPush:workspaceMode === 'machine' },",
    'store trusted shape');
  return text;
});

patch('core/trusted-workspace.js', text => {
  text = replaceOnce(text,
    "const isTrusted = project => project?.workspaceMode === 'trusted' || project?.safety?._workspaceMode === 'trusted';",
    "const isTrusted = project => ['trusted','machine'].includes(project?.workspaceMode) || ['trusted','machine'].includes(project?.safety?._workspaceMode);",
    'trusted isTrusted');
  text = replaceOnce(text,
    "const canUseSecrets = project => isTrusted(project) && !!(project?.trusted?.allowSecrets || project?.safety?._allowSecrets);",
    "const canUseSecrets = project => project?.workspaceMode === 'machine' || project?.safety?._workspaceMode === 'machine' || (isTrusted(project) && !!(project?.trusted?.allowSecrets || project?.safety?._allowSecrets));",
    'trusted secrets');
  text = replaceOnce(text,
    "      safety_mode:project.workspaceMode === 'trusted' ? 'trusted_workspace_no_per_action_approval' : 'safe_rules'",
    "      safety_mode:project.workspaceMode === 'machine' ? 'full_machine_no_scope_or_approval' : project.workspaceMode === 'trusted' ? 'trusted_workspace_no_per_action_approval' : 'safe_rules'",
    'trusted list shape');
  return text;
});

patch('core/terminal-runtime.js', text => {
  text = replaceOnce(text,
    "const { powershellInvocation } = require('./windows-terminal-guard');",
    "const { powershellInvocation } = require('./windows-terminal-guard');\nconst { isMachine, assertGuardian } = require('./machine-access');",
    'terminal import');
  text = replaceOnce(text,
    "function isTrusted(project) {\n  return project?.workspaceMode === 'trusted' || project?.safety?._workspaceMode === 'trusted';\n}",
    "function isTrusted(project) {\n  return isMachine(project) || project?.workspaceMode === 'trusted' || project?.safety?._workspaceMode === 'trusted';\n}",
    'terminal trusted');
  text = replaceOnce(text,
    "      terminal:{ hidden:true, shell:job.shell, cwd_inside_project:true, os_filesystem_sandbox:false },\n      approval:{ required:false, status:'not_required', approval_id:null, mode:'trusted_workspace' }",
    "      terminal:{ hidden:true, shell:job.shell, cwd_inside_project:!job.machineMode, os_filesystem_sandbox:false, machine_scope:!!job.machineMode },\n      approval:{ required:false, status:'not_required', approval_id:null, mode:job.machineMode ? 'full_machine_access' : 'trusted_workspace' }",
    'terminal public metadata');
  text = replaceOnce(text,
    "  async function resolveCwd(project, requested) {\n    const rel = String(requested || '').trim().replace(/\\\\/g, '/') || '.';\n    const target = await projects.secureResolve(project, rel, { mustExist:true });\n    const stat = await fsp.stat(target);\n    if (!stat.isDirectory()) throw chatError('FILE_NOT_FOUND', 'cwd phải là một thư mục tồn tại bên trong project.', { cwd:rel });\n    return { abs:target, rel:rel === '.' ? '.' : rel.replace(/^\\.\\//, '') };\n  }",
    "  async function resolveCwd(project, requested) {\n    const raw = String(requested || '').trim() || '.';\n    if (isMachine(project)) {\n      const target = path.isAbsolute(raw) || (process.platform === 'win32' && path.win32.isAbsolute(raw)) ? path.normalize(raw) : path.resolve(project.root, raw);\n      const stat = await fsp.stat(target).catch(() => null);\n      if (!stat || !stat.isDirectory()) throw chatError('FILE_NOT_FOUND', 'cwd phải là một thư mục tồn tại trên máy.', { cwd:raw, resolved:target });\n      return { abs:target, rel:target };\n    }\n    const rel = raw.replace(/\\\\/g, '/');\n    const target = await projects.secureResolve(project, rel, { mustExist:true });\n    const stat = await fsp.stat(target);\n    if (!stat.isDirectory()) throw chatError('FILE_NOT_FOUND', 'cwd phải là một thư mục tồn tại bên trong project.', { cwd:rel });\n    return { abs:target, rel:rel === '.' ? '.' : rel.replace(/^\\.\\//, '') };\n  }",
    'terminal cwd');
  text = replaceOnce(text,
    "    if (!isTrusted(project)) throw chatError('PERMISSION_DENIED', 'Generic exec chỉ khả dụng khi project ở Trusted Workspace.', { project:project.name, required_workspace_mode:'trusted' });\n    const command = commandGuard(commandInput);\n    const running = [...jobs.values()].filter(job => job.projectId === project.id && ['running','stopping'].includes(job.status)).length;\n    if (running >= MAX_RUNNING_PER_PROJECT) throw chatError('TASK_NOT_ALLOWED', `Project đang có ${running} terminal job chạy nền. Hãy dừng job cũ trước.`, { limit:MAX_RUNNING_PER_PROJECT });",
    "    if (!isTrusted(project)) throw chatError('PERMISSION_DENIED', 'Generic exec chỉ khả dụng khi project ở Trusted Workspace hoặc Full Machine Access.', { project:project.name, required_workspace_mode:'trusted_or_machine' });\n    const machineMode = isMachine(project);\n    if (machineMode) assertGuardian();\n    const rawCommand = String(commandInput || '').trim();\n    if (!rawCommand) throw chatError('TASK_NOT_ALLOWED', 'Command không được để trống.');\n    if (rawCommand.length > 16000) throw chatError('TASK_NOT_ALLOWED', 'Command quá dài.', { length:rawCommand.length });\n    const command = machineMode ? rawCommand : commandGuard(rawCommand);\n    const running = [...jobs.values()].filter(job => job.projectId === project.id && ['running','stopping'].includes(job.status)).length;\n    if (!machineMode && running >= MAX_RUNNING_PER_PROJECT) throw chatError('TASK_NOT_ALLOWED', `Project đang có ${running} terminal job chạy nền. Hãy dừng job cũ trước.`, { limit:MAX_RUNNING_PER_PROJECT });",
    'terminal exec guard');
  text = replaceOnce(text,
    "      id, project:project.name, projectId:project.id, command, cwdRel:cwd.rel,\n      workSessionId:String(options.work_session_id || ''), shell:shell.file,",
    "      id, project:project.name, projectId:project.id, command, cwdRel:cwd.rel, machineMode,\n      workSessionId:String(options.work_session_id || ''), shell:shell.file,",
    'terminal job mode');
  text = replaceOnce(text,
    "        env:{ ...process.env, CHATCODE_WORKSPACE:project.root, CHATCODE_PROJECT_ID:project.id }",
    "        env:{ ...process.env, CHATCODE_WORKSPACE:project.root, CHATCODE_PROJECT_ID:project.id, CHATCODE_MACHINE_ACCESS:machineMode ? '1' : '0' }",
    'terminal env');
  return text;
});

patch('core/runtime-bootstrap.js', text => replaceOnce(text,
  "  const { installProjectScopePatches } = require('./project-scope');\n  installProjectScopePatches();\n  return true;",
  "  const { installProjectScopePatches } = require('./project-scope');\n  installProjectScopePatches();\n  // User-enabled outer execution mode. Safe/Trusted keep every existing guard;\n  // Machine mode bypasses project/path/approval scope while Guardian stays user-only.\n  const { installMachineAccessPatches } = require('./machine-access');\n  installMachineAccessPatches();\n  return true;",
  'runtime final machine layer'));

patch('main.js', text => {
  text = replaceOnce(text,
    "const { app, BrowserWindow, dialog, ipcMain, clipboard, safeStorage, Tray, Menu, nativeImage, Notification, powerMonitor, shell } = require('electron');",
    "const { app, BrowserWindow, dialog, ipcMain, clipboard, safeStorage, Tray, Menu, nativeImage, Notification, powerMonitor, shell, globalShortcut } = require('electron');",
    'main global shortcut import');
  text = replaceOnce(text,
    "const { createUpdateService } = require('./core/updater');",
    "const { createUpdateService } = require('./core/updater');\nconst { guardianStop, guardianResume, guardianSnapshot } = require('./core/machine-access');",
    'main guardian import');
  text = replaceOnce(text,
    "function updateTrayMenu() {",
    "async function guardianStopAll(reason = 'user') {\n  const state = guardianStop(reason);\n  try { await safeTools.shutdownTerminalJobs?.(); } catch {}\n  send('guardian:changed', state);\n  updateTrayMenu();\n  return state;\n}\nfunction guardianResumeFromUi() {\n  const state = guardianResume();\n  send('guardian:changed', state);\n  updateTrayMenu();\n  return state;\n}\n\nfunction updateTrayMenu() {",
    'main guardian helpers');
  text = replaceOnce(text,
    "    { label: 'Kết nối lại ngay', click: () => connection.start().catch(() => {}) },\n    { type: 'separator' },",
    "    { label: 'Kết nối lại ngay', click: () => connection.start().catch(() => {}) },\n    { label: guardianSnapshot().stopped ? 'STOP ALL đang bật' : 'STOP ALL (Ctrl+Shift+F12)', click: () => guardianStopAll('tray').catch(() => {}) },\n    { type: 'separator' },",
    'main tray stop');
  text = replaceOnce(text,
    "ipcMain.handle('projects:reindex', (_, id) => projects.reindex(id));",
    "ipcMain.handle('projects:reindex', (_, id) => projects.reindex(id));\nipcMain.handle('guardian:state', () => guardianSnapshot());\nipcMain.handle('guardian:stop-all', () => guardianStopAll('ui'));\nipcMain.handle('guardian:resume', () => guardianResumeFromUi());",
    'main guardian ipc');
  text = replaceOnce(text,
    "    createTray();\n    createWindow(!process.argv.includes('--background'));",
    "    createTray();\n    createWindow(!process.argv.includes('--background'));\n    try { globalShortcut.register('CommandOrControl+Shift+F12', () => guardianStopAll('hotkey').catch(() => {})); } catch {}",
    'main hotkey register');
  text = replaceOnce(text,
    "  approvals.shutdown();\n  projects.shutdown();",
    "  approvals.shutdown();\n  try { globalShortcut.unregisterAll(); } catch {}\n  projects.shutdown();",
    'main hotkey cleanup');
  return text;
});

patch('preload.js', text => {
  text = replaceOnce(text,
    "  reindexProject: id => ipcRenderer.invoke('projects:reindex', id),",
    "  reindexProject: id => ipcRenderer.invoke('projects:reindex', id),\n  guardianState: () => ipcRenderer.invoke('guardian:state'),\n  guardianStopAll: () => ipcRenderer.invoke('guardian:stop-all'),\n  guardianResume: () => ipcRenderer.invoke('guardian:resume'),",
    'preload guardian methods');
  text = replaceOnce(text,
    "  onTerminalChanged: callback => ipcRenderer.on('terminal:changed', (_, value) => callback(value)),",
    "  onTerminalChanged: callback => ipcRenderer.on('terminal:changed', (_, value) => callback(value)),\n  onGuardianChanged: callback => ipcRenderer.on('guardian:changed', (_, value) => callback(value)),",
    'preload guardian event');
  return text;
});

patch('renderer/v10-runtime.js', text => {
  text = replaceOnce(text,
    "            <button id=\"v10TrustedMode\" class=\"v10-mode-option trusted\"><i data-lucide=\"zap\"></i><div><strong>Trusted</strong><span>Read/write/manage/task/local Git không hỏi từng action.</span></div></button>",
    "            <button id=\"v10TrustedMode\" class=\"v10-mode-option trusted\"><i data-lucide=\"zap\"></i><div><strong>Trusted</strong><span>Read/write/manage/task/local Git không hỏi từng action.</span></div></button>\n            <button id=\"v10MachineMode\" class=\"v10-mode-option machine\"><i data-lucide=\"monitor-up\"></i><div><strong>Full Machine Access</strong><span>Mọi filesystem/ổ đĩa mà Windows nhìn thấy; không project scope hay per-action approval.</span></div></button>",
    'renderer machine option');
  text = replaceOnce(text,
    "          <div id=\"v10ModeMessage\" class=\"note v10-mode-note\">Safe mode đang dùng các quyền và Safety Rules hiện tại.</div>\n        </article>`);",
    "          <div id=\"v10ModeMessage\" class=\"note v10-mode-note\">Safe mode đang dùng các quyền và Safety Rules hiện tại.</div>\n        </article>\n        <div id=\"v10MachineBanner\" class=\"v10-machine-banner hidden\"><div><strong>FULL MACHINE ACCESS — ACTIVE</strong><span>AI có thể thao tác mọi filesystem mà tài khoản Windows truy cập được.</span></div><div class=\"v10-machine-actions\"><button id=\"v10StopAll\" class=\"btn danger\">STOP ALL</button><button id=\"v10GuardianResume\" class=\"btn hidden\">Resume</button></div></div>`);",
    'renderer machine banner');
  const renderBlock = `  async function render() {\n    const project = await currentProject().catch(() => null); if (!project || !$('v10WorkspaceMode')) return;\n    const mode = project.workspaceMode || project.safety?._workspaceMode || 'safe';\n    const machine = mode === 'machine';\n    const trusted = mode === 'trusted';\n    const trustedLike = trusted || machine;\n    $('v10SafeMode')?.classList.toggle('active', !trustedLike);\n    $('v10TrustedMode')?.classList.toggle('active', trusted);\n    $('v10MachineMode')?.classList.toggle('active', machine);\n    if ($('v10ModeBadge')) { $('v10ModeBadge').textContent = machine ? 'FULL MACHINE' : trusted ? 'TRUSTED' : 'SAFE'; $('v10ModeBadge').classList.toggle('trusted', trusted); $('v10ModeBadge').classList.toggle('machine', machine); }\n    $('v10TrustedOptions')?.classList.toggle('hidden', !trusted);\n    if ($('v10AllowSecrets')) $('v10AllowSecrets').checked = machine || !!(project.trusted?.allowSecrets || project.safety?._allowSecrets);\n    if ($('v10ModeMessage')) $('v10ModeMessage').textContent = machine\n      ? 'Full Machine Access đang hoạt động: absolute path trên mọi ổ/filesystem đều hợp lệ; project scope, owner scope và per-action approval không chặn file/terminal. Quyền Windows vẫn áp dụng.'\n      : trusted\n        ? 'Trusted đang hoạt động: ChatGPT không cần approval cho write/rename/delete/task/stage/commit local trong project. Recovery Snapshot vẫn giữ nguyên.'\n        : 'Safe mode đang dùng các quyền và Safety Rules hiện tại.';\n    setLegacyDisabled(trustedLike);\n\n    $('v10TerminalRuntime')?.classList.toggle('v10-terminal-disabled', !trustedLike);\n    if ($('v10TerminalRun')) $('v10TerminalRun').disabled = !trustedLike;\n    if ($('v10TerminalCommand')) $('v10TerminalCommand').disabled = !trustedLike;\n    if ($('v10TerminalCwd')) { $('v10TerminalCwd').disabled = !trustedLike; $('v10TerminalCwd').title = machine ? 'Có thể dùng absolute path trên bất kỳ ổ/filesystem nào' : 'Thư mục làm việc tương đối trong project'; }\n    if ($('v10TerminalBackground')) $('v10TerminalBackground').disabled = !trustedLike;\n    if ($('v10TerminalBadge')) { $('v10TerminalBadge').textContent = machine ? 'MACHINE' : trusted ? 'READY' : 'SAFE'; $('v10TerminalBadge').classList.toggle('trusted', trusted); $('v10TerminalBadge').classList.toggle('machine', machine); }\n    if ($('v10TerminalNotice')) $('v10TerminalNotice').textContent = machine\n      ? 'Full Machine terminal không khóa cwd hay command theo project. Có thể dùng absolute cwd trên C:, D:, E:, network/mounted drives… theo quyền Windows.'\n      : trusted\n        ? 'Terminal dùng cwd bên trong project và chạy ẩn. Đây không phải OS sandbox; Git push/reset --hard vẫn bị khóa.'\n        : 'Generic terminal chỉ bật ở Trusted Workspace hoặc Full Machine Access. Safe vẫn dùng run_task với command allowlist.';\n\n    const guardian = await api.guardianState?.().catch(() => ({ stopped:false }));\n    $('v10MachineBanner')?.classList.toggle('hidden', !machine);\n    $('v10MachineBanner')?.classList.toggle('stopped', !!guardian?.stopped);\n    if ($('v10StopAll')) { $('v10StopAll').disabled = !!guardian?.stopped; $('v10StopAll').textContent = guardian?.stopped ? 'STOPPED' : 'STOP ALL'; }\n    $('v10GuardianResume')?.classList.toggle('hidden', !machine || !guardian?.stopped);\n\n    const pills = $('permissionPills');\n    if (pills) {\n      pills.querySelectorAll('.v10-workspace-pill').forEach(x => x.remove());\n      pills.insertAdjacentHTML('afterbegin', \`<span class=\"pill on v10-workspace-pill \\${machine?'machine':trusted?'trusted':''}\">\\${machine?'Full Machine':trusted?'Trusted':'Safe'}</span>\`);\n    }\n  }\n\n`;
  text = replaceBetween(text, "  async function render() {", "  async function refreshTerminalJobs() {", renderBlock, 'renderer render');

  const controlBlock = `  async function runTerminal() {\n    const project = await currentProject(); if (!project) return;\n    const mode = project.workspaceMode || project.safety?._workspaceMode || 'safe';\n    if (!['trusted','machine'].includes(mode)) throw new Error('Hãy bật Trusted Workspace hoặc Full Machine Access trước khi dùng generic terminal.');\n    const command = String($('v10TerminalCommand')?.value || '').trim(); if (!command) return;\n    const cwd = String($('v10TerminalCwd')?.value || '.').trim() || '.';\n    const background = !!$('v10TerminalBackground')?.checked;\n    $('v10TerminalRun').disabled = true;\n    try { await api.execTerminal(project.id, command, { cwd, background }); await refreshTerminalJobs(); }\n    finally { $('v10TerminalRun').disabled = false; }\n  }\n\n  async function enableTrusted() {\n    const project = await currentProject(); if (!project) return;\n    if (project.workspaceMode === 'trusted' || project.safety?._workspaceMode === 'trusted') return;\n    const ok = confirm('Bật Trusted Workspace?\\n\\nChatGPT sẽ được ghi/xóa/rename, chạy terminal/task và Git local trong project mà không hỏi từng thao tác. File-tool project boundary và Git push vẫn bị khóa.');\n    if (!ok) return;\n    const savedPermissions = safePermissions(project), savedSafety = safeRules(project);\n    await api.updateSafety(project.id, { write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow', _workspaceMode:'trusted', _allowSecrets:false, _safePermissions:savedPermissions, _safeSafety:savedSafety });\n    await render(); await refreshTerminalJobs();\n  }\n\n  async function enableMachine() {\n    const project = await currentProject(); if (!project) return;\n    if (project.workspaceMode === 'machine' || project.safety?._workspaceMode === 'machine') return;\n    const ok = confirm('Bật Full Machine Access?\\n\\nAI sẽ được coi là đã được bạn ủy quyền trước cho file/terminal trên toàn bộ máy: mọi ổ đĩa, thư mục, project và secrets mà tài khoản Windows có quyền truy cập. Không có project-root scope hay per-action approval.\\n\\nSTOP ALL (Ctrl+Shift+F12) vẫn luôn thuộc quyền người dùng.');\n    if (!ok) return;\n    const savedPermissions = safePermissions(project), savedSafety = safeRules(project);\n    await api.updateSafety(project.id, { write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow', _workspaceMode:'machine', _allowSecrets:true, _safePermissions:savedPermissions, _safeSafety:savedSafety });\n    await api.guardianResume?.();\n    await render(); await refreshTerminalJobs();\n  }\n\n  async function enableSafe() {\n    const project = await currentProject(); if (!project) return;\n    const mode = project.workspaceMode || project.safety?._workspaceMode || 'safe';\n    if (mode === 'safe') return;\n    const permissions = safePermissions(project), rules = safeRules(project);\n    await api.updateSafety(project.id, { ...rules, _workspaceMode:'safe', _allowSecrets:false, _safePermissions:permissions, _safeSafety:rules });\n    await api.updateProject({ id:project.id, permissions });\n    await render(); await refreshTerminalJobs();\n  }\n\n  async function stopAll() { await api.guardianStopAll?.(); await render(); await refreshTerminalJobs(); }\n  async function resumeGuardian() { await api.guardianResume?.(); await render(); }\n\n`;
  text = replaceBetween(text, "  async function runTerminal() {", "  async function toggleSecrets(event) {", controlBlock, 'renderer mode controls');
  text = replaceOnce(text,
    "    $('v10TrustedMode')?.addEventListener('click', () => enableTrusted().catch(error => alert(error.message || error)));",
    "    $('v10TrustedMode')?.addEventListener('click', () => enableTrusted().catch(error => alert(error.message || error)));\n    $('v10MachineMode')?.addEventListener('click', () => enableMachine().catch(error => alert(error.message || error)));\n    $('v10StopAll')?.addEventListener('click', () => stopAll().catch(error => alert(error.message || error)));\n    $('v10GuardianResume')?.addEventListener('click', () => resumeGuardian().catch(error => alert(error.message || error)));",
    'renderer bind machine');
  text = replaceOnce(text,
    "  api.onTerminalChanged?.(job => { if (!job?.project_id || job.project_id === activeProjectId()) setTimeout(() => refreshTerminalJobs().catch(() => {}), 80); });",
    "  api.onTerminalChanged?.(job => { if (!job?.project_id || job.project_id === activeProjectId()) setTimeout(() => refreshTerminalJobs().catch(() => {}), 80); });\n  api.onGuardianChanged?.(() => setTimeout(() => render().catch(() => {}), 50));",
    'renderer guardian event');
  return text;
});

patch('renderer/v10.css', text => text + "\n.v10-mode-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.v10-mode-option.machine.active{border-color:#dc2626;background:#fff7f7;box-shadow:0 0 0 3px rgba(220,38,38,.10)}.v10-mode-badge.machine,.v10-workspace-pill.machine{border-color:#fecaca!important;background:#fef2f2!important;color:#b91c1c!important}.v10-machine-banner{position:sticky;top:8px;z-index:20;display:flex;justify-content:space-between;gap:16px;align-items:center;margin:-6px 0 18px;padding:12px 14px;border:1px solid #fecaca;border-radius:12px;background:#fff1f2;color:#991b1b;box-shadow:0 8px 24px rgba(127,29,29,.10)}.v10-machine-banner strong{display:block;font:800 12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.06em}.v10-machine-banner span{display:block;margin-top:3px;font-size:12px}.v10-machine-banner.stopped{background:#f8fafc;color:#475569;border-color:#cbd5e1}.v10-machine-actions{display:flex;gap:8px;flex:0 0 auto}.v10-machine-actions .danger{background:#b91c1c;color:#fff;border-color:#b91c1c}.v10-terminal-card .v10-mode-badge.machine{border-color:#fecaca;background:#fef2f2;color:#b91c1c}@media(max-width:1050px){.v10-mode-grid{grid-template-columns:1fr 1fr}}@media(max-width:900px){.v10-mode-grid{grid-template-columns:1fr}.v10-machine-banner{align-items:flex-start;flex-direction:column}}\n");

patch('mcp-server.mjs', text => {
  text = replaceOnce(text,
    "Safe Workspace keeps approvals and the run_task allow-list. Trusted Workspace can use real shell exec; exec is not an OS filesystem sandbox. Git push/reset --hard remain blocked. Never push Git.",
    "Safe Workspace keeps approvals and the run_task allow-list. Trusted Workspace can use real shell exec but file tools remain project-scoped and Git push/reset --hard stay blocked. User-enabled Full Machine Access removes project/path/owner/per-action approval scope for file tools and terminal: absolute paths/cwd across every OS-visible filesystem are valid and terminal command guards are not applied. OS permissions still apply. STOP ALL is a user-only Guardian and must never be bypassed.",
    'mcp instructions');
  text = replaceOnce(text,
    "server.registerTool('list_files',{ title:'List project files', description:'List indexed non-sensitive files inside a project.', inputSchema:z.object({ project:z.string(), limit:z.number().int().min(1).max(5000).optional() }), annotations:LOCAL_READ },wrap(api,'list_files',({project,limit})=>api.listFiles(project,limit)));",
    "server.registerTool('list_files',{ title:'List project or machine files', description:'List files. Safe/Trusted stay project-scoped. Full Machine Access may pass an absolute path on any OS-visible filesystem.', inputSchema:z.object({ project:z.string(), limit:z.number().int().min(1).max(5000).optional(), path:z.string().optional() }), annotations:LOCAL_READ },wrap(api,'list_files',({project,limit,path})=>api.listFiles(project,limit,path||'')));",
    'mcp list files');
  text = replaceOnce(text,
    "server.registerTool('search_project',{ title:'Search project', description:'Search filenames and UTF-8 text/code content and return ranked snippets.', inputSchema:z.object({ project:z.string(), query:z.string().min(1) }), annotations:LOCAL_READ },wrap(api,'search_project',({project,query})=>api.search(project,query)));",
    "server.registerTool('search_project',{ title:'Search project or machine path', description:'Search filenames and UTF-8 text/code. In Full Machine Access, optional path may be an absolute directory outside the project.', inputSchema:z.object({ project:z.string(), query:z.string().min(1), path:z.string().optional() }), annotations:LOCAL_READ },wrap(api,'search_project',({project,query,path})=>api.search(project,query,path||'')));",
    'mcp search');
  text = replaceOnce(text,
    "server.registerTool('read_file',{ title:'Read file', description:'Read one UTF-8 text/code file. Sensitive paths are blocked unless explicitly enabled in Trusted Workspace.', inputSchema:z.object({ project:z.string(), path:z.string().min(1) }), annotations:LOCAL_READ },wrap(api,'read_file',({project,path})=>api.readFile(project,path)));",
    "server.registerTool('read_file',{ title:'Read file', description:'Read one file. Safe/Trusted use project paths and their secret rules. Full Machine Access accepts absolute paths anywhere and may return binary content as base64.', inputSchema:z.object({ project:z.string(), path:z.string().min(1) }), annotations:LOCAL_READ },wrap(api,'read_file',({project,path})=>api.readFile(project,path)));",
    'mcp read file');
  return text;
});

patch('package.json', text => {
  text = replaceOnce(text,
    "node --check core/bricks-evidence.js && node --check core/database-runtime.js",
    "node --check core/bricks-evidence.js && node --check core/machine-access.js && node --check core/database-runtime.js",
    'package syntax core');
  text = replaceOnce(text,
    "node --check scripts/smoke-wordpress-bricks-hardening.cjs && node --check mcp-server.mjs",
    "node --check scripts/smoke-wordpress-bricks-hardening.cjs && node --check scripts/smoke-machine-access.cjs && node --check mcp-server.mjs",
    'package syntax smoke');
  text = replaceOnce(text,
    "\"test:trusted\": \"node scripts/smoke-trusted.cjs\"",
    "\"test:trusted\": \"node scripts/smoke-trusted.cjs && node scripts/smoke-machine-access.cjs\"",
    'package trusted test');
  return text;
});

patch('.github/workflows/test-chatcode-gpt-skills.yml', text => {
  text = text.replace(/      - 'core\/database-runtime\.js'/g, "      - 'core/database-runtime.js'\n      - 'core/machine-access.js'");
  text = text.replace(/      - 'scripts\/smoke-database-runtime\.cjs'/g, "      - 'scripts/smoke-database-runtime.cjs'\n      - 'scripts/smoke-machine-access.cjs'");
  text = replaceOnce(text,
    "          node --check core/database-runtime.js",
    "          node --check core/database-runtime.js\n          node --check core/machine-access.js",
    'workflow syntax machine');
  text = replaceOnce(text,
    "          node --check scripts/smoke-database-runtime.cjs",
    "          node --check scripts/smoke-database-runtime.cjs\n          node --check scripts/smoke-machine-access.cjs",
    'workflow syntax smoke machine');
  text = replaceOnce(text,
    "      - name: WordPress database topology and bounded fallback\n        run: npm run test:database",
    "      - name: WordPress database topology and bounded fallback\n        run: npm run test:database\n      - name: Safe, Trusted and Full Machine workspace regression\n        run: npm run test:trusted",
    'workflow machine test step');
  return text;
});

console.log('v1.0.52 patch applied');
