import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { bin, install } from 'cloudflared';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startMcpHttpServer } from '../mcp-server.mjs';

const port = 47922;
const token = 'ci-remote-smoke-token';
const api = {
  listProjects: async () => [{ id: 'demo', name: 'demo', root: 'C:/demo', permissions: { write: false, manageFiles: false, tasks: false, gitWrite: false } }],
  listFiles: async () => ['README.md'],
  search: async () => [],
  readFile: async (_project, path) => ({ path, content: '# Remote MCP works' }),
  readFiles: async (_project, paths) => paths.map(path => ({ path, content: '# Remote MCP works' })),
  writeFile: async () => { throw new Error('Write permission is disabled'); },
  deleteFile: async () => { throw new Error('Manage files permission is disabled'); },
  renameFile: async () => { throw new Error('Manage files permission is disabled'); },
  runTask: async () => { throw new Error('Task permission is disabled'); },
  gitStatus: async () => ({ ok: true, code: 0, stdout: '## main', stderr: '' }),
  gitDiff: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }),
  gitStage: async () => { throw new Error('Git write permission is disabled'); },
  gitCommit: async () => { throw new Error('Git write permission is disabled'); }
};

if (!fs.existsSync(bin)) {
  console.log('Installing cloudflared for remote smoke test...');
  await install(bin);
}

const server = await startMcpHttpServer({ port, token, api });
let proc;
let client;
let timeout;

try {
  const baseUrl = await new Promise((resolve, reject) => {
    let settled = false;
    timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Timed out waiting for Cloudflare Quick Tunnel URL'));
      }
    }, 60000);

    proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const onData = chunk => {
      const text = String(chunk || '');
      process.stdout.write(text);
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', error => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    proc.on('exit', code => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited before URL was ready (${code})`));
      }
    });
  });

  const publicUrl = new URL(`${baseUrl}${server.route}`);
  console.log(`Testing remote MCP endpoint: ${publicUrl.origin}/<secret>/mcp`);

  // Quick Tunnels can need a moment after printing the URL before edge routing is ready.
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      client = new Client({ name: 'personal-chatcode-remote-ci', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(publicUrl);
      await client.connect(transport);
      const projects = await client.callTool({ name: 'list_projects', arguments: {} });
      const payload = JSON.parse(projects.content[0].text);
      assert.equal(payload[0].name, 'demo');

      const read = await client.callTool({ name: 'read_file', arguments: { project: 'demo', path: 'README.md' } });
      const readPayload = JSON.parse(read.content[0].text);
      assert.equal(readPayload.content, '# Remote MCP works');
      console.log('Remote MCP tunnel smoke test passed: external connect + tool access OK');
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      try { await client?.close(); } catch {}
      client = undefined;
      if (attempt < 8) await new Promise(resolve => setTimeout(resolve, 2500));
    }
  }
  if (lastError) throw lastError;
} finally {
  clearTimeout(timeout);
  try { await client?.close(); } catch {}
  try { proc?.kill(); } catch {}
  try { await server.close(); } catch {}
}
