const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const RELEASE_API = 'https://api.github.com/repos/LuongVanDuy/chatcode/releases/latest';

function parseVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').split('-')[0].split('.').map(n => Number(n) || 0).slice(0, 3);
}
function compareVersions(a, b) {
  const aa = parseVersion(a), bb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (aa[i] || 0) - (bb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function createUpdateService(app, shell, store, { onChanged } = {}) {
  let status = {
    state: 'idle',
    currentVersion: app.getVersion(),
    latestVersion: '',
    releaseUrl: '',
    assetUrl: '',
    assetName: '',
    downloadedPath: '',
    downloadedBytes: 0,
    totalBytes: 0,
    lastCheckAt: store.read().updates?.lastCheckAt || '',
    error: ''
  };

  const emit = () => onChanged?.({ ...status });
  const snapshot = () => ({ ...status });

  function saveUpdateState(patch) {
    const state = store.read();
    state.updates = { ...(state.updates || {}), ...patch };
    store.write(state);
  }

  async function check({ silent = false } = {}) {
    status = { ...status, state: 'checking', error: '', downloadedBytes: 0, totalBytes: 0 };
    emit();
    try {
      const response = await fetch(RELEASE_API, {
        headers: { 'user-agent': `ChatCode-Ca-Nhan/${app.getVersion()}`, accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(12000)
      });
      const checkedAt = new Date().toISOString();
      if (response.status === 404) {
        status = { ...status, state: 'no-release', lastCheckAt: checkedAt, latestVersion: '', releaseUrl: '', assetUrl: '', assetName: '' };
        saveUpdateState({ lastCheckAt: checkedAt, lastError: '' });
        emit();
        return snapshot();
      }
      if (!response.ok) throw new Error(`GitHub Releases trả HTTP ${response.status}`);
      const release = await response.json();
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const escapedVersion = latestVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const preferred = assets.find(asset => new RegExp(`ChatCode-Ca-Nhan-Setup-${escapedVersion}\\.exe$`, 'i').test(asset.name))
        || assets.find(asset => /ChatCode-Ca-Nhan-Setup-.*\.exe$/i.test(asset.name));
      const available = latestVersion && compareVersions(latestVersion, app.getVersion()) > 0;
      status = {
        ...status,
        state: available ? (preferred ? 'available' : 'available-no-asset') : 'up-to-date',
        latestVersion,
        releaseUrl: String(release.html_url || ''),
        assetUrl: String(preferred?.browser_download_url || ''),
        assetName: String(preferred?.name || ''),
        downloadedPath: '',
        lastCheckAt: checkedAt,
        error: ''
      };
      saveUpdateState({ lastCheckAt: checkedAt, lastError: '' });
      emit();
      return snapshot();
    } catch (error) {
      const message = String(error?.message || error);
      status = { ...status, state: 'error', error: message, lastCheckAt: new Date().toISOString() };
      saveUpdateState({ lastCheckAt: status.lastCheckAt, lastError: message });
      emit();
      if (!silent) throw error;
      return snapshot();
    }
  }

  async function download() {
    if (!status.assetUrl || !status.latestVersion) throw new Error('Chưa có bản cập nhật có thể tải. Hãy kiểm tra cập nhật trước.');
    const dir = path.join(app.getPath('userData'), 'updates');
    await fsp.mkdir(dir, { recursive: true });
    const fileName = status.assetName || `ChatCode-Ca-Nhan-Setup-${status.latestVersion}.exe`;
    const destination = path.join(dir, fileName.replace(/[<>:"/\\|?*]/g, '_'));
    status = { ...status, state: 'downloading', downloadedBytes: 0, totalBytes: 0, error: '' };
    emit();
    try {
      const response = await fetch(status.assetUrl, {
        headers: { 'user-agent': `ChatCode-Ca-Nhan/${app.getVersion()}` },
        redirect: 'follow',
        signal: AbortSignal.timeout(10 * 60 * 1000)
      });
      if (!response.ok || !response.body) throw new Error(`Không thể tải installer (HTTP ${response.status}).`);
      status.totalBytes = Math.max(0, Number(response.headers.get('content-length')) || 0);
      let lastEmit = 0;
      const source = Readable.fromWeb(response.body);
      source.on('data', chunk => {
        status.downloadedBytes += chunk.length;
        if (Date.now() - lastEmit > 350) { lastEmit = Date.now(); emit(); }
      });
      await pipeline(source, fs.createWriteStream(destination));
      status = { ...status, state: 'downloaded', downloadedPath: destination, error: '' };
      emit();
      return snapshot();
    } catch (error) {
      try { await fsp.rm(destination, { force: true }); } catch {}
      status = { ...status, state: 'error', error: String(error?.message || error) };
      emit();
      throw error;
    }
  }

  async function install() {
    if (!status.downloadedPath) throw new Error('Chưa tải installer cập nhật.');
    try { await fsp.access(status.downloadedPath); } catch { throw new Error('File installer cập nhật không còn tồn tại.'); }
    const result = await shell.openPath(status.downloadedPath);
    if (result) throw new Error(result);
    saveUpdateState({ lastInstalledVersion: status.latestVersion || '', lastError: '' });
    status = { ...status, state: 'installing' };
    emit();
    setTimeout(() => app.quit(), 700);
    return true;
  }

  function autoCheck() {
    if (!app.isPackaged || !store.settings().autoUpdateCheck) return;
    const last = Date.parse(store.read().updates?.lastCheckAt || '') || 0;
    if (Date.now() - last < 12 * 60 * 60 * 1000) return;
    setTimeout(() => check({ silent: true }).catch(() => {}), 7000);
  }

  return { snapshot, check, download, install, autoCheck };
}

module.exports = { createUpdateService, compareVersions };
