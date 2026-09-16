const fs = require('fs');

function patch(file, changes) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [find, replace, label] of changes) {
    const count = text.split(find).length - 1;
    if (count !== 1) throw new Error(`${file} ${label}: expected one marker, got ${count}`);
    text = text.replace(find, replace);
  }
  fs.writeFileSync(file, text, 'utf8');
}

patch('core/connection.js', [
  ["  let quitting = false;\n  let tunnel =", "  let quitting = false;\n  let mcpSuspended = false;\n  let tunnel =", 'suspend state'],
  ["      watchdog: { autoReconnect: store.read().settings.autoReconnect, reconnectAttempt }", "      watchdog: { autoReconnect: store.read().settings.autoReconnect, reconnectAttempt, mcpSuspended }", 'snapshot state'],
  ["    if (quitting || intentionalStop || !state.settings.autoReconnect) return;", "    if (quitting || mcpSuspended || intentionalStop || !state.settings.autoReconnect) return;", 'schedule guard'],
  ["  async function start({ fromWatchdog = false } = {}) {\n    await ensureMcpServer();", "  async function start({ fromWatchdog = false } = {}) {\n    if (mcpSuspended) {\n      tunnel = { status:'guardian-stopped', publicBaseUrl:'', error:'STOP ALL đang bật.', mode:store.read().connection.mode };\n      notify();\n      return snapshot();\n    }\n    await ensureMcpServer();", 'start guard'],
  ["  async function watchdogCheck() {\n    if (quitting) return;", "  async function watchdogCheck() {\n    if (quitting || mcpSuspended) return;", 'watchdog guard'],
  ["  const report = diagnostic => JSON.stringify", "  async function suspendMcp() {\n    mcpSuspended = true;\n    await stop({ intentional:true });\n    await resetMcpServer();\n    tunnel = { status:'guardian-stopped', publicBaseUrl:'', error:'STOP ALL đang bật.', mode:store.read().connection.mode };\n    notify();\n    return snapshot();\n  }\n\n  async function resumeMcp() {\n    mcpSuspended = false;\n    intentionalStop = false;\n    return start();\n  }\n\n  const report = diagnostic => JSON.stringify", 'guardian methods'],
  ["  function resume() { watchdogCheck().catch(() => {}); if (store.read().settings.autoReconnect && tunnel.status !== 'connected') schedule('Máy vừa resume'); }", "  function resume() { if (mcpSuspended) return; watchdogCheck().catch(() => {}); if (store.read().settings.autoReconnect && tunnel.status !== 'connected') schedule('Máy vừa resume'); }", 'system resume guard'],
  ["  return { snapshot, start, stop, saveConfig, clearToken, rotate, diagnose, report, restartWatchdog, resume, shutdown };", "  return { snapshot, start, stop, suspendMcp, resumeMcp, saveConfig, clearToken, rotate, diagnose, report, restartWatchdog, resume, shutdown };", 'exports']
]);

patch('main.js', [
  ["async function guardianStopAll(reason = 'user') {\n  const state = guardianStop(reason);\n  try { await safeTools.shutdownTerminalJobs?.(); } catch {}\n  send('guardian:changed', state);", "async function guardianStopAll(reason = 'user') {\n  const state = guardianStop(reason);\n  try { await safeTools.shutdownTerminalJobs?.(); } catch {}\n  try { await connection?.suspendMcp?.(); } catch { try { await resetMcpServer(); } catch {} }\n  send('guardian:changed', state);", 'stop MCP'],
  ["function guardianResumeFromUi() {\n  const state = guardianResume();\n  send('guardian:changed', state);\n  updateTrayMenu();\n  return state;\n}", "async function guardianResumeFromUi() {\n  const state = guardianResume();\n  try { await connection?.resumeMcp?.(); } catch {}\n  send('guardian:changed', state);\n  updateTrayMenu();\n  return state;\n}", 'resume MCP']
]);

patch('scripts/smoke-machine-access.cjs', [
  ["const { guardianStop, guardianResume, guardianSnapshot } = require('../core/machine-access');", "const { guardianStop, guardianResume, guardianSnapshot } = require('../core/machine-access');\nconst { createConnectionService } = require('../core/connection');", 'connection import'],
  ["  const project = store.getProject('machine-test');", "  // Guardian must suspend the actual MCP endpoint, not only an in-memory write guard.\n  let ensureCalls = 0, resetCalls = 0;\n  const connectionStore = {\n    connectionConfig:() => ({ mode:'quick', domain:'', hasTunnelToken:false }),\n    read:() => ({ settings:{ autoReconnect:false }, connection:{ mode:'quick' } }),\n    ensure:() => ({ settings:{ autoReconnect:false }, connection:{ mode:'quick' } })\n  };\n  const connection = createConnectionService({\n    app:{ getPath:() => temp, getVersion:() => 'test' },\n    safeStorage:{ isEncryptionAvailable:() => false },\n    store:connectionStore, port:47820,\n    ensureMcpServer:async () => { ensureCalls++; return { localUrl:'http://127.0.0.1:47820', route:'/mcp' }; },\n    resetMcpServer:async () => { resetCalls++; },\n    getMcpRuntime:() => null, onChanged:() => {}\n  });\n  await connection.suspendMcp();\n  assert.equal(resetCalls, 1, 'STOP ALL must close the local MCP endpoint');\n  const beforeEnsure = ensureCalls;\n  const suspendedStart = await connection.start();\n  assert.equal(ensureCalls, beforeEnsure, 'watchdog/manual reconnect must not recreate MCP while Guardian is stopped');\n  assert.equal(suspendedStart.status, 'guardian-stopped');\n  connection.shutdown();\n\n  const mainSource = await fsp.readFile(path.join(__dirname, '..', 'main.js'), 'utf8');\n  assert(mainSource.includes('connection?.suspendMcp?.()'), 'main STOP ALL must suspend MCP connectivity');\n  assert(mainSource.includes('connection?.resumeMcp?.()'), 'only local Guardian resume path should restore MCP connectivity');\n\n  const project = store.getProject('machine-test');", 'connection regression']
]);

console.log('Guardian MCP suspension hardening applied.');
