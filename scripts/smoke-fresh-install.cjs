const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFreshInstallService, normalizeDomain, checkpointAtLeast } = require('../core/fresh-install-runtime');
const { buildFreshInstallBootstrap } = require('../core/fresh-install-bootstrap');
const { DEFAULT_CATALOG, parsePackageHeaderVersion } = require('../core/fresh-install-packages');

(async () => {
  assert.equal(normalizeDomain('https://Example.COM/'), 'example.com');
  assert.equal(checkpointAtLeast('installed','uploaded'), true);
  assert.equal(checkpointAtLeast('uploaded','verified'), false);
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
    themeEntry:'bricks/style.css'
  });
  for (const required of [
    'CORE_DOWNLOAD_FAILED',
    'PLUGIN_DOWNLOAD_FAILED',
    'PLUGIN_FALLBACK_INVALID',
    'SITE_NOT_EMPTY',
    'CMD_API_DATABASES',
    'chatcode_install_marker',
    'BRICKS_LICENSE_KEY',
    'wordpress.org/latest.zip',
    'checksum_sha256',
    'wp_install(',
    "switch_theme($activeTheme)",
    "activate_plugin((string)$plugin['entry'])"
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
    theme:{ id:'wordpress-default', version:'latest' }
  });