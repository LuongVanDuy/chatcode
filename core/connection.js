const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const dns = require('dns').promises;
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');

const BACKOFF = [2000, 5000, 10000, 30000, 60000];

function createConnectionService({ app, safeStorage, store, port, ensureMcpServer, resetMcpServer, getMcpRuntime, onChanged }) {
  let proc = null;
  let intentionalStop = false;
  let reconnectTimer = null;
  let watchdogTimer = null;
  let reconnectAttempt = 0;
  let quitting = false;
  let tunnel = { status: 'stopped', publicBaseUrl: '', error: '', mode: 'custom' };
  const health = { localOk:false, publicOk:false, localMs:0, publicMs:0, lastCheckAt:'', consecutiveFailures:0, reconnectCount:0, lastReconnectAt:'', lastDisconnectReason:'', nextRetryAt:'', lastCloudflaredError:'' };

  const notify = () => onChanged?.(snapshot());
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const extractToken = value => {
    const text = String(value || '').trim();
    if (!text) return '';
    return (text.match(/--token\s+([A-Za-z0-9._=\-]+)/i)?.[1] || text.match(/service\s+install\s+([A-Za-z0-9._=\-]+)/i)?.[1] || text).trim();
  };

  function encrypt(value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows Secure Storage chưa sẵn sàng để lưu Tunnel Token.');
    return safeStorage.encryptString(String(value)).toString('base64');
  }
  function decrypt(value) {
    if (!value) return '';
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows Secure Storage chưa sẵn sàng để đọc Tunnel Token.');
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  }
  function snapshot() {
    const cfg = store.connectionConfig();
    const runtime = getMcpRuntime();
    return {
      ...cfg,
      status: tunnel.status,
      error: tunnel.error,
      localUrl: runtime?.localUrl || '',
      publicBaseUrl: tunnel.publicBaseUrl || '',
      connectionUrl: tunnel.publicBaseUrl && runtime ? `${tunnel.publicBaseUrl}${runtime.route}` : '',
      uptimeSec: Math.floor(process.uptime()),
      health: { ...health },
      watchdog: { autoReconnect: store.read().settings.autoReconnect, reconnectAttempt }
    };
  }

  function clearRetry() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    health.nextRetryAt = '';
  }
  function schedule(reason = 'Mất kết nối') {
    const state = store.read();
    if (quitting || intentionalStop || !state.settings.autoReconnect) return;
    if (state.connection.mode === 'custom' && (!state.connection.domain || !state.connection.tunnelTokenEnc)) return;
    if (reconnectTimer) return;
    const delay = BACKOFF[Math.min(reconnectAttempt, BACKOFF.length - 1)];
    reconnectAttempt++;
    health.lastDisconnectReason = String(reason).slice(0, 500);
    health.nextRetryAt = new Date(Date.now() + delay).toISOString();
    tunnel = { ...tunnel, status:'reconnecting', error:health.lastDisconnectReason };
    notify();
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      health.nextRetryAt = '';
      health.reconnectCount++;
      health.lastReconnectAt = new Date().toISOString();
      try { await start({ fromWatchdog:true }); }
      catch (error) { schedule(error.message || error); }
    }, delay);
  }

  async function stop({ intentional = true } = {}) {
    if (intentional) { intentionalStop = true; clearRetry(); }
    if (proc && !proc.killed) { proc.__chatcodeIntentional = true; try { proc.kill(); } catch {} }
    proc = null;
    tunnel = { status:'stopped', publicBaseUrl:'', error:'', mode:store.read().connection.mode };
    notify();
    return snapshot();
  }

  async function cloudflared() {
    const { install } = await import('cloudflared');
    const dir = path.join(app.getPath('userData'), 'bin');
    await fsp.mkdir(dir, { recursive:true });
    const bin = path.join(dir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    if (!fs.existsSync(bin)) {
      tunnel.status = 'installing-tunnel';
      notify();
      await install(bin);
    }
    return bin;
  }

  async function probe(url, timeout = 4500) {
    const started = Date.now();
    try {
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { headers:{ 'cache-control':'no-cache' }, signal:AbortSignal.timeout(timeout) });
      const body = await response.json().catch(() => null);
      return { ok:response.ok && body?.ok && body?.service === 'personal-chatcode', status:response.status, ms:Date.now()-started, detail:body };
    } catch (error) {
      return { ok:false, status:0, ms:Date.now()-started, error:String(error.message || error) };
    }
  }

  async function waitPublic(base, processRef, timeout = 35000) {
    const started = Date.now();
    let last = '';
    while (Date.now() - started < timeout) {
      if (processRef.exitCode !== null) throw new Error(`Cloudflare Tunnel đã dừng (mã ${processRef.exitCode}).`);
      const result = await probe(`${base}/health`, 4000);
      if (result.ok) return;
      last = result.error || `HTTP ${result.status}`;
      await sleep(1000);
    }
    throw new Error(`Không thể truy cập ${base}/health. ${last}`);
  }

  function bind(processRef, mode) {
    proc = processRef;
    processRef.stderr?.on('data', chunk => {
      const line = String(chunk || '').split(/\r?\n/).find(value => /ERR|error/i.test(value));
      if (line) health.lastCloudflaredError = line.slice(0, 700);
    });
    processRef.on('error', error => {
      const reason = String(error.message || error);
      health.lastDisconnectReason = reason;
      tunnel = { status:'tunnel-error', publicBaseUrl:'', error:reason, mode };
      notify(); schedule(reason);
    });
    processRef.on('exit', code => {
      if (proc === processRef) proc = null;
      if (quitting || intentionalStop || processRef.__chatcodeIntentional) return;
      const reason = health.lastCloudflaredError || `Cloudflare Tunnel đã dừng (${code ?? 'không rõ mã'}).`;
      health.lastDisconnectReason = reason;
      tunnel = { status:'tunnel-error', publicBaseUrl:'', error:reason, mode };
      notify(); schedule(reason);
    });
  }

  async function quick(bin) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const processRef = spawn(bin, ['tunnel','--no-autoupdate','--url',`http://127.0.0.1:${port}`], { windowsHide:true, stdio:['ignore','pipe','pipe'] });
      bind(processRef, 'quick');
      const onData = async chunk => {
        const match = String(chunk || '').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (!match || settled) return;
        settled = true;
        try {
          tunnel = { status:'verifying', publicBaseUrl:match[0], error:'', mode:'quick' }; notify();
          await waitPublic(match[0], processRef, 25000);
          tunnel = { status:'connected', publicBaseUrl:match[0], error:'', mode:'quick' };
          reconnectAttempt = 0; notify(); resolve(snapshot());
        } catch (error) { try { processRef.kill(); } catch {} reject(error); }
      };
      processRef.stdout.on('data', onData); processRef.stderr.on('data', onData);
      setTimeout(() => { if (!settled) { settled = true; try { processRef.kill(); } catch {} reject(new Error('Hết thời gian chờ Quick Tunnel.')); } }, 45000);
    });
  }

  async function custom(bin, state) {
    const domain = store.normalizeDomain(state.connection.domain);
    const token = decrypt(state.connection.tunnelTokenEnc);
    if (!domain || !token) throw new Error('Hãy nhập Domain và Tunnel Token trước khi kết nối.');
    const base = `https://${domain}`;
    const processRef = spawn(bin, ['tunnel','run','--token',token], { windowsHide:true, stdio:['ignore','pipe','pipe'] });
    bind(processRef, 'custom');
    tunnel = { status:'verifying', publicBaseUrl:base, error:'', mode:'custom' }; notify();
    try {
      await waitPublic(base, processRef, 35000);
      tunnel = { status:'connected', publicBaseUrl:base, error:'', mode:'custom' };
      reconnectAttempt = 0; health.consecutiveFailures = 0; notify(); return snapshot();
    } catch (error) { try { processRef.kill(); } catch {} throw error; }
  }

  async function start({ fromWatchdog = false } = {}) {
    await ensureMcpServer();
    if (!fromWatchdog) clearRetry();
    intentionalStop = false;
    if (proc && !proc.killed) { proc.__chatcodeIntentional = true; try { proc.kill(); } catch {} }
    proc = null;
    const state = store.ensure();
    const mode = state.connection.mode;
    if (mode === 'custom' && (!state.connection.domain || !state.connection.tunnelTokenEnc)) {
      tunnel = { status:'config-required', publicBaseUrl:'', error:'', mode }; notify(); return snapshot();
    }
    tunnel = { status:fromWatchdog ? 'reconnecting' : 'starting', publicBaseUrl:'', error:'', mode }; notify();
    try {
      const bin = await cloudflared();
      return mode === 'quick' ? await quick(bin) : await custom(bin, state);
    } catch (error) {
      const message = String(error.message || error);
      health.lastDisconnectReason = message;
      tunnel = { status:'tunnel-error', publicBaseUrl:'', error:message, mode }; notify();
      if (fromWatchdog || state.settings.autoReconnect) schedule(message);
      throw error;
    }
  }

  async function watchdogCheck() {
    if (quitting) return;
    const local = await probe(`http://127.0.0.1:${port}/health`, 3000);
    health.localOk = local.ok; health.localMs = local.ms; health.lastCheckAt = new Date().toISOString();
    if (!local.ok) {
      health.publicOk = false; health.consecutiveFailures++;
      tunnel = { ...tunnel, status:'local-error', error:'Local MCP health check thất bại.' }; notify();
      try { await resetMcpServer(); await ensureMcpServer(); } catch {}
      return;
    }
    if (tunnel.publicBaseUrl) {
      const pub = await probe(`${tunnel.publicBaseUrl}/health`, 4500);
      health.publicOk = pub.ok; health.publicMs = pub.ms;
      if (pub.ok) {
        health.consecutiveFailures = 0;
        if (tunnel.status !== 'connected' && proc) { tunnel.status = 'connected'; tunnel.error = ''; notify(); }
      } else {
        health.consecutiveFailures++;
        if (health.consecutiveFailures >= 2 && !intentionalStop) {
          const reason = pub.error || `Public health HTTP ${pub.status}`;
          health.lastDisconnectReason = reason;
          tunnel = { ...tunnel, status:'offline', error:reason }; notify();
          if (proc && !proc.killed) try { proc.kill(); } catch {}
          schedule(reason);
        }
      }
    } else health.publicOk = false;
    notify();
  }

  function restartWatchdog() {
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    watchdogTimer = setInterval(() => watchdogCheck().catch(() => {}), store.read().settings.healthIntervalSec * 1000);
    setTimeout(() => watchdogCheck().catch(() => {}), 1500);
  }

  async function saveConfig(incoming = {}) {
    await stop({ intentional:true });
    const state = store.read();
    const mode = incoming.mode === 'quick' ? 'quick' : 'custom';
    state.connection.mode = mode;
    if (mode === 'custom') {
      state.connection.domain = store.normalizeDomain(incoming.domain);
      const token = extractToken(incoming.tunnelToken);
      if (token) state.connection.tunnelTokenEnc = encrypt(token);
      if (!state.connection.domain) throw new Error('Vui lòng nhập domain Cloudflare.');
      if (!state.connection.tunnelTokenEnc) throw new Error('Vui lòng nhập Tunnel Token/Key của Cloudflare.');
    }
    store.write(state);
    return store.connectionConfig(state);
  }

  async function clearToken() {
    await stop({ intentional:true });
    const state = store.read();
    state.connection.tunnelTokenEnc = '';
    store.write(state);
    tunnel = { status:'config-required', publicBaseUrl:'', error:'', mode:state.connection.mode }; notify();
    return store.connectionConfig(state);
  }

  async function rotate() {
    await stop({ intentional:true }); await resetMcpServer();
    const state = store.read(); state.connection.token = crypto.randomBytes(24).toString('hex'); store.write(state);
    await ensureMcpServer(); return start();
  }

  function runExec(command, args, cwd, timeout = 10000) {
    return new Promise(resolve => execFile(command, args, { cwd, timeout, windowsHide:true, maxBuffer:1024*1024 }, (error, stdout, stderr) => resolve({ ok:!error, stdout:String(stdout || ''), stderr:String(stderr || error?.message || '') })));
  }

  async function diagnose() {
    await ensureMcpServer();
    const snap = snapshot();
    const checks = [];
    let publicHealth = null;

    async function check(name, fn) {
      const started = Date.now();
      try {
        const detail = await fn();
        checks.push({ name, ok:true, ms:Date.now()-started, detail:String(detail || 'OK').slice(0, 700) });
      } catch (error) {
        checks.push({ name, ok:false, ms:Date.now()-started, detail:String(error.message || error).slice(0, 700) });
      }
    }

    await check('Local MCP', async () => {
      const result = await probe(`http://127.0.0.1:${port}/health`, 5000);
      if (!result.ok) throw new Error(result.error || `HTTP ${result.status}`);
      return `OK · ${result.ms} ms`;
    });

    if (snap.domain) await check('DNS domain', async () => {
      try {
        const addresses = await dns.lookup(snap.domain, { all:true, verbatim:true });
        if (!addresses.length) throw new Error('DNS không trả địa chỉ IP.');
        return addresses.map(item => `${item.address} (IPv${item.family})`).join(', ');
      } catch (error) {
        // Some Windows/network configurations refuse direct DNS API queries while
        // Chromium/fetch can still resolve the hostname normally. If public HTTPS
        // succeeds, DNS is demonstrably usable and should not be reported as fatal.
        if (snap.publicBaseUrl) {
          publicHealth = await probe(`${snap.publicBaseUrl}/health`, 7000);
          if (publicHealth.ok) return `Resolver riêng không trả IP (${error.code || error.message || error}), nhưng HTTPS đã phân giải domain thành công.`;
        }
        throw error;
      }
    });

    if (snap.publicBaseUrl) await check('Cloudflare HTTPS', async () => {
      publicHealth ||= await probe(`${snap.publicBaseUrl}/health`, 8000);
      if (!publicHealth.ok) throw new Error(publicHealth.error || `HTTP ${publicHealth.status}`);
      return `OK · ${publicHealth.ms} ms`;
    });

    if (snap.connectionUrl) {
      const call = async (body, { timeout = 20000, retries = 1 } = {}) => {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const response = await fetch(snap.connectionUrl, {
              method:'POST',
              headers:{ 'content-type':'application/json', accept:'application/json, text/event-stream' },
              body:JSON.stringify(body),
              signal:AbortSignal.timeout(timeout)
            });
            const text = await response.text();
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
            return text;
          } catch (error) {
            lastError = error;
            if (attempt < retries) await sleep(650);
          }
        }
        const message = String(lastError?.message || lastError || 'Không rõ lỗi');
        if (/abort|timeout/i.test(message)) throw new Error(`Timeout sau ${timeout / 1000}s; đã thử ${retries + 1} lần qua public MCP.`);
        throw lastError;
      };

      await check('MCP initialize', async () => {
        await call({ jsonrpc:'2.0', id:901, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{ name:'chatcode-self-test', version:app.getVersion() } } }, { timeout:15000, retries:1 });
        return 'Public MCP initialize OK';
      });
      await check('MCP tools/list', async () => {
        const text = await call({ jsonrpc:'2.0', id:902, method:'tools/list', params:{} }, { timeout:20000, retries:1 });
        try {
          const payload = JSON.parse(text);
          const tools = payload?.result?.tools;
          return Array.isArray(tools) ? `OK · ${tools.length} tools` : 'OK';
        } catch { return 'OK'; }
      });
    }

    try {
      const bin = await cloudflared();
      await check('cloudflared', async () => {
        const result = await runExec(bin, ['--version'], app.getPath('userData'));
        if (!result.ok) throw new Error(result.stderr);
        return result.stdout.trim();
      });
    } catch {}

    return { ok:checks.every(item => item.ok), checks, snapshot:{ status:snap.status, domain:snap.domain, mode:snap.mode, health:snap.health, watchdog:snap.watchdog, version:app.getVersion(), projectCount:store.read().projects.length } };
  }

  const report = diagnostic => JSON.stringify({ generatedAt:new Date().toISOString(), app:'ChatCode Cá Nhân', version:app.getVersion(), platform:process.platform, ...diagnostic }, null, 2);
  function resume() { watchdogCheck().catch(() => {}); if (store.read().settings.autoReconnect && tunnel.status !== 'connected') schedule('Máy vừa resume'); }
  function shutdown() { quitting = true; clearRetry(); if (watchdogTimer) clearInterval(watchdogTimer); if (proc && !proc.killed) { proc.__chatcodeIntentional = true; try { proc.kill(); } catch {} } }

  return { snapshot, start, stop, saveConfig, clearToken, rotate, diagnose, report, restartWatchdog, resume, shutdown };
}

module.exports = { createConnectionService };
