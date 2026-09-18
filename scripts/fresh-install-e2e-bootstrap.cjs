const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildFreshInstallBootstrap } = require('../core/fresh-install-bootstrap');

const root = path.resolve(process.argv[2] || '');
if (!root) throw new Error('site root required');

const token = 'a'.repeat(64);
const installId = 'b'.repeat(32);
const themePath = path.join(root,'.chatcode-theme-e2e.zip');
const themeSha = crypto.createHash('sha256').update(fs.readFileSync(themePath)).digest('hex');

const php = buildFreshInstallBootstrap({
  token,
  installId,
  bridgeName:'chatcode-install-e2e.php',
  themePackageName:'.chatcode-theme-e2e.zip',
  themeSha256:themeSha,
  themeSlug:'bricks',
  themeEntry:'style.css',
  themeArchiveLayout:'flat'
});

fs.writeFileSync(path.join(root,'chatcode-install-e2e.php'),php,'utf8');
process.stdout.write(JSON.stringify({token,installId,themeSha}));
