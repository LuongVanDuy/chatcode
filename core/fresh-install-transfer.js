'use strict';

// Fresh Install's bulk transfer path. No PowerShell process per part, no npm
// dependency, no temporary split files: each worker streams a range of the ZIP.
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

function ftpError(reply) {
  const error = new Error(`FTP ${reply.code}: ${reply.text}`);
  error.code = reply.code === 421 ? 'FTP_CAPACITY' : 'FTP_RESPONSE_FAILED';
  error.ftpCode = reply.code;
  return error;
}
function expect(reply, codes) {
  if (!codes.includes(reply.code)) throw ftpError(reply);
  return reply;
}
function cleanArgument(value) {
  const text = String(value ?? '');
  if (/[\r\n\0]/.test(text)) throw new Error('Invalid FTP command argument.');
  return text;
}

class FtpClient {
  constructor(options) {
    this.options = options;
    this.socket = null;
    this.queue = [];
    this.pending = null;
    this.buffer = '';
    this.multiline = null;
    this.failure = null;
    this.onData = chunk => this.parse(chunk);
    this.onError = error => this.fail(error);
    this.onClose = () => this.fail(new Error('FTP control connection closed.'));
  }
  bind(socket) {
    this.socket = socket;
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }
  unbind() {
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('error', this.onError);
    this.socket.removeListener('close', this.onClose);
  }
  fail(error) {
    if (!this.failure) this.failure = error;
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
  }
  parse(chunk) {
    this.buffer += chunk.toString('utf8');
    if (this.buffer.length > 65536) return this.close(new Error('FTP reply too large.'));
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      if (this.multiline) {
        if (!line.startsWith(`${this.multiline} `)) continue;
        this.multiline = null;
      }
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) continue;
      if (match[2] === '-') { this.multiline = match[1]; continue; }
      const reply = { code: Number(match[1]), text: match[3] };
      if (this.pending) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(reply);
      } else {
        this.queue.push(reply);
        if (this.queue.length > 32) this.close(new Error('Unexpected FTP reply sequence.'));
      }
    }
  }
  reply(timeoutMs = this.options.timeoutMs || 12000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending) return Promise.reject(new Error('Concurrent commands on one FTP connection.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('FTP response timeout.')), timeoutMs);
      this.pending = { resolve, reject, timer };
    });
  }
  command(value) {
    if (this.failure) return Promise.reject(this.failure);
    this.socket.write(`${cleanArgument(value)}\r\n`);
    return this.reply();
  }
  static async open(options) {
    const client = new FtpClient(options);
    try {
      const socket = net.createConnection({ host: options.host, port: options.port || 21 });
      socket.setNoDelay(true);
      client.bind(socket);
      let greeting = await client.reply();
      if (greeting.code === 120) greeting = await client.reply();
      expect(greeting, [220]);
      if (options.protocol !== 'ftp') {
        expect(await client.command('AUTH TLS'), [234]);
        client.unbind();
        const secure = tls.connect({
          socket,
          servername: net.isIP(options.host) ? undefined : options.host,
          rejectUnauthorized: true,
          ...(options.ca ? { ca: options.ca } : {})
        });
        client.bind(secure);
        await waitConnected(secure, 'secureConnect', options.timeoutMs || 12000);
      }
      const user = await client.command(`USER ${cleanArgument(options.username)}`);
      if (user.code === 331) expect(await client.command(`PASS ${cleanArgument(options.password)}`), [230, 202]);
      else expect(user, [230]);
      if (options.protocol !== 'ftp') {
        expect(await client.command('PBSZ 0'), [200]);
        expect(await client.command('PROT P'), [200]);
      }
      expect(await client.command('TYPE I'), [200]);
      expect(await client.command(`CWD ${cleanArgument(options.remotePath)}`), [250]);
      return client;
    } catch (error) {
      client.close(error);
      throw error;
    }
  }
  async upload(localPath, remoteName, part, onBytes) {
    let dataSocket = null;
    let sent = 0;
    const hash = crypto.createHash('sha256');
    try {
      let response = await this.command('EPSV');
      let port;
      if (response.code === 229) {
        const match = /\((.)(?:\1){2}(\d+)\1\)/.exec(response.text);
        if (!match) throw new Error('Invalid EPSV response.');
        port = Number(match[2]);
      } else {
        // Legacy shared hosting often supports PASV only. Use the control peer
        // address, not the arbitrary IP advertised inside a PASV response.
        expect(response, [500, 501, 502, 504, 522]);
        response = expect(await this.command('PASV'), [227]);
        const match = /\((\d+,\d+,\d+,\d+),(\d+),(\d+)\)/.exec(response.text);
        if (!match) throw new Error('Invalid PASV response.');
        port = Number(match[2]) * 256 + Number(match[3]);
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid FTP data port.');
      dataSocket = net.createConnection({ host: this.socket.remoteAddress, port });
      dataSocket.on('error', () => {});
      await waitConnected(dataSocket, 'connect', this.options.timeoutMs || 12000);
      expect(await this.command(`STOR ${cleanArgument(remoteName)}`), [125, 150]);
      if (this.options.protocol !== 'ftp') {
        dataSocket = tls.connect({
          socket: dataSocket,
          servername: net.isIP(this.options.host) ? undefined : this.options.host,
          session: this.socket.getSession(),
          rejectUnauthorized: true,
          ...(this.options.ca ? { ca: this.options.ca } : {})
        });
        dataSocket.on('error', () => {});
        await waitConnected(dataSocket, 'secureConnect', this.options.timeoutMs || 12000);
      }
      dataSocket.setTimeout(45000, () => dataSocket.destroy(new Error('FTP data idle timeout.')));
      const counter = new Transform({ transform(chunk, encoding, callback) {
        hash.update(chunk);
        sent += chunk.length;
        onBytes?.(sent);
        callback(null, chunk);
      } });
      await pipeline(
        fs.createReadStream(localPath, { start: part.offset, end: part.offset + part.bytes - 1, highWaterMark: 256 * 1024 }),
        counter,
        dataSocket
      );
      expect(await this.reply(8000), [226, 250]);
      return { status: 'confirmed', bytes: sent, sha256: hash.digest('hex') };
    } catch (error) {
      this.close(error);
      // Some FTPS servers close the control socket after receiving all bytes.
      // Do not upload again blindly: the PHP assembler checks this part once.
      if (sent === part.bytes) return { status: 'sent-unconfirmed', bytes: sent, sha256: hash.digest('hex') };
      throw error;
    } finally {
      dataSocket?.destroy();
    }
  }
  close(error = new Error('FTP connection closed.')) {
    this.fail(error);
    this.socket?.destroy();
  }
}

function waitConnected(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      socket.removeListener(event, ready);
      socket.removeListener('error', failed);
      socket.removeListener('close', closed);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish();
    const failed = error => finish(error);
    const closed = () => finish(new Error('FTP socket closed during connection.'));
    const timer = setTimeout(() => { const error = new Error('FTP connect timeout.'); socket.destroy(error); finish(error); }, timeoutMs);
    socket.once(event, ready);
    socket.once('error', failed);
    socket.once('close', closed);
  });
}

async function probeWorkers(connection, { cap = 16, openClient = FtpClient.open, onProgress } = {}) {
  cap = Math.max(1, Math.min(16, Math.floor(cap)));
  const clients = [];
  const stages = [];
  const started = Date.now();
  try {
    for (const level of [...new Set([1, 2, 4, 8, 16].filter(n => n <= cap).concat(cap))]) {
      const outcomes = await Promise.allSettled(Array.from({ length: level - clients.length }, () =>
        openClient({ ...connection, timeoutMs: 7000 })
      ));
      for (const outcome of outcomes) if (outcome.status === 'fulfilled') clients.push(outcome.value);
      const failed = outcomes.filter(item => item.status === 'rejected');
      stages.push({ requested: level, connected: clients.length, failed: failed.length });
      onProgress?.({ phase: 'probe', requested: level, workers: clients.length });
      if (failed.length) {
        if (!clients.length) throw failed[0].reason;
        break;
      }
    }
    return { clients, workers: clients.length, cap, stages, elapsedMs: Date.now() - started, exactLimitKnown: false };
  } catch (error) {
    for (const client of clients) client.close();
    throw error;
  }
}

function splitRanges(bytes, workers) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('ZIP package is empty or too large.');
  workers = Math.max(1, Math.min(16, Math.floor(workers), bytes));
  const base = Math.floor(bytes / workers), extra = bytes % workers;
  let offset = 0;
  return Array.from({ length: workers }, (_, index) => {
    const part = { index, offset, bytes: base + (index < extra ? 1 : 0) };
    offset += part.bytes;
    return part;
  });
}
async function hashRange(file, part) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { start: part.offset, end: part.offset + part.bytes - 1 })) hash.update(chunk);
  return hash.digest('hex');
}
async function eachLimit(items, limit, visit) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const item = items[next++]; await visit(item); }
  }));
}

async function uploadPackage({ connection, localPath, remoteName, expectedSha256 = '', bootstrap, onProgress, openClient = FtpClient.open }) {
  const bytes = (await fs.promises.stat(localPath)).size;
  if (!/^\.chatcode-[A-Za-z0-9._-]+\.zip$/.test(remoteName)) throw new Error('Invalid install package name.');
  splitRanges(bytes, 1);
  const cap = Math.max(1, Math.min(16, Math.floor(bytes / (1024 * 1024))));
  const probe = await probeWorkers(connection, { cap, openClient, onProgress });
  const parts = splitRanges(bytes, probe.workers);
  const transferred = parts.map(() => 0);
  const hashes = parts.map(() => '');
  const started = Date.now();
  let lastProgress = 0;
  const report = (index, completed, force = false) => {
    if (index >= 0) transferred[index] = completed;
    const now = Date.now();
    if (!force && now - lastProgress < 500) return;
    lastProgress = now;
    const done = transferred.reduce((sum, value) => sum + value, 0);
    onProgress?.({ phase: 'upload', workers: parts.length, bytes: done, total: bytes, bytesPerSecond: Math.round(done * 1000 / Math.max(1, now - started)) });
  };
  try {
    const plan = { name: remoteName, expectedBytes: bytes, expectedSha256, parts };
    const prepared = await bootstrap({ action: 'prepare-parts', ...plan });
    if (prepared.complete) return { ...prepared, transfer: { workers: parts.length, bytes, resumed: true, elapsedMs: Date.now() - started, probeMs: probe.elapsedMs } };
    const present = new Set(prepared.present || []);
    const failed = [];
    await Promise.all(parts.map(async part => {
      const client = probe.clients[part.index];
      try {
        if (present.has(part.index)) {
          hashes[part.index] = await hashRange(localPath, part);
          report(part.index, part.bytes);
          return;
        }
        const result = await client.upload(localPath, `${prepared.directory}/${part.index}.part`, part, done => report(part.index, done));
        hashes[part.index] = result.sha256;
      } catch (error) {
        failed.push({ part, error });
        report(part.index, 0);
      } finally { client.close(); }
    }));
    // Reconcile only failed parts with at most two connections. No FTP SIZE,
    // repeated LIST, nested whole-package retry or fixed sleep loop.
    let pending = failed.map(item => item.part);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (pending.length) {
        onProgress?.({ phase: 'retry', workers: Math.min(2, pending.length), parts: pending.map(p => p.index + 1) });
        const stillFailed = [];
        await eachLimit(pending, 2, async part => {
          let client;
          try {
            client = await openClient({ ...connection, timeoutMs: 12000 });
            const result = await client.upload(localPath, `${prepared.directory}/${part.index}.part`, part, done => report(part.index, done));
            hashes[part.index] = result.sha256;
          } catch (error) { stillFailed.push({ part, error }); }
          finally { client?.close(); }
        });
        if (stillFailed.length) {
          if (attempt === 2) throw stillFailed[0].error;
          pending = stillFailed.map(item => item.part);
          continue;
        }
      }
      report(-1, 0, true);
      onProgress?.({ phase: 'assemble', workers: parts.length, bytes, total: bytes });
      try {
        const result = await bootstrap({ action: 'assemble-parts', name: remoteName, partSha256: hashes });
        return { ...result, transfer: { workers: parts.length, bytes, elapsedMs: Date.now() - started, probeMs: probe.elapsedMs, exactLimitKnown: false } };
      } catch (error) {
        const bad = error.detail?.badParts;
        if (attempt === 2 || !Array.isArray(bad) || !bad.length) throw error;
        pending = parts.filter(part => bad.includes(part.index));
        if (!pending.length) throw error;
      }
    }
    throw new Error('Package transfer did not finish.');
  } finally {
    for (const client of probe.clients) client.close();
  }
}

module.exports = { FtpClient, probeWorkers, splitRanges, uploadPackage };
