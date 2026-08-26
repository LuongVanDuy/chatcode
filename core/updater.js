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

function releaseUrl(version) {
  const clean = String(version || '').replace(/^v/i, '');
  return clean ? `https://github.com/LuongVanDuy/chatcode/releases/tag/v${clean}` : 'https://github.com/LuongVanDuy/chatcode/releases';
}

function createUpdateService(app, _shell, store, { onChanged } = {}) {
  let updater = null;
  let wired = false;
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
    downloadPercent: 0,
    bytesPerSecond: 0,
    verified: false,
    canSilentInstall: process.platform === 'win32',
    provider: 'GitHub Releases · electron-updater',
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

  function setStatus(patch) {
    status = { ...status, ...patch };
    emit();
    return snapshot();
  }

  function ensureUpdater() {
    if (updater) return updater;
    if (!app.isPackaged) return null;
    const electronUpdater = require('electron-updater');
    updater = electronUpdater.autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    if ('disableWebInstaller' in updater) updater.disableWebInstaller = true;

    if (!wired) {
      wired = true;
      updater.on('checking-for-update', () => {
        setStatus({ state:'checking', error:'', verified:false, downloadPercent:0, downloadedBytes:0, totalBytes:0, bytesPerSecond:0 });
      });
      updater.on('update-available', info => {
        const latestVersion = String(info?.version || '').replace(/^v/i, '');
        setStatus({
          state:'available', latestVersion,
          releaseUrl:releaseUrl(latestVersion),
          assetName:`ChatCode-Ca-Nhan-Setup-${latestVersion}.exe`,
          downloadedPath:'', downloadedBytes:0, totalBytes:0, downloadPercent:0, bytesPerSecond:0,
          verified:false, error:''
        });
      });
      updater.on('update-not-available', info => {
        const latestVersion = String(info?.version || app.getVersion()).replace(/^v/i, '');
        setStatus({ state:'up-to-date', latestVersion, releaseUrl:releaseUrl(latestVersion), downloadedPath:'', verified:false, error:'' });
      });
      updater.on('download-progress', progress => {
        setStatus({
          state:'downloading',
          downloadedBytes:Math.max(0, Number(progress?.transferred) || 0),
          totalBytes:Math.max(0, Number(progress?.total) || 0),
          downloadPercent:Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
          bytesPerSecond:Math.max(0, Number(progress?.bytesPerSecond) || 0),
          error:''
        });
      });
      updater.on('update-downloaded', info => {
        const latestVersion = String(info?.version || status.latestVersion || '').replace(/^v/i, '');
        setStatus({
          state:'downloaded', latestVersion,
          releaseUrl:releaseUrl(latestVersion),
          downloadedPath:String(info?.downloadedFile || status.downloadedPath || ''),
          downloadPercent:100,
          downloadedBytes:status.totalBytes || status.downloadedBytes,
          verified:true,
          error:''
        });
      });
      updater.on('error', error => {
        const message = String(error?.message || error || 'Không thể cập nhật ứng dụng.');
        const noRelease = /404|latest\.yml|no published versions|cannot find.*release/i.test(message);
        setStatus({ state:noRelease ? 'no-release' : 'error', error:noRelease ? '' : message, verified:false });
      });
    }
    return updater;
  }

  async function check({ silent = false } = {}) {
    const checkedAt = new Date().toISOString();
    if (!app.isPackaged) {
      saveUpdateState({ lastCheckAt:checkedAt, lastError:'' });
      return setStatus({ state:'development', lastCheckAt:checkedAt, latestVersion:app.getVersion(), error:'' });
    }
    const instance = ensureUpdater();
    setStatus({ state:'checking', error:'', lastCheckAt:checkedAt, verified:false, downloadPercent:0, downloadedBytes:0, totalBytes:0, bytesPerSecond:0 });
    try {
      const result = await instance.checkForUpdates();
      const latestVersion = String(result?.updateInfo?.version || status.latestVersion || app.getVersion()).replace(/^v/i, '');
      if (result && typeof result.isUpdateAvailable === 'boolean') {
        if (result.isUpdateAvailable && status.state === 'checking') setStatus({ state:'available', latestVersion, releaseUrl:releaseUrl(latestVersion), assetName:`ChatCode-Ca-Nhan-Setup-${latestVersion}.exe` });
        if (!result.isUpdateAvailable && status.state === 'checking') setStatus({ state:'up-to-date', latestVersion, releaseUrl:releaseUrl(latestVersion) });
      }
      status.lastCheckAt = checkedAt;
      saveUpdateState({ lastCheckAt:checkedAt, lastError:'' });
      emit();
      return snapshot();
    } catch (error) {
      const message = String(error?.message || error);
      const noRelease = /404|latest\.yml|no published versions|cannot find.*release/i.test(message);
      status = { ...status, state:noRelease ? 'no-release' : 'error', error:noRelease ? '' : message, lastCheckAt:checkedAt };
      saveUpdateState({ lastCheckAt:checkedAt, lastError:noRelease ? '' : message });
      emit();
      if (!silent && !noRelease) throw error;
      return snapshot();
    }
  }

  async function download() {
    if (!app.isPackaged) throw new Error('Updater chỉ hoạt động trong bản đã cài đặt.');
    const instance = ensureUpdater();
    if (status.state !== 'available') {
      const checked = await check();
      if (checked.state !== 'available') {
        if (checked.state === 'up-to-date') return checked;
        throw new Error('Chưa có bản cập nhật mới để tải.');
      }
    }
    setStatus({ state:'downloading', error:'', downloadedBytes:0, totalBytes:0, downloadPercent:0, bytesPerSecond:0, verified:false });
    try {
      const files = await instance.downloadUpdate();
      if (status.state !== 'downloaded') {
        const downloadedPath = Array.isArray(files) && files.length ? String(files[0] || '') : '';
        setStatus({ state:'downloaded', downloadedPath, downloadPercent:100, verified:true, error:'' });
      }
      return snapshot();
    } catch (error) {
      const message = String(error?.message || error);
      setStatus({ state:'error', error:message, verified:false });
      throw error;
    }
  }

  async function install() {
    if (!app.isPackaged) throw new Error('Updater chỉ hoạt động trong bản đã cài đặt.');
    if (status.state !== 'downloaded') throw new Error('Bản cập nhật chưa tải xong.');
    const instance = ensureUpdater();
    saveUpdateState({ lastInstalledVersion:status.latestVersion || '', lastError:'' });
    setStatus({ state:'installing', error:'', verified:true });
    setTimeout(() => {
      try {
        // electron-updater v6 / electron-builder v26: silent NSIS install + force relaunch.
        instance.quitAndInstall(true, true);
      } catch (error) {
        setStatus({ state:'error', error:String(error?.message || error) });
      }
    }, 450);
    return true;
  }

  async function apply() {
    const downloaded = await download();
    if (downloaded.state === 'up-to-date') return downloaded;
    await install();
    return snapshot();
  }

  function autoCheck() {
    if (!app.isPackaged || !store.settings().autoUpdateCheck) return;
    const last = Date.parse(store.read().updates?.lastCheckAt || '') || 0;
    if (Date.now() - last < 12 * 60 * 60 * 1000) return;
    setTimeout(() => check({ silent:true }).catch(() => {}), 7000);
  }

  return { snapshot, check, download, install, apply, autoCheck };
}

module.exports = { createUpdateService, compareVersions, parseVersion };
