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
  projectBrain: async () => ({ project: 'demo', frameworks: [{ name:'Node.js', evidence:'package.json' }], stats: { symbols: 3, dependencyEdges: 2 } }),
  findSymbols: async (_project, query) => [{ name: query || 'demo', kind: 'function', path: 'src/index.js', line: 1 }],
  findReferences: async (_project, symbol) => ({ symbol, definitions: [{ name:symbol, path:'src/index.js', line:1 }], references: [] }),
  relatedFiles: async () => [{ path: 'src/helper.js', score: 9, reasons: ['import file này'] }],
  projectContext: async (_project, query) => ({ project:'demo', query, files:[{ path:'src/index.js', symbols:[], imports:[] }] }),
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
  assert.equal(client.getServerVersion()?.version, '0.8.0');

  const tools = await client.listTools();
  const names = tools.tools.map(tool => tool.name);
  const legacy = ['list_projects','list_files','search_project','read_file','read_files','write_file','delete_file','rename_file','run_task','git_status','git_diff','git_stage','git_commit'];
  const brain = ['project_brain','find_symbols','find_references','related_files','project_context'];
  for (const expected of [...legacy, ...brain]) assert.ok(names.includes(expected), `missing tool: ${expected}`);
  assert.equal(names.length, 18, `expected 18 MCP tools, got ${names.length}`);

  const projects = await client.callTool({ name: 'list_projects', arguments: {} });
  const projectPayload = JSON.parse(projects.content[0].text);
  assert.equal(projectPayload[0].name, 'demo');

  const read = await client.callTool({ name: 'read_file', arguments: { project: 'demo', path: 'README.md' } });
  const readPayload = JSON.parse(read.content[0].text);
  assert.equal(readPayload.content, '# Demo');

  const search = await client.callTool({ name: 'search_project', arguments: { project: 'demo', query: 'checkout' } });
  const searchPayload = JSON.parse(search.content[0].text);
  assert.equal(searchPayload[0].snippet, 'match:checkout');

  const overview = await client.callTool({ name: 'project_brain', arguments: { project: 'demo' } });
  const overviewPayload = JSON.parse(overview.content[0].text);
  assert.equal(overviewPayload.stats.symbols, 3);

  const symbols = await client.callTool({ name: 'find_symbols', arguments: { project: 'demo', query: 'checkout' } });
  const symbolPayload = JSON.parse(symbols.content[0].text);
  assert.equal(symbolPayload[0].name, 'checkout');

  const context = await client.callTool({ name: 'project_context', arguments: { project: 'demo', query: 'checkout flow' } });
  const contextPayload = JSON.parse(context.content[0].text);
  assert.equal(contextPayload.files[0].path, 'src/index.js');

  const deniedWrite = await client.callTool({ name: 'write_file', arguments: { project: 'demo', path: 'x.txt', content: 'x' } });
  assert.equal(deniedWrite.isError, true);
  assert.match(deniedWrite.content[0].text, /Write permission is disabled/);

  console.log(`MCP smoke test passed: ${names.length} tools, legacy + Project Brain + permission checks OK`);
} finally {
  try { await client.close(); } catch {}
  try { await server.close(); } catch {}
}
