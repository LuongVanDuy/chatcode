const fs = require('fs');
const path = require('path');

function atomicWrite(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function createFreshInstallVault(app, safeStorage) {
  const file = path.join(app.getPath('userData'), 'fresh-install-secrets.json');

  function ensureAvailable() {
    if (!safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('Windows Secure Storage chưa sẵn sàng để lưu credential cài WordPress.');
    }
  }

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : { schema:1, entries:{} };
    } catch {
      return { schema:1, entries:{} };
    }
  }

  function write(state) {
    atomicWrite(file, {
      schema:1,
      entries:state?.entries && typeof state.entries === 'object' ? state.entries : {}
    });
  }

  function set(id, value) {
    ensureAvailable();
    const key = String(id || '').trim();
    if (!key) throw new Error('Thiếu install task id.');
    const state = read();
    const encrypted = safeStorage.encryptString(JSON.stringify(value || {})).toString('base64');
    state.entries[key] = {
      encrypted,
      updated_at:new Date().toISOString()
    };
    write(state);
    return true;
  }

  function get(id) {
    ensureAvailable();
    const state = read();
    const item = state.entries[String(id || '')];
    if (!item?.encrypted) throw new Error('Không tìm thấy credential của install task.');
    let decoded;
    try {
      decoded = safeStorage.decryptString(Buffer.from(item.encrypted, 'base64'));
    } catch (error) {
      throw new Error(`Không giải mã được credential install task: ${error?.message || error}`);
    }
    let parsed;
    try { parsed = JSON.parse(decoded); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object') throw new Error('Credential install task không hợp lệ.');
    return parsed;
  }

  function remove(id) {
    const state = read();
    const key = String(id || '');
    if (!Object.prototype.hasOwnProperty.call(state.entries,key)) return false;
    delete state.entries[key];
    write(state);
    return true;
  }

  function has(id) {
    const state = read();
    return !!state.entries[String(id || '')]?.encrypted;
  }

  return { set, get, remove, has };
}

module.exports = { createFreshInstallVault };
