const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const MODE_STANDARD = 'standard';
const MODE_MAXIMUM = 'maximum';
const DEFAULT_MODE = MODE_MAXIMUM;
const QOS_POLICY_NAME = 'ChatCode Browser Priority';
const QOS_DSCP = 46;
const MAX_BROWSER_TABS = 8;

function normalizeMode(value) {
  return value === MODE_STANDARD ? MODE_STANDARD : MODE_MAXIMUM;
}

function escapePowerShell(value) {
  return String(value || '').replace(/'/g, "''");
}

function parseJsonLoose(value) {
  const text = String(value || '').trim();
  if (!text || text === 'null') return null;
  try { return JSON.parse(text); } catch { return null; }
}

function createBrowserPerformanceService({ app, ipcMain, osModule = os, execFileImpl = execFile, processRef = process } = {}) {
  if (!app) throw new Error('Electron app không khả dụng.');
  const listeners = new Set();
  let bootMode = DEFAULT_MODE;
  let startupGpuSwitch = false;
  let lastPriority = { activePid:0, highPids:[], normalPids:[] };

  function configPath() {
    return path.join(app.getPath('userData'), 'browser-performance.json');
  }

  function readConfig() {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
      return { mode:normalizeMode(raw?.mode) };
    } catch {
      return { mode:DEFAULT_MODE };
    }
  }

  function writeConfig(config = {}) {
    const next = { mode:normalizeMode(config.mode) };
    fs.mkdirSync(path.dirname(configPath()), { recursive:true });
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  function isMaximum() {
    return readConfig().mode === MODE_MAXIMUM;
  }

  function applyStartupFlags() {
    bootMode = readConfig().mode;
    if (bootMode === MODE_MAXIMUM) {
      try { app.commandLine?.appendSwitch?.('force_high_performance_gpu'); } catch {}
    }
    try { startupGpuSwitch = !!app.commandLine?.hasSwitch?.('force_high_performance_gpu'); }
    catch { startupGpuSwitch = bootMode === MODE_MAXIMUM; }
    return { mode:bootMode, gpuSwitch:startupGpuSwitch };
  }

  function notify() {
    for (const listener of listeners) {
      try { listener(readConfig()); } catch {}
    }
  }

  function onModeChanged(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setMode(value) {
    const mode = normalizeMode(value);
    writeConfig({ mode });
    notify();
    return {
      mode,
      restartRequired:(mode === MODE_MAXIMUM) !== startupGpuSwitch
    };
  }

  function priorityPid(contents) {
    try { return Math.max(0, Number(contents?.getOSProcessId?.()) || 0); }
    catch { return 0; }
  }

  function setPriority(pid, priority) {
    if (!pid || typeof osModule?.setPriority !== 'function') return false;
    try { osModule.setPriority(pid, priority); return true; }
    catch { return false; }
  }

  function syncTabs(tabList = [], activeTabId = null, visible = true) {
    const maximum = isMaximum();
    const high = new Set();
    const normal = new Set();
    let activePid = 0;

    for (const tab of Array.isArray(tabList) ? tabList : []) {
      const contents = tab?.view?.webContents;
      if (!contents || contents.isDestroyed?.()) continue;
      try { contents.setBackgroundThrottling?.(!maximum); } catch {}
      const pid = priorityPid(contents);
      if (!pid) continue;
      if (maximum && visible && tab.id === activeTabId) {
        high.add(pid);
        activePid = pid;
      } else {
        normal.add(pid);
      }
    }

    for (const pid of high) normal.delete(pid);
    const constants = osModule?.constants?.priority || {};
    const highValue = constants.PRIORITY_HIGH ?? -14;
    const normalValue = constants.PRIORITY_NORMAL ?? 0;
    for (const pid of normal) setPriority(pid, normalValue);
    for (const pid of high) setPriority(pid, highValue);
    lastPriority = { activePid, highPids:[...high], normalPids:[...normal] };
    return { maximum, ...lastPriority };
  }

  function runPowerShell(script, timeout = 5000) {
    if (processRef.platform !== 'win32') return Promise.reject(new Error('Windows PowerShell chỉ khả dụng trên Windows.'));
    return new Promise((resolve, reject) => {
      execFileImpl('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
      ], { windowsHide:true, timeout, maxBuffer:1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const message = String(stderr || error.message || error).trim();
          reject(new Error(message || 'PowerShell thất bại.'));
          return;
        }
        resolve(String(stdout || '').trim());
      });
    });
  }

  async function queryQos() {
    if (processRef.platform !== 'win32') return { supported:false, installed:false, reason:'non-windows' };
    const name = escapePowerShell(QOS_POLICY_NAME);
    try {
      const output = await runPowerShell(`$p=Get-NetQosPolicy -Name '${name}' -ErrorAction SilentlyContinue; if($null -eq $p){'null'}else{$p | Select-Object Name,AppPathNameMatchCondition,DSCPAction,Precedence,NetworkProfile | ConvertTo-Json -Compress}`);
      const value = parseJsonLoose(output);
      return {
        supported:true,
        installed:!!value,
        name:QOS_POLICY_NAME,
        dscp:value?.DSCPAction ?? null,
        precedence:value?.Precedence ?? null,
        app:value?.AppPathNameMatchCondition || '',
        networkProfile:value?.NetworkProfile || ''
      };
    } catch (error) {
      return { supported:false, installed:false, reason:String(error?.message || error).slice(0,240) };
    }
  }

  function elevatedPowerShell(script, timeout = 120000) {
    if (processRef.platform !== 'win32') return Promise.reject(new Error('QoS chỉ được hỗ trợ trên Windows.'));
    const encoded = Buffer.from(String(script || ''), 'utf16le').toString('base64');
    const launcher = `$p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'); exit $p.ExitCode`;
    return runPowerShell(launcher, timeout);
  }

  async function installQos() {
    const name = escapePowerShell(QOS_POLICY_NAME);
    const executable = escapePowerShell(processRef.execPath || 'ChatCode Cá Nhân.exe');
    const script = [
      `$ErrorActionPreference='Stop'`,
      `$existing=Get-NetQosPolicy -Name '${name}' -ErrorAction SilentlyContinue`,
      `if($null -ne $existing){Remove-NetQosPolicy -Name '${name}' -Confirm:$false}`,
      `New-NetQosPolicy -Name '${name}' -AppPathNameMatchCondition '${executable}' -DSCPAction ${QOS_DSCP} -Precedence 255 -NetworkProfile All | Out-Null`
    ].join(';');
    await elevatedPowerShell(script);
    return queryQos();
  }

  async function removeQos() {
    const name = escapePowerShell(QOS_POLICY_NAME);
    const script = `$ErrorActionPreference='Stop'; $existing=Get-NetQosPolicy -Name '${name}' -ErrorAction SilentlyContinue; if($null -ne $existing){Remove-NetQosPolicy -Name '${name}' -Confirm:$false}`;
    await elevatedPowerShell(script);
    return queryQos();
  }

  async function networkAdapters() {
    if (processRef.platform !== 'win32') {
      const names = Object.keys(osModule?.networkInterfaces?.() || {});
      return names.map(name => ({ name, description:'', linkSpeed:'', mediaType:'' }));
    }
    try {
      const output = await runPowerShell(`Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object Name,InterfaceDescription,LinkSpeed,MediaType | ConvertTo-Json -Compress`, 5000);
      const parsed = parseJsonLoose(output);
      const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      return list.map(item => ({
        name:String(item?.Name || ''),
        description:String(item?.InterfaceDescription || ''),
        linkSpeed:String(item?.LinkSpeed || ''),
        mediaType:String(item?.MediaType || '')
      }));
    } catch {
      return [];
    }
  }

  async function gpuSnapshot() {
    try { await app.whenReady?.(); } catch {}
    let features = {};
    let info = {};
    try { features = app.getGPUFeatureStatus?.() || {}; } catch {}
    try { info = await app.getGPUInfo?.('basic') || {}; } catch {}
    const devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice : [];
    const active = devices.find(device => device?.active) || devices[0] || null;
    return {
      switchActive:startupGpuSwitch,
      restartRequired:(isMaximum()) !== startupGpuSwitch,
      activeDevice:active ? {
        active:!!active.active,
        vendorId:active.vendorId ?? null,
        deviceId:active.deviceId ?? null,
        vendorString:String(active.vendorString || active.driverVendor || ''),
        deviceString:String(active.deviceString || ''),
        driverVendor:String(active.driverVendor || ''),
        driverVersion:String(active.driverVersion || '')
      } : null,
      features
    };
  }

  async function snapshot() {
    const config = readConfig();
    const [gpu, qos, adapters] = await Promise.all([gpuSnapshot(), queryQos(), networkAdapters()]);
    return {
      mode:config.mode,
      maximum:config.mode === MODE_MAXIMUM,
      maxTabs:MAX_BROWSER_TABS,
      cpu:{
        activePriority:config.mode === MODE_MAXIMUM ? 'HIGH' : 'NORMAL',
        backgroundThrottling:config.mode !== MODE_MAXIMUM,
        activePid:lastPriority.activePid,
        highPids:lastPriority.highPids
      },
      memory:{ keepTabsWarm:true, discardPolicy:'none', hardMemoryLimit:false },
      gpu,
      network:{ bandwidthThrottle:false, adapters, qos },
      qos:{ policyName:QOS_POLICY_NAME, dscp:QOS_DSCP, ...qos }
    };
  }

  function installIpc() {
    if (!ipcMain?.handle) return;
    ipcMain.handle('browser-performance:get', () => snapshot());
    ipcMain.handle('browser-performance:set-mode', (_event, mode) => setMode(mode));
    ipcMain.handle('browser-performance:qos-install', () => installQos());
    ipcMain.handle('browser-performance:qos-remove', () => removeQos());
  }

  return {
    readConfig,
    setMode,
    isMaximum,
    applyStartupFlags,
    onModeChanged,
    syncTabs,
    snapshot,
    queryQos,
    installQos,
    removeQos,
    networkAdapters,
    installIpc,
    get bootMode() { return bootMode; },
    get startupGpuSwitch() { return startupGpuSwitch; }
  };
}

let installed = null;
function installBrowserPerformance() {
  if (installed) return installed;
  const { app, ipcMain } = require('electron');
  installed = createBrowserPerformanceService({ app, ipcMain });
  installed.applyStartupFlags();
  installed.installIpc();
  return installed;
}

function getBrowserPerformanceService() {
  return installed;
}

module.exports = {
  MODE_STANDARD,
  MODE_MAXIMUM,
  DEFAULT_MODE,
  QOS_POLICY_NAME,
  QOS_DSCP,
  MAX_BROWSER_TABS,
  normalizeMode,
  createBrowserPerformanceService,
  installBrowserPerformance,
  getBrowserPerformanceService
};
