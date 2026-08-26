const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MAX_NOTE_CHARS = 24000;
const MAX_EVENTS = 1200;

function classifyProcess(executable, args = []) {
  const base = path.basename(String(executable || '')).toLowerCase();
  if (base.includes('cloudflared')) return 'cloudflared';
  if (base === 'git' || base === 'git.exe') return `git:${String(args[0] || 'command').slice(0, 40)}`;
  if (['cmd.exe','cmd','powershell.exe','powershell','pwsh.exe','pwsh'].includes(base)) return 'shell';
  if (['npm','npm.cmd','pnpm','pnpm.cmd','yarn','yarn.cmd','npx','npx.cmd','node','node.exe','python','python.exe','pytest','pytest.exe','cargo','cargo.exe','go','go.exe','dotnet','dotnet.exe','mvn','mvn.cmd','gradle','gradle.bat'].includes(base)) return 'task';
  return 'process';
}

function createSupportService(app) {
  const root = () => path.join(app.getPath('userData'), 'support');
  const eventDir = () => path.join(root(), 'terminal-events');
  const noteFile = () => path.join(root(), 'notes.md');

  async function ensure() { await fsp.mkdir(eventDir(), { recursive: true }); }
  function dayKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

  function redactText(value) {
    return String(value ?? '')
      .replace(/(--token\s+)([^\s]+)/gi, '$1<redacted>')
      .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, '$1<redacted>')
      .replace(/(https?:\/\/[^\s/]+)\/[a-f0-9]{24,}\/mcp/gi, '$1/<secret>/mcp')
      .replace(/\beyJ[A-Za-z0-9._=-]{24,}\b/g, '<redacted-token>')
      .replace(/\b[A-Fa-f0-9]{40,}\b/g, '<redacted-secret>')
      .slice(0, 1200);
  }

  function sanitizeArgs(args = []) {
    const list = Array.isArray(args) ? args : [], out = [];
    for (let i = 0; i < Math.min(list.length, 40); i++) {
      const raw = String(list[i] ?? ''), previous = String(list[i - 1] ?? '').toLowerCase();
      if (previous === '--token' || previous === '-token') out.push('<redacted>');
      else if (/^--?token=/i.test(raw)) out.push(raw.replace(/=.*/, '=<redacted>'));
      else out.push(redactText(raw));
    }
    return out;
  }

  async function appendEvent(incoming = {}) {
    await ensure();
    const at = incoming.at || new Date().toISOString();
    const executable = path.basename(String(incoming.executable || '')).slice(0, 160);
    const event = {
      id: incoming.id || crypto.randomUUID(), at,
      type: String(incoming.type || 'process'), phase: String(incoming.phase || 'event'),
      source: String(incoming.source || classifyProcess(executable, incoming.args)).slice(0, 80),
      project: String(incoming.project || '').slice(0, 120), executable,
      args: sanitizeArgs(incoming.args), pid: Number(incoming.pid) || null,
      exitCode: Number.isFinite(Number(incoming.exitCode)) ? Number(incoming.exitCode) : null,
      durationMs: Math.max(0, Number(incoming.durationMs) || 0),
      windowsHide: incoming.windowsHide === true,
      consoleRisk: process.platform === 'win32' && (!incoming.windowsHide || /\.(cmd|bat)$/i.test(executable) || /^(cmd|powershell|pwsh)(\.exe)?$/i.test(executable)),
      note: redactText(incoming.note || ''), error: redactText(incoming.error || '')
    };
    await fsp.appendFile(path.join(eventDir(), `${dayKey(new Date(at))}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  async function markTerminalFlash(note = '') {
    return appendEvent({ type:'terminal-flash-marker', phase:'observed', source:'user', windowsHide:false, note:note || 'Người dùng vừa thấy cửa sổ terminal nháy.' });
  }

  async function listEvents(limit = 240) {
    await ensure();
    const max = Math.min(MAX_EVENTS, Math.max(1, Number(limit) || 240));
    const names = (await fsp.readdir(eventDir()).catch(() => [])).filter(name => name.endsWith('.jsonl')).sort().reverse(), events = [];
    for (const name of names) {
      if (events.length >= max) break;
      const text = await fsp.readFile(path.join(eventDir(), name), 'utf8').catch(() => '');
      for (const line of text.split(/\r?\n/).filter(Boolean).reverse()) {
        try { events.push(JSON.parse(line)); } catch {}
        if (events.length >= max) break;
      }
    }
    return events;
  }

  async function getNote() { await ensure(); return (await fsp.readFile(noteFile(), 'utf8').catch(() => '')).slice(0, MAX_NOTE_CHARS); }
  async function saveNote(text) { await ensure(); const value = String(text || '').slice(0, MAX_NOTE_CHARS); await fsp.writeFile(noteFile(), value, 'utf8'); return { ok:true, length:value.length, updatedAt:new Date().toISOString() }; }

  async function report({ version = '', platform = process.platform, limit = 120 } = {}) {
    const [note, events] = await Promise.all([getNote(), listEvents(limit)]);
    return { schema:'chatcode-support-v1', generatedAt:new Date().toISOString(), app:'ChatCode Cá Nhân', version, platform, note, terminalEvents:events, privacy:'Token, MCP secret và chuỗi giống credential được redacted. Không thu stdout/stderr, cwd tuyệt đối hoặc nội dung file.' };
  }

  return { root, eventDir, appendEvent, markTerminalFlash, listEvents, getNote, saveNote, report };
}

function installChildProcessAudit(service) {
  const childProcess = require('child_process');
  if (childProcess.__chatcodeAuditInstalled) return;
  childProcess.__chatcodeAuditInstalled = true;

  const hidden = options => process.platform === 'win32' ? { ...(options || {}), windowsHide:true } : { ...(options || {}) };
  const attach = (child, executable, args, options = {}) => {
    const started = Date.now(), source = classifyProcess(executable, args);
    service.appendEvent({ type:'process', phase:'spawn', source, executable, args, pid:child?.pid, windowsHide:options?.windowsHide === true }).catch(() => {});
    child?.once?.('error', error => service.appendEvent({ type:'process', phase:'error', source, executable, args, pid:child?.pid, durationMs:Date.now()-started, windowsHide:options?.windowsHide === true, error:String(error?.message || error) }).catch(() => {}));
    child?.once?.('exit', code => service.appendEvent({ type:'process', phase:'exit', source, executable, args, pid:child?.pid, exitCode:code, durationMs:Date.now()-started, windowsHide:options?.windowsHide === true }).catch(() => {}));
    return child;
  };

  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function patchedSpawn(command, args, options) {
    const actualArgs = Array.isArray(args) ? args : [];
    let actualOptions, child;
    if (Array.isArray(args)) {
      actualOptions = hidden(options && typeof options === 'object' ? options : {});
      child = originalSpawn.call(this, command, args, actualOptions);
    } else {
      actualOptions = hidden(args && typeof args === 'object' ? args : {});
      child = originalSpawn.call(this, command, actualOptions);
    }
    return attach(child, command, actualArgs, actualOptions);
  };

  const originalExecFile = childProcess.execFile;
  childProcess.execFile = function patchedExecFile(file, ...rest) {
    let actualArgs = [], actualOptions = {}, callArgs;
    if (Array.isArray(rest[0])) {
      actualArgs = rest[0];
      if (rest[1] && typeof rest[1] === 'object' && typeof rest[1] !== 'function') {
        actualOptions = hidden(rest[1]);
        callArgs = [file, actualArgs, actualOptions, ...rest.slice(2)];
      } else {
        actualOptions = hidden({});
        callArgs = [file, actualArgs, actualOptions, ...rest.slice(1)];
      }
    } else if (rest[0] && typeof rest[0] === 'object' && typeof rest[0] !== 'function') {
      actualOptions = hidden(rest[0]);
      callArgs = [file, actualOptions, ...rest.slice(1)];
    } else {
      actualOptions = hidden({});
      callArgs = [file, actualOptions, ...rest];
    }
    const child = originalExecFile.apply(this, callArgs);
    return attach(child, file, actualArgs, actualOptions);
  };
}

module.exports = { createSupportService, installChildProcessAudit, classifyProcess };
