'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { FtpClient, probeWorkers, splitRanges, uploadPackage } = require('../core/fresh-install-transfer');
const { buildFreshInstallBootstrap } = require('../core/fresh-install-bootstrap');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function ftpFixture(root, { limit = 6, corruptPart = -1, dropCompletion = false, pasvOnly = false, tlsOptions = null } = {}) {
  let active = 0, peak = 0, dataActive = 0, dataPeak = 0;
  const uploads = new Map(), sockets = new Set(), passiveServers = new Set();
  const server = net.createServer(raw => {
    let control = raw;
    control.on('error', () => {});
    if (active >= limit) { control.end('421 Too many connections\r\n'); return; }
    active++; peak = Math.max(peak, active); sockets.add(control);
    let buffer = '', passive = null, data = null, cwd = root;
    control.on('close', () => { active--; sockets.delete(control); passive?.close(); });
    control.write('220-Test FTP\r\nSome multiline information\r\n220 Ready\r\n');
    async function command(line) {
      const [cmd, ...args] = line.split(' '); const value = args.join(' ');
      if (cmd === 'AUTH' && tlsOptions) {
        control.write('234 TLS ready\r\n');
        control.removeListener('data', receive);
        control = new tls.TLSSocket(control, { isServer: true, secureContext: tls.createSecureContext(tlsOptions) });
        sockets.add(control); control.on('error', () => {}); control.on('data', receive);
        return;
      }
      if (cmd === 'PBSZ' || cmd === 'PROT') return control.write('200 Protected\r\n');
      if (cmd === 'USER') return control.write('331 Password required\r\n');
      if (cmd === 'PASS') return control.write('230 Logged in\r\n');
      if (cmd === 'TYPE') return control.write('200 Binary\r\n');
      if (cmd === 'CWD') {
        const target = path.join(root, value);
        if (!fs.existsSync(target)) return control.write('550 No such directory\r\n');
        cwd = target; return control.write('250 Changed\r\n');
      }
      if (cmd === 'EPSV' || cmd === 'PASV') {
        if (cmd === 'EPSV' && pasvOnly) return control.write('502 Unsupported\r\n');
        data = null;
        passive = net.createServer(socket => { data = socket; sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
        passiveServers.add(passive);
        const port = await listen(passive);
        return control.write(cmd === 'EPSV' ? `229 Entering Extended Passive Mode (|||${port}|)\r\n` : `227 Passive (10,99,99,99,${port >> 8},${port & 255})\r\n`);
      }
      if (cmd === 'STOR') {
        const file = path.resolve(cwd, value);
        if (!file.startsWith(root + path.sep)) return control.write('550 Unsafe\r\n');
        while (!data) await delay(1);
        const socket = tlsOptions ? new tls.TLSSocket(data, { isServer: true, secureContext: tls.createSecureContext(tlsOptions) }) : data;
        socket.on('error', () => {});
        const count = (uploads.get(value) || 0) + 1; uploads.set(value, count);
        dataActive++; dataPeak = Math.max(dataPeak, dataActive);
        control.write('150 Opening data\r\n');
        let first = true;
        const corrupt = new Transform({ transform(chunk, encoding, callback) {
          if (first && Number(path.basename(value, '.part')) === corruptPart && count === 1) { chunk = Buffer.from(chunk); chunk[0] ^= 0xff; }
          first = false; callback(null, chunk);
        } });
        try {
          await pipeline(socket, corrupt, fs.createWriteStream(file));
          if (dropCompletion) control.end(); else control.write('226 Transfer complete\r\n');
        } catch { control.write('426 Transfer failed\r\n'); }
        finally { dataActive--; passive?.close(); }
        return;
      }
      if (cmd === 'QUIT') return control.end('221 Bye\r\n');
      control.write('502 Unsupported\r\n');
    }
    function receive(chunk) {
      buffer += chunk.toString(); let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        command(line).catch(error => { console.error(error); control.destroy(); });
      }
    }
    control.on('data', receive);
  });
  const port = await listen(server);
  return {
    connection: { host: '127.0.0.1', port, protocol: tlsOptions ? 'ftps' : 'ftp', ...(tlsOptions ? { ca: tlsOptions.cert } : {}), username: 'test', password: 'test', remotePath: '/public_html' },
    uploads,
    stats: () => ({ active, peak, dataPeak }),
    close: async () => { for (const socket of sockets) socket.destroy(); for (const passive of passiveServers) passive.close(); await new Promise(resolve => server.close(resolve)); }
  };
}

async function phpFixture(root) {
  const portServer = net.createServer(); const port = await listen(portServer);
  await new Promise(resolve => portServer.close(resolve));
  const php = buildFreshInstallBootstrap({
    token: 'a'.repeat(64), installId: '0123456789abcdef0123456789abcdef',
    bridgeName: 'bridge.php', themePackageName: '.chatcode-theme-test.zip'
  });
  fs.writeFileSync(path.join(root, 'bridge.php'), php);
  const process = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', root], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = ''; process.stderr.on('data', chunk => { log += chunk; });
  let spawnError; process.once('error', error => { spawnError = error; });
  const url = `http://127.0.0.1:${port}/bridge.php`;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    try { const response = await fetch(url); if (response.status < 500) break; } catch {}
    if (attempt === 59) throw new Error(`PHP fixture failed: ${log}`);
    await delay(50);
  }
  return {
    call: async payload => {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-chatcode-token': 'a'.repeat(64) }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!body.ok) { const error = new Error(body.message); error.code = body.code; error.detail = body; throw error; }
      return body;
    },
    close: () => new Promise(resolve => { process.once('exit', resolve); process.kill(); })
  };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-transfer-'));
  let server, php;
  try {
    for (const size of [1, 2, 31, 1024, 29000508]) for (const count of [1, 2, 6, 16]) {
      const parts = splitRanges(size, count);
      assert.equal(parts.reduce((sum, part) => sum + part.bytes, 0), size);
      assert.ok(Math.max(...parts.map(p => p.bytes)) - Math.min(...parts.map(p => p.bytes)) <= 1);
      assert.equal(parts.at(-1).offset + parts.at(-1).bytes, size);
    }
    assert.throws(() => splitRanges(0, 4));
    const www = path.join(root, 'public_html'); fs.mkdirSync(www);
    server = await ftpFixture(root, { limit: 6 });
    const probe = await probeWorkers(server.connection, { cap: 16 });
    assert.equal(probe.workers, 6);
    assert.equal(server.stats().active, 6, 'probe sessions remain open for upload');
    assert.equal(server.stats().peak, 6);
    assert.equal(probe.exactLimitKnown, false);
    probe.clients.forEach(client => client.close());
    await server.close(); server = null;
    console.log('PASS balanced byte ranges and held-session capacity probe');

    const bytes = crypto.randomBytes(8 * 1024 * 1024 + 17);
    const file = path.join(root, 'source.zip'); fs.writeFileSync(file, bytes);
    php = await phpFixture(www);
    server = await ftpFixture(root, { limit: 4, corruptPart: 2, pasvOnly: true });
    const progress = [];
    const request = { connection: server.connection, localPath: file, remoteName: '.chatcode-theme-test.zip', expectedSha256: digest(bytes), bootstrap: php.call, onProgress: event => progress.push(event) };
    const result = await uploadPackage(request);
    assert.equal(result.transfer.workers, 4);
    assert.equal(result.sha256, digest(bytes));
    assert.deepEqual(fs.readFileSync(path.join(www, request.remoteName)), bytes);
    assert.ok(server.stats().dataPeak > 1, 'actual overlapping data transfers');
    for (const [name, count] of server.uploads) assert.equal(count, name.endsWith('/2.part') ? 2 : 1, name);
    assert.ok(progress.some(event => event.phase === 'retry' && event.parts.join(',') === '3'));
    await assert.rejects(php.call({ action: 'install' }), error => error.code === 'PAYLOAD_MISSING_FIELD');
    const callsBeforeResume = [...server.uploads.values()].reduce((a, b) => a + b, 0);
    const resumed = await uploadPackage(request);
    assert.equal(resumed.transfer.resumed, true);
    assert.equal([...server.uploads.values()].reduce((a, b) => a + b, 0), callsBeforeResume);
    console.log('PASS parallel PASV upload, same-size corruption retry of one part, exact ZIP assembly, completed-package resume');
    await server.close(); server = await ftpFixture(root, { limit: 2 });
    const changedCapacity = await uploadPackage({ ...request, connection: server.connection });
    assert.equal(changedCapacity.transfer.resumed, true);
    assert.equal(server.uploads.size, 0, 'completed package is retained when measured capacity changes');
    console.log('PASS completed-package resume after hosting capacity changes');
    await server.close(); server = null;

    server = await ftpFixture(root, { limit: 4, dropCompletion: true });
    const uncertain = await uploadPackage({ ...request, connection: server.connection, remoteName: '.chatcode-plugin-test.zip' });
    assert.equal(uncertain.sha256, digest(bytes));
    assert.ok([...server.uploads.values()].every(count => count === 1), 'lost 226 does not trigger a complete reupload');
    console.log('PASS control close after upload is confirmed by PHP without retransmission');
    await assert.rejects(php.call({ action: 'prepare-parts', name: '../escape.zip', expectedBytes: 1, parts: [] }), error => error.code === 'UPLOAD_NAME_INVALID');
    await assert.rejects(php.call({ action: 'prepare-parts', name: '.chatcode-invalid.zip', expectedBytes: 10, parts: [{ index: 0, offset: 3, bytes: 10 }] }), error => error.code === 'UPLOAD_PLAN_INVALID');
    console.log('PASS package name and byte-range boundary checks');
    await server.close(); server = null;
    const keyFile = path.join(root, 'test.key'), certFile = path.join(root, 'test.crt');
    execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    server = await ftpFixture(root, { limit: 4, tlsOptions: { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) } });
    await assert.rejects(FtpClient.open({ ...server.connection, ca: undefined }), /certificate|self.signed/i);
    const secure = await uploadPackage({ ...request, connection: server.connection, remoteName: '.chatcode-secure-test.zip' });
    assert.equal(secure.sha256, digest(bytes));
    assert.deepEqual(fs.readFileSync(path.join(www, '.chatcode-secure-test.zip')), bytes);
    console.log('PASS FTPS control/data TLS, trusted certificate and rejection of untrusted certificate');
  } finally {
    if (server) await server.close();
    if (php) await php.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
