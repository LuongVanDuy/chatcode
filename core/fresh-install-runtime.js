const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildFreshInstallBootstrap, randomInstallToken } = require('./fresh-install-bootstrap');
const { createFreshInstallPackageService, DEFAULT_CATALOG } = require('./fresh-install-packages');
const { createFreshInstallVault } = require('./fresh-install-vault');

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const CHECKPOINTS = ['created','discovered','uploaded','installed','verified','completed'];
const ACTIVE_STATUSES = new Set(['running']);

function checkpointAtLeast(value, target) {
  return CHECKPOINTS.indexOf(String(value || 'created')) >= CHECKPOINTS.indexOf(target);
}

function atomicWrite(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function randomSecret(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^https?:\/\//,'').split('/')[0].replace(/\.$/,'');
  if (!DOMAIN_RE.test(domain)) throw new Error('Domain không hợp lệ.');
  return domain;
}

function normalizeUsername(value) {
  const username = String(value || '').trim();
  if (!username || username.length > 128 || /[\x00-\x1f]/.test(username)) throw new Error('Hosting user không hợp lệ.');
  return username;
}

function publicTask(task) {
  if (!task) return null;
  const clone = JSON.parse(JSON.stringify(task));
  if (clone.manifest?.theme?.package) {
    delete clone.manifest.theme.package.path;
  }
  for (const plugin of clone.manifest?.plugins || []) {
    if (plugin?.fallback_package) delete plugin.fallback_package.path;
  }
  clone.credentials_available = !!task.credentials_available;
  return clone;
}

function resolveRunnerPath() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath,'tools','fresh-install.ps1'));
  candidates.push(path.resolve(__dirname,'..','tools','fresh-install.ps1'));
  return candidates.find(file => fs.existsSync(file)) || '';
}

function runPowerShell(payload, timeoutMs = 120000) {
  const runner = resolveRunnerPath();
  if (!runner) return Promise.reject(new Error('Thiếu tools/fresh-install.ps1.'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe',[
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',runner
    ],{
      windowsHide:true,
      stdio:['pipe','pipe','pipe']
    });
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error('Fresh Install FTP runner timeout.'));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk || ''); if (stdout.length > 4 * 1024 * 1024) stdout = stdout.slice(-4 * 1024 * 1024); });
    child.stderr.on('data', chunk => { stderr += String(chunk || ''); if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024); });
    child.once('error', error => {
      if (settled) return;
      settled = true; clearTimeout(timer); reject(error);
    });
    child.once('exit', code => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      let body = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try { body = JSON.parse(lines[i]); break; } catch {}
      }
      if (!body) return reject(new Error(stderr.trim() || `Fresh Install FTP runner exited ${code}`));
      if (body.ok !== true) {
        const error = new Error(String(body.error || body.message || `Fresh Install FTP runner exited ${code}`));
        error.code = String(body.code || 'FRESH_INSTALL_RUNNER_FAILED');
        error.detail = body;
        return reject(error);
      }
      resolve(body);
    });
    try {
      child.stdin.end(JSON.stringify(payload));
    } catch (error) {
      clearTimeout(timer);
      try { child.kill(); } catch {}
      reject(error);
    }
  });
}

async function httpJson(url, token, payload, timeoutMs = 360000) {
  let response;
  try {
    response = await fetch(url, {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-chatcode-token':token, 'cache-control':'no-store' },
      body:JSON.stringify(payload),
      redirect:'follow',
      signal:AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const wrapped = new Error(`Không gọi được bootstrap qua HTTPS: ${error?.message || error}`);
    wrapped.code = 'BOOTSTRAP_HTTP_FAILED';
    throw wrapped;
  }
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!body || body.ok !== true) {
    const error = new Error(String(body?.message || `Bootstrap HTTP ${response.status}`));
    error.code = String(body?.code || 'BOOTSTRAP_FAILED');
    error.detail = body || { status:response.status, response:text.slice(0,1000) };
    throw error;
  }
  return body;
}

async function verifyPublicUrl(url, timeoutMs = 20000) {
  try {
    const response = await fetch(url, {
      method:'GET',
      redirect:'manual',
      headers:{ 'cache-control':'no-cache', 'user-agent':'ChatCode-Fresh/1.0' },
      signal:AbortSignal.timeout(timeoutMs)
    });
    return { ok:response.status >= 200 && response.status < 400, status:response.status };
  } catch (error) {
    return { ok:false, status:0, error:String(error?.message || error) };
  }
}

function createFreshInstallService({ app, safeStorage, onChanged }) {
  const root = path.join(app.getPath('userData'),'fresh-install');
  const stateFile = path.join(root,'tasks.json');
  const runtimeRoot = path.join(root,'runtime');
  const cacheRoot = path.join(root,'cache');
  const packages = createFreshInstallPackageService(app);
  const vault = createFreshInstallVault(app,safeStorage);
  const running = new Map();

  function readState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile,'utf8'));
      return parsed && Array.isArray(parsed.tasks) ? parsed : { schema:1, tasks:[] };
    } catch {
      return { schema:1, tasks:[] };
    }
  }

  function writeState(state) {
    atomicWrite(stateFile,{ schema:1, tasks:Array.isArray(state.tasks) ? state.tasks.slice(-120) : [] });
  }

  function taskById(id, state = readState()) {
    const task = state.tasks.find(item => item.id === id);
    if (!task) throw new Error('Không tìm thấy Fresh Install task.');
    return task;
  }

  function mutate(id, updater) {
    const state = readState();
    const task = taskById(id,state);
    updater(task);
    task.updated_at = new Date().toISOString();
    task.credentials_available = vault.has(id);
    writeState(state);
    const output = publicTask(task);
    onChanged?.(output);
    return output;
  }

  function appendLog(task, message) {
    const line = `${new Date().toLocaleTimeString('vi-VN',{hour12:false})} · ${message}`;
    task.logs = [...(Array.isArray(task.logs) ? task.logs : []).slice(-79), line];
  }

  function progress(id, stage, percent, message, current = '') {
    return mutate(id, task => {
      task.stage = stage;
      task.percent = Math.max(0,Math.min(100,Number(percent)||0));
      task.message = String(message || '');
      task.current = String(current || '');
      appendLog(task,`${stage} · ${message}${current ? ` · ${current}` : ''}`);
    });
  }

  function setCheckpoint(id, checkpoint, extra = {}) {
    return mutate(id, task => {
      task.checkpoint = checkpoint;
      Object.assign(task,extra);
      appendLog(task,`checkpoint · ${checkpoint}`);
    });
  }

  function recoverInterrupted() {
    const state = readState();
    let changed = false;
    for (const task of state.tasks) {
      if (task.status === 'running') {
        task.status = 'interrupted';
        task.error = 'ChatCode đã đóng khi task đang chạy. Có thể retry từ checkpoint gần nhất.';
        task.error_code = 'TASK_INTERRUPTED';
        task.updated_at = new Date().toISOString();
        appendLog(task,'Task bị gián đoạn; chờ retry');
        changed = true;
      }
    }
    if (changed) writeState(state);
  }
  recoverInterrupted();

  function list() {
    return readState().tasks
      .slice()
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(task => publicTask({ ...task, credentials_available:vault.has(task.id) }));
  }

  function status(id) {
    const task = taskById(id);
    return publicTask({ ...task, credentials_available:vault.has(id) });
  }

  function catalog() {
    return packages.catalog();
  }

  async function importTheme(filePath, options = {}) {
    const result = await packages.importTheme(filePath,options);
    onChanged?.({ type:'catalog', catalog:catalog() });
    return result;
  }

  async function importPlugin(filePath, options = {}) {
    const result = await packages.importPlugin(filePath,options);
    onChanged?.({ type:'catalog', catalog:catalog() });
    return result;
  }

  function create(input = {}) {
    const domain = normalizeDomain(input.domain);
    const username = normalizeUsername(input.username);
    const password = String(input.password || '');
    if (!password || password.length > 4096 || /[\x00-\x1f]/.test(password)) throw new Error('Hosting password không hợp lệ.');
    const theme = packages.resolveTheme(input.theme || { id:'bricks', version:'2.4' });
    if (theme.id === 'bricks' && !theme.package) {
      const error = new Error('Chưa có Bricks 2.4 trong Package Cache. Chọn ZIP Bricks 2.4 một lần trước khi cài.');
      error.code = 'BRICKS_PACKAGE_REQUIRED';
      throw error;
    }
    const state = readState();
    const duplicate = state.tasks.find(item => item.domain === domain && ACTIVE_STATUSES.has(item.status));
    if (duplicate) throw new Error('Domain này đang có Fresh Install task chạy.');

    const id = crypto.randomUUID();
    const short = id.replace(/-/g,'').slice(0,10);
    const installId = crypto.randomBytes(16).toString('hex');
    const safeUser = username.replace(/[^A-Za-z0-9_]/g,'').slice(0,24) || 'chatcode';
    const dbSuffix = `cc${crypto.randomBytes(3).toString('hex')}`;
    const tablePrefix = `wp_${crypto.randomBytes(3).toString('hex')}_`;
    const bridgeName = `chatcode-install-${short}.php`;
    const themeRemoteName = theme.package ? `.chatcode-theme-${short}.zip` : '';
    const pluginFallback = packages.find('duyanhwebpro','1.9.4');
    const plugin = {
      ...DEFAULT_CATALOG.plugins[0],
      fallback_package:pluginFallback ? {
        id:pluginFallback.id,
        version:pluginFallback.version,
        slug:pluginFallback.slug,
        entry:pluginFallback.entry,
        path:pluginFallback.path,
        sha256:pluginFallback.sha256,
        bytes:pluginFallback.bytes,
        remote_name:`.chatcode-plugin-${short}.zip`
      } : null
    };
    const now = new Date().toISOString();
    const task = {
      id,
      type:'wordpress_fresh_install',
      domain,
      site_url:`https://${domain}`,
      status:'ready',
      stage:'created',
      checkpoint:'created',
      percent:0,
      message:'Sẵn sàng cài WordPress',
      current:'',
      error:'',
      error_code:'',
      created_at:now,
      updated_at:now,
      connection:null,
      bootstrap:{
        name:bridgeName
      },
      manifest:{
        schema:1,
        install_id:installId,
        wordpress:{ source:'wordpress.org', version:'latest', fallback_remote_name:'' },
        theme:{
          id:theme.id,
          source:theme.source,
          version:theme.version,
          latest_stable:theme.latest_stable || '',
          active_theme:theme.active_theme || '',
          generated_child:theme.generated_child || '',
          package:theme.package ? {
            ...theme.package,
            remote_name:themeRemoteName
          } : null
        },
        plugins:[plugin],
        database:{
          host:'localhost',
          name:`${safeUser}_${dbSuffix}`,
          user:`${safeUser}_${dbSuffix}`,
          table_prefix:tablePrefix
        },
        admin:{
          username:'chatcode',
          email:`admin@${domain}`
        }
      },
      result:{},
      logs:[]
    };
    vault.set(id,{
      hostingUsername:username,
      hostingPassword:password,
      databasePassword:randomSecret(24),
      adminPassword:randomSecret(24),
      bootstrapToken:randomInstallToken(),
      bricksLicenseKey:String(input.bricksLicenseKey || '').trim()
    });
    task.credentials_available = true;
    appendLog(task,'Đã tạo immutable install manifest');
    state.tasks.push(task);
    writeState(state);
    onChanged?.(publicTask(task));
    return publicTask(task);
  }

  function runtimeDir(id) {
    const dir = path.join(runtimeRoot,id);
    fs.mkdirSync(dir,{ recursive:true });
    return dir;
  }

  function writeBootstrap(task,secrets) {
    const theme = task.manifest.theme;
    const file = path.join(runtimeDir(task.id),task.bootstrap.name);
    const php = buildFreshInstallBootstrap({
      token:secrets.bootstrapToken,
      installId:task.manifest.install_id,
      bridgeName:task.bootstrap.name,
      themePackageName:theme.package?.remote_name || '',
      themeSha256:theme.package?.sha256 || '',
      themeSlug:theme.package?.slug || '',
      themeEntry:theme.package?.expected_entry || ''
    });
    fs.writeFileSync(file,php,'utf8');
    return file;
  }

  async function downloadWordPressFallback(id) {
    await fsp.mkdir(cacheRoot,{ recursive:true });
    const file = path.join(cacheRoot,'wordpress-latest.zip');
    try {
      const stat = await fsp.stat(file);
      if (stat.size >= 5 * 1024 * 1024 && stat.size <= 100 * 1024 * 1024) return file;
    } catch {}
    progress(id,'fallback',45,'Hosting không tải được WordPress; ChatCode đang tải fallback','wordpress.org/latest.zip');
    const response = await fetch('https://wordpress.org/latest.zip',{
      headers:{ 'user-agent':'ChatCode-Fresh/1.0' },
      redirect:'follow',
      signal:AbortSignal.timeout(240000)
    });
    if (!response.ok) throw new Error(`Không tải được WordPress fallback: HTTP ${response.status}`);
    const host = new URL(response.url).hostname.toLowerCase();
    if (!['wordpress.org','downloads.wordpress.org'].includes(host)) throw new Error('WordPress fallback redirect sang host không được phép.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 5 * 1024 * 1024 || buffer.length > 100 * 1024 * 1024) throw new Error('WordPress fallback ZIP có dung lượng không hợp lệ.');
    const temp = `${file}.part`;
    await fsp.writeFile(temp,buffer);
    await fsp.rename(temp,file);
    return file;
  }

  function runnerPayload(task,secrets,action,extra = {}) {
    return {
      action,
      domain:task.domain,
      username:secrets.hostingUsername,
      password:secrets.hostingPassword,
      ...(task.connection ? {
        host:task.connection.host,
        port:task.connection.port,
        protocol:task.connection.protocol,
        remotePath:task.connection.remotePath
      } : {}),
      ...extra
    };
  }

  function bootstrapUrl(task) {
    return `${task.site_url}/${encodeURIComponent(task.bootstrap.name)}`;
  }

  function installPayload(task,secrets,extra = {}) {
    const plugin = task.manifest.plugins[0];
    return {
      action:'install',
      panelUser:secrets.hostingUsername,
      panelPassword:secrets.hostingPassword,
      dbName:task.manifest.database.name,
      dbUser:task.manifest.database.user,
      dbPassword:secrets.databasePassword,
      dbHost:task.manifest.database.host,
      tablePrefix:task.manifest.database.table_prefix,
      siteTitle:task.domain,
      adminUser:task.manifest.admin.username,
      adminEmail:task.manifest.admin.email,
      adminPassword:secrets.adminPassword,
      siteUrl:task.site_url,
      bricksLicenseKey:secrets.bricksLicenseKey || '',
      theme:{
        id:task.manifest.theme.id,
        version:task.manifest.theme.version,
        active_theme:task.manifest.theme.active_theme,
        generated_child:task.manifest.theme.generated_child
      },
      plugin:{
        id:plugin.id,
        slug:plugin.slug,
        entry:plugin.entry,
        fallback_version:plugin.fallback_version,
        manifest_url:plugin.manifest_url,
        fallback_package:extra.pluginFallbackUploaded ? plugin.fallback_package?.remote_name || '' : '',
        fallback_sha256:extra.pluginFallbackUploaded ? plugin.fallback_package?.sha256 || '' : ''
      },
      ...extra
    };
  }

  async function cleanupRemote(task,secrets,names = []) {
    try {
      await httpJson(bootstrapUrl(task),secrets.bootstrapToken,{
        action:'cleanup',
        corePackage:task.manifest.wordpress.fallback_remote_name || '',
        plugin:{ fallback_package:task.manifest.plugins[0]?.fallback_package?.remote_name || '' }
      },60000);
      return;
    } catch {}
    const safeNames = [...new Set(names.filter(Boolean).map(name => path.posix.basename(name)))];
    if (!safeNames.length || !task.connection) return;
    try {
      await runPowerShell(runnerPayload(task,secrets,'delete',{ files:safeNames }),90000);
    } catch {}
  }

  async function execute(id) {
    let task = taskById(id);
    const secrets = vault.get(id);
    try {
      progress(id,'discover',4,'Đang tự phát hiện FTP/FTPS và thư mục website',task.domain);
      task = taskById(id);
      if (!checkpointAtLeast(task.checkpoint,'discovered')) {
        const discovered = await runPowerShell(runnerPayload(task,secrets,'discover'),70000);
        if (discovered.siteNotEmpty) {
          const error = new Error('Thư mục website đang có nội dung. Fresh Install không tự xóa site cũ.');
          error.code = 'SITE_NOT_EMPTY';
          error.detail = discovered;
          throw error;
        }
        setCheckpoint(id,'discovered',{
          connection:{
            host:discovered.host,
            port:Number(discovered.port || 21),
            protocol:discovered.protocol,
            passive:true,
            remotePath:discovered.remotePath
          }
        });
      }

      task = taskById(id);
      if (!checkpointAtLeast(task.checkpoint,'uploaded')) {
        progress(id,'upload',12,'Đang upload bootstrap và private theme package');
        const bootstrapFile = writeBootstrap(task,secrets);
        const files = [{ localPath:bootstrapFile, remoteName:task.bootstrap.name }];
        const themePackage = task.manifest.theme.package;
        if (themePackage?.path) files.push({ localPath:themePackage.path, remoteName:themePackage.remote_name });
        await runPowerShell(runnerPayload(task,secrets,'upload',{ files }),300000);
        setCheckpoint(id,'uploaded');
      }

      task = taskById(id);
      if (!checkpointAtLeast(task.checkpoint,'installed')) {
        progress(id,'install',25,'Hosting đang tải WordPress và plugin rồi cài đặt','server-side fast path');
        let installed;
        try {
          installed = await httpJson(bootstrapUrl(task),secrets.bootstrapToken,installPayload(task,secrets),420000);
        } catch (error) {
          if (error.code === 'CORE_DOWNLOAD_FAILED') {
            const localCore = await downloadWordPressFallback(id);
            task = taskById(id);
            const remoteCore = `.chatcode-wordpress-${task.id.replace(/-/g,'').slice(0,10)}.zip`;
            progress(id,'fallback',52,'Đang upload một WordPress ZIP fallback',remoteCore);
            await runPowerShell(runnerPayload(task,secrets,'upload',{ files:[{ localPath:localCore, remoteName:remoteCore }] }),300000);
            mutate(id,current => { current.manifest.wordpress.fallback_remote_name = remoteCore; });
            try {
              installed = await httpJson(bootstrapUrl(task),secrets.bootstrapToken,installPayload(task,secrets,{ corePackage:remoteCore }),420000);
            } catch (retryError) {
              if (retryError.code !== 'PLUGIN_DOWNLOAD_FAILED') throw retryError;
              error = retryError;
            }
          }
          if (error.code === 'PLUGIN_DOWNLOAD_FAILED') {
            task = taskById(id);
            const fallback = task.manifest.plugins[0]?.fallback_package;
            if (!fallback?.path || !fallback?.remote_name || !fallback?.sha256) {
              const missing = new Error('Update server DuyAnhWebPro không truy cập được và chưa có fallback 1.9.4 trong Package Cache.');
              missing.code = 'PLUGIN_FALLBACK_REQUIRED';
              throw missing;
            }
            progress(id,'fallback',58,'Vendor updater lỗi; đang upload DuyAnhWebPro 1.9.4 fallback',fallback.remote_name);
            await runPowerShell(runnerPayload(task,secrets,'upload',{
              files:[{ localPath:fallback.path, remoteName:fallback.remote_name }]
            }),180000);
            installed = await httpJson(
              bootstrapUrl(task),
              secrets.bootstrapToken,
              installPayload(task,secrets,{
                corePackage:task.manifest.wordpress.fallback_remote_name || '',
                pluginFallbackUploaded:true
              }),
              420000
            );
          } else if (error.code !== 'CORE_DOWNLOAD_FAILED') {
            throw error;
          }
        }
        setCheckpoint(id,'installed',{ result:{ ...(task.result || {}), install:installed } });
      }

      task = taskById(id);
      if (!checkpointAtLeast(task.checkpoint,'verified')) {
        progress(id,'verify',90,'Đang kiểm tra WordPress/theme/plugin trên hosting');
        const verified = await httpJson(bootstrapUrl(task),secrets.bootstrapToken,{
          action:'verify',
          theme:{ active_theme:task.manifest.theme.active_theme },
          plugin:{ entry:task.manifest.plugins[0].entry }
        },90000);
        const [home,login] = await Promise.all([
          verifyPublicUrl(task.site_url),
          verifyPublicUrl(`${task.site_url}/wp-login.php`)
        ]);
        if (!home.ok || !login.ok) {
          const error = new Error(`HTTP verify chưa đạt: home=${home.status}, wp-login=${login.status}`);
          error.code = 'HTTP_VERIFY_FAILED';
          error.detail = { home,login };
          throw error;
        }
        setCheckpoint(id,'verified',{
          result:{ ...(task.result || {}), verify:verified, http:{ home,login } }
        });
      }

      task = taskById(id);
      progress(id,'cleanup',98,'Đang dọn bootstrap/package tạm');
      await cleanupRemote(task,secrets,[
        task.bootstrap.name,
        task.manifest.theme.package?.remote_name,
        task.manifest.plugins[0]?.fallback_package?.remote_name,
        task.manifest.wordpress.fallback_remote_name
      ]);
      mutate(id,current => {
        current.status='completed';
        current.stage='completed';
        current.checkpoint='completed';
        current.percent=100;
        current.message='Cài WordPress hoàn tất';
        current.current=current.site_url;
        current.error='';
        current.error_code='';
        current.completed_at=new Date().toISOString();
        appendLog(current,'SITE_READY');
      });
      return status(id);
    } catch (error) {
      mutate(id,current => {
        current.status='failed';
        current.stage='failed';
        current.error=String(error?.message || error || 'Fresh Install failed').slice(0,1200);
        current.error_code=String(error?.code || 'FRESH_INSTALL_FAILED').slice(0,120);
        current.message='Cài WordPress chưa hoàn tất';
        current.current='';
        current.failure_detail=error?.detail && typeof error.detail === 'object' ? error.detail : null;
        appendLog(current,`FAILED · ${current.error_code} · ${current.error}`);
      });
      throw error;
    }
  }

  function start(id) {
    const current = taskById(id);
    if (running.has(id) || current.status === 'running') return status(id);
    mutate(id,task => {
      task.status='running';
      task.stage=task.checkpoint === 'created' ? 'queued' : 'resuming';
      task.message=task.checkpoint === 'created' ? 'Đang bắt đầu Fresh Install' : `Đang resume từ ${task.checkpoint}`;
      task.error='';
      task.error_code='';
      task.started_at=task.started_at || new Date().toISOString();
      task.attempt_count=Number(task.attempt_count || 0)+1;
      appendLog(task,`Start attempt ${task.attempt_count} từ checkpoint ${task.checkpoint}`);
    });
    const promise = execute(id).finally(() => running.delete(id));
    running.set(id,promise);
    promise.catch(() => {});
    return status(id);
  }

  function retry(id) {
    const task = taskById(id);
    if (task.status === 'completed') return status(id);
    return start(id);
  }

  function remove(id) {
    const task = taskById(id);
    if (running.has(id) || task.status === 'running') throw new Error('Task đang chạy; chưa thể xóa.');
    const state = readState();
    state.tasks = state.tasks.filter(item => item.id !== id);
    writeState(state);
    vault.remove(id);
    try { fs.rmSync(path.join(runtimeRoot,id),{ recursive:true, force:true }); } catch {}
    onChanged?.({ type:'removed', id });
    return true;
  }

  function credentials(id) {
    const task = taskById(id);
    const secrets = vault.get(id);
    return {
      site_url:task.site_url,
      wp_admin_url:`${task.site_url}/wp-admin/`,
      username:task.manifest.admin.username,
      password:secrets.adminPassword
    };
  }

  return {
    catalog,
    list,
    status,
    create,
    start,
    retry,
    remove,
    credentials,
    importTheme,
    importPlugin,
    packageService:packages
  };
}

module.exports = {
  createFreshInstallService,
  normalizeDomain,
  checkpointAtLeast,
  runPowerShell
};