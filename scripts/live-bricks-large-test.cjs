const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFreshInstallService } = require('../core/fresh-install-runtime');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function safeStorageMock() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from('live:' + String(value || ''), 'utf8'),
    decryptString: buffer => {
      const text = Buffer.from(buffer).toString('utf8');
      if (!text.startsWith('live:')) throw new Error('Invalid test vault payload');
      return text.slice(5);
    }
  };
}

function resultView(task) {
  const install = task?.result?.install || {};
  const verify = task?.result?.verify || {};
  const http = task?.result?.http || {};
  return {
    status: task?.status || '',
    checkpoint: task?.checkpoint || '',
    site_url: task?.site_url || '',
    protocol: task?.connection?.protocol || '',
    remotePath: task?.connection?.remotePath || '',
    wordpressVersion: verify.wordpressVersion || install.wordpressVersion || '',
    activeTheme: verify.activeTheme || install.activeTheme || '',
    pluginVersion: install.pluginVersion || '',
    pluginActive: verify.pluginActive === true,
    homeStatus: http?.home?.status || 0,
    loginStatus: http?.login?.status || 0,
    completed_at: task?.completed_at || ''
  };
}

(async () => {
  const credentialFile = process.argv[2];
  const themeZip = process.argv[3];
  if (!credentialFile || !themeZip) throw new Error('Credential file and theme ZIP are required.');

  const creds = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  if (creds.domain !== 'thanhdofood.com') throw new Error('Live test domain mismatch.');

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-live-bricks-'));
  const app = { getPath(name) {
    if (name !== 'userData') throw new Error('Unexpected app path request: ' + name);
    return userData;
  }};

  const service = createFreshInstallService({
    app,
    safeStorage: safeStorageMock(),
    onChanged: () => {}
  });

  const imported = await service.importTheme(themeZip, { id:'bricks', version:'2.4' });
  console.log('THEME_IMPORTED ' + JSON.stringify({
    id: imported.id,
    version: imported.version,
    archive_layout: imported.archive_layout,
    bytes: imported.bytes,
    sha256: imported.sha256
  }));

  const task = service.create({
    domain: creds.domain,
    username: creds.username,
    password: creds.password,
    clearRemote: true,
    theme: { id:'bricks', version:'2.4' }
  });

  console.log('LIVE_TEST_TASK_CREATED');
  service.start(task.id);

  let lastLogCount = 0;
  const deadline = Date.now() + 20 * 60 * 1000;

  while (Date.now() < deadline) {
    const current = service.status(task.id);
    const logs = Array.isArray(current.logs) ? current.logs : [];
    for (const line of logs.slice(lastLogCount)) {
      console.log('LIVE_LOG ' + String(line).replace(/[\r\n]+/g, ' '));
    }
    lastLogCount = logs.length;

    if (current.status === 'completed') {
      const result = resultView(current);
      fs.writeFileSync('live-test-result.json', JSON.stringify(result, null, 2));
      console.log('LIVE_TEST_PASS ' + JSON.stringify(result));
      return;
    }

    if (current.status === 'failed') {
      const result = {
        ...resultView(current),
        error_code: current.error_code || '',
        error: current.error || '',
        failure_detail: current.failure_detail || null
      };
      fs.writeFileSync('live-test-result.json', JSON.stringify(result, null, 2));
      console.error('LIVE_TEST_FAIL ' + JSON.stringify(result));
      process.exitCode = 1;
      return;
    }

    await sleep(2000);
  }

  throw new Error('Live Bricks Fresh Install timed out.');
})().catch(error => {
  console.error('LIVE_TEST_FATAL ' + String(error?.stack || error));
  process.exitCode = 1;
});
