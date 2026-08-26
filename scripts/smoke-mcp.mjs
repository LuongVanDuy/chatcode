import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startMcpHttpServer } from '../mcp-server.mjs';

const port = 47921;
const token = 'ci-smoke-token';
const api = {
  listProjects: async () => [{ id: 'demo', name: 'demo', root: 'C:/demo', permissions: { write: false, manageFiles: false, tasks: false, gitWrite: false } }],
  listFiles: async () => ['README.md', 'src/index.js'],
  search: async (_project, query) => [{ path: 'src/index.js', score: 2, snippet: `match:${query}` }],
  readFile: async (_project, path) => ({ path, content: path === 'README.md' ? '# Demo' : 'console.log("demo")' }),
  readFiles: async (_project, paths) => paths.map(path => ({ path, content: `content:${path}` })),
  writeFile: async () => { throw new Error('Write permission is disabled for project "demo"'); },
  deleteFile: async () => { throw new Error('Create/delete/rename permission is disabled for project "demo"'); },
  renameFile: async () => { throw new Error('Create/delete/rename permission is disabled for project "demo"'); },
  runTask: async () => { throw new Error('Task permission is disabled for project "demo"'); },
  gitStatus: async () => ({ ok: true, code: 0, stdout: '## main', stderr: '' }),
  gitDiff: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }),
  gitStage: async () => { throw new Error('Git write permission is disabled for project "demo"'); },
  gitCommit: async () => { throw new Error('Git write permission is disabled for project "demo"'); }
};

const server = await startMcpHttpServer({ port, token, api });
const client = new Client({ name: 'personal-chatcode-ci', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(server.localUrl));

try {
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: 'personal-chatcode' });

  const blocked = await fetch(`http://127.0.0.1:${port}/wrong-token/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(blocked.status, 404);

  await client.connect(transport);
  assert.equal(client.getServerVersion()?.name, 'personal-chatcode');

  const tools = await client.listTools();
  const names = tools.tools.map(tool => tool.name);
  for (const expected of ['list_projects', 'list_files', 'search_project', 'read_file', 'read_files', 'write_file', 'run_task', 'git_status', 'git_diff']) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }

  const projects = await client.callTool({ name: 'list_projects', arguments: {} });
  const projectPayload = JSON.parse(projects.content[0].text);
  assert.equal(projectPayload[0].name, 'demo');

  const read = await client.callTool({ name: 'read_file', arguments: { project: 'demo', path: 'README.md' } });
  const readPayload = JSON.parse(read.content[0].text);
  assert.equal(readPayload.content, '# Demo');

  const search = await client.callTool({ name: 'search_project', arguments: { project: 'demo', query: 'checkout' } });
  const searchPayload = JSON.parse(search.content[0].text);
  assert.equal(searchPayload[0].snippet, 'match:checkout');

  const deniedWrite = await client.callTool({ name: 'write_file', arguments: { project: 'demo', path: 'x.txt', content: 'x' } });
  assert.equal(deniedWrite.isError, true);
  assert.match(deniedWrite.content[0].text, /Write permission is disabled/);

  console.log(`MCP smoke test passed: ${names.length} tools, connect/list/read/search/permission checks OK`);
} finally {
  try { await client.close(); } catch {}
  try { await server.close(); } catch {}
}
