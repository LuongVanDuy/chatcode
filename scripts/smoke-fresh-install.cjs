const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFreshInstallService, normalizeDomain, checkpointAtLeast, allowsRemoteClear, buildUploadRanges } = require('../core/fresh-install-runtime');
const { buildFreshInstallBootstrap } = require('../core/fresh-install-bootstrap');
const { DEFAULT_CATALOG, parsePackageHeaderVersion, detectThemeRoot } = require('../core/fresh-install-packages');

(async () => {
  assert.equal(normalizeDomain('https://Example.COM/'), 'example.com');
  assert.equal(checkpointAtLeast('installed','uploaded'), true);
  assert.equal(checkpointAtLeast('uploaded','verified'), false);
  const ranges = buildUploadRanges(29 * 1024 * 1024,16);
  assert.equal(ranges.length,16);
  assert.equal(ranges.reduce((sum,item) => sum + item.length,0),29 * 1024 * 1024);
  for (let index=1; index<ranges.length; index++) {
    assert.equal(ranges[index].offset,ranges[index - 1].offset + ranges[index - 1].length);
  }
  assert.equal(buildUploadRanges(512 * 1024,16).length,1);
  assert.equal(detectThemeRoot(['style.css','functions.php']), '');
  assert.equal(detectThemeRoot(['bricks/style.css','bricks/functions.php']), 'bricks');
  assert.equal(parsePackageHeaderVersion(`/*
Theme Name: Bricks
Version: 2.4
*/`),'2.4');
  assert.equal(parsePackageHeaderVersion(`/**
 * Plugin Name: Duy Anh Web Pro
 * Version:     1.9.4
 */`),'1.9.4');

  const plugin = DEFAULT_CATALOG.plugins.find(item => item.id === 'duyanhwebpro');
  assert.equal(plugin.fallback_version, '1.9.4');
  assert.equal(plugin.entry, 'duyanhwebpro/duyanhwebpro.php');
  assert.match(plugin.manifest_url, /^https:\/\//);
  const bricks = DEFAULT_CATALOG.themes.find(item => item.id === 'bricks');
  assert.equal(bricks.latest_stable, '2.4');
  assert.equal(bricks.requires_package, true);

  const php = buildFreshInstallBootstrap({
    token:'a'.repeat(64),
    installId:'b'.repeat(32),
    bridgeName:'chatcode-install-test.php',
    themePackageName:'.chatcode-theme-test.zip',
    themeSha256:'c'.repeat(64),
    themeSlug:'bricks',
    themeEntry:'style.css',
    themeArchiveLayout:'flat'
  });
  for (const required of [
    'CORE_DOWNLOAD_FAILED',
    'PLUGIN_DOWNLOAD_FAILED',
    'PLUGIN_FALLBACK_INVALID',
    'SITE_NOT_EMPTY',
    'REMOTE_WIPE_FAILED',
    'UPLOAD_VERIFY_FAILED',
    'UPLOAD_PART_MISSING',
    'UPLOAD_ASSEMBLY_FAILED',
    "if ($action === 'probe')",
    "if ($action === 'inspect-upload')",
    "if ($action === 'assemble-upload')",
    'cc_prepare_remote_root',
    ".well-known",
    ".ftpquota",
    "clearRemote",
    'CMD_API_DATABASES',
    'chatcode_install_marker',
    'BRICKS_LICENSE_KEY',
    "\\$table_prefix='",
    "const CC_THEME_LAYOUT = 'flat';",
    "$themeTarget=$themesRoot.'/'.CC_THEME_SLUG",
    'wordpress.org/latest.zip',
    'checksum_sha256',
    'wp_install(',
    "switch_theme($ccActiveTheme)",
    "activate_plugin($ccPluginEntry)"
  ]) assert.ok(php.includes(required), required);

  const root = fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-fresh-test-'));
  const app = { getPath: name => {
    assert.equal(name,'userData');
    return root;
  }};
  const safeStorage = {
    isEncryptionAvailable:() => true,
    encryptString:value => Buffer.from('enc:' + value,'utf8'),
    decryptString:buffer => {
      const text = buffer.toString('utf8');
      assert.ok(text.startsWith('enc:'));
      return text.slice(4);
    }
  };

  const changes = [];
  const service = createFreshInstallService({ app, safeStorage, onChanged:value => changes.push(value) });
  const catalog = service.catalog();
  assert.equal(catalog.readiness.bricks_2_4, false);
  assert.equal(catalog.readiness.duyanhwebpro_1_9_4, false);
  assert.ok(catalog.plugins.some(item => item.id === 'duyanhwebpro'));

  const task = service.create({
    domain:'demo.example.com',
    username:'hosting_user',
    password:'hosting-password',
    clearRemote:true,
    theme:{ id:'wordpress-default', version:'latest' }
  });
  assert.equal(task.status,'ready');
  assert.equal(task.checkpoint,'created');
  assert.equal(task.manifest.wordpress.source,'wordpress.org');
  assert.equal(task.manifest.plugins[0].fallback_version,'1.9.4');
  assert.equal(task.remote_policy.clear_remote,true);
  assert.equal(allowsRemoteClear(task),true);

  const guardedTask = service.create({
    domain:'guarded.example.com',
    username:'hosting_user',
    password:'hosting-password',
    clearRemote:false,
    theme:{ id:'wordpress-default', version:'latest' }
  });
  assert.equal(allowsRemoteClear(guardedTask),false);
  const confirmed = service.confirmRemoteClear(guardedTask.id);
  assert.equal(confirmed.clear_remote_confirmed,true);
  assert.equal(allowsRemoteClear(confirmed),true);

  const taskFile = path.join(root,'fresh-install','tasks.json');
  const taskText = fs.readFileSync(taskFile,'utf8');
  assert.equal(taskText.includes('hosting-password'), false);
  assert.equal(taskText.includes('databasePassword'), false);
  assert.equal(taskText.includes('adminPassword'), false);
  assert.equal(taskText.includes('bootstrapToken'), false);
  assert.equal(taskText.includes('bricksLicenseKey'), false);

  const vaultText = fs.readFileSync(path.join(root,'fresh-install-secrets.json'),'utf8');
  assert.equal(vaultText.includes('hosting-password'), false);
  assert.equal(vaultText.includes('bootstrapToken'), false);
  assert.ok(vaultText.includes('encrypted'));

  const credentials = service.credentials(task.id);
  assert.equal(credentials.username,'chatcode');
  assert.match(credentials.password,/^[A-Za-z0-9_-]{20,}$/);
  assert.equal(credentials.wp_admin_url,'https://demo.example.com/wp-admin/');

  const runnerSource = fs.readFileSync(path.join(__dirname,'..','tools','fresh-install.ps1'),'utf8');
  assert.equal(runnerSource.includes("            '/'\n          ) | Select-Object -Unique"), false);
  assert.ok(runnerSource.includes("status='sent-unconfirmed'"));
  assert.ok(runnerSource.includes("Test-DefinitiveFtpError"));
  assert.ok(runnerSource.includes("if ($action -eq 'probe-worker')"));
  assert.ok(runnerSource.includes("[long]$Offset = 0"));
  assert.ok(runnerSource.includes("[long]$Length = 0"));
  assert.ok(runnerSource.includes("[bool]$Fast = $false"));
  const runtimeSource = fs.readFileSync(path.join(__dirname,'..','core','fresh-install-runtime.js'),'utf8');
  assert.ok(runtimeSource.includes("uploadBootstrapVerified"));
  assert.ok(runtimeSource.includes("uploadFileVerified"));
  assert.ok(runtimeSource.includes("probeUploadWorkers"));
  assert.ok(runtimeSource.includes("uploadFileFast"));
  assert.ok(runtimeSource.includes("fast:true"));
  assert.ok(runtimeSource.includes("action:'inspect-upload'"));
  assert.ok(runtimeSource.includes("action:'assemble-upload'"));

  assert.equal(service.remove(task.id), true);
  assert.equal(service.remove(guardedTask.id), true);
  assert.equal(service.list().length,0);
  assert.ok(changes.length >= 2);

  fs.rmSync(root,{recursive:true,force:true});
  console.log('Fresh Install smoke PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});