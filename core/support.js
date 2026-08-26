const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MAX_NOTE_CHARS = 24000;
const MAX_EVENTS = 1200;

function createSupportService(app) {
  const root = () => path.join(app.getPath('userData'), 'support');
  const eventDir = () => path.join(root(), 'terminal-events');
  const noteFile = () => path.join(root(), 'notes.md');

  async function ensure() {
    await fsp.mkdir(eventDir(), { recursive: true });
  }

  function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

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
    const list = Array.isArray(args) ? args : [];
    const out = [];
    for (let i = 0; i < Math.min(list.length, 40); i++) {
      const raw = String(list[i] ?? '');
      const previous = String(list[i - 1] ?? '').toLowerCase();
      if (previous === '--token' || previous === '-token') out.push('<redacted>');
      else if (/^--?token=/i.test(raw)) out.push(raw.replace(/=.*/, '=<redacted>'));
      else out.push(redactText(raw));
    }
    return out;
  }

  async function appendEvent(incoming = {}) {
    await ensure();
    const at = incoming.at || new Date().toISOString();
    const event = {
      id: incoming.id || crypto.randomUUID(),
      at,
      type: String(incoming.type || 'process'),
      phase: String(incoming.phase || 'event'),
      source: String(incoming.source || 'unknown').slice(0, 80),
      project: String(incoming.project || '').slice(0, 120),
      executable: path.basename(String(incoming.executable || '')).slice(0, 160),
      args: sanitizeArgs(incoming.args),
      pid: Number(incoming.pid) || null,
      exitCode: Number.isFinite(Number(incoming.exitCode)) ? Number(incoming.exitCode) : null,
      durationMs: Math.max(0, Number(incoming.durationMs) || 0),
      windowsHide: incoming.windowsHide !== false,
      note: redactText(incoming.note || ''),
      error: redactText(incoming.error || '')
    };
    const file = path.join(eventDir(), `${dayKey(new Date(at))}.jsonl`);
    await fsp.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  async function markTerminalFlash(note = '') {
    return appendEvent({ type: 'terminal-flash-marker', phase: 'observed', source: 'user', windowsHide: false, note: note || 'Người dùng vừa thấy cửa sổ terminal nháy.' });
  }

  async function listEvents(limit = 240) {
    await ensure();
    const names = (await fsp.readdir(eventDir()).catch(() => [])).filter(name => name.endsWith('.jsonl')).sort().reverse();
    const events = [];
    for (const name of names) {
      if (events.length >= Math.min(MAX_EVENTS, Math.max(1, Number(limit) || 240))) break;
      const text = await fsp.readFile(path.join(eventDir(), name), 'utf8').catch(() => '');
      const lines = text.split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        try { events.push(JSON.parse(line)); } catch {}
        if (events.length >= Math.min(MAX_EVENTS, Math.max(1, Number(limit) || 240))) break;
      }
    }
    return events;
  }

  async function getNote() {
    await ensure();
    return (await fsp.readFile(noteFile(), 'utf8').catch(() => '')).slice(0, MAX_NOTE_CHARS);
  }

  async function saveNote(text) {
    await ensure();
    const value = String(text || '').slice(0, MAX_NOTE_CHARS);
    await fsp.writeFile(noteFile(), value, 'utf8');
    return { ok: true, length: value.length, updatedAt: new Date().toISOString() };
  }

  async function report({ version = '', platform = process.platform, limit = 120 } = {}) {
    const [note, events] = await Promise.all([getNote(), listEvents(limit)]);
    return {
      schema: 'chatcode-support-v1',
      generatedAt: new Date().toISOString(),
      app: 'ChatCode Cá Nhân',
      version,
      platform,
      note,
      terminalEvents: events,
      privacy: 'Token, MCP secret và chuỗi giống credential được redacted. Không thu stdout/stderr hoặc nội dung file.'
    };
  }

  return { root, eventDir, appendEvent, markTerminalFlash, listEvents, getNote, saveNote, report };
}

module.exports = { createSupportService };
