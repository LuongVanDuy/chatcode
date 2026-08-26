import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startMcpHttpServer } from '../mcp-server.mjs';

const port = 47921;
const token = 'ci-smoke-token';
const api = {
  listProjects: async () => [{ id:'demo', name:'demo', root:'C:/demo', permissions:{ write:false, manageFiles:false, tasks:false, gitWrite:false }, workspace_mode:'trusted' }],
  listFiles: async () => ['README.md','src/index.js'],
  search: async (_project, query) => [{ path:'src/index.js', score:2, snippet:`match:${query}` }],
  readFile: async (_project, path) => ({ path, content:path === 'README.md' ? '# Demo' : 'console.log("demo")' }),
  readFiles: async (_project, paths) => paths.map(path => ({ path, content:`content:${path}` })),
  projectBrain: async () => ({ project:'demo', frameworks:[{ name:'Node.js', evidence:'package.json' }], framework_names:['Node.js'], primary_language:'JavaScript', entrypoints:['src/index.js'], stats:{ symbols:3, dependencyEdges:2 } }),
  findSymbols: async (_project, query) => [{ name:query || 'demo', kind:'function', path:'src/index.js', line:1 }],
  findReferences: async (_project, symbol) => ({ symbol, definitions:[{ name:symbol, path:'src/index.js', line:1 }], references:[] }),
  relatedFiles: async () => [{ path:'src/helper.js', score:9, reasons:['import file này'] }],
  projectContext: async (_project, query) => ({ project:'demo', query, files:[{ path:'src/index.js', symbols:[], imports:[] }], relations:[] }),
  inspectProject: async (_project, query) => ({ ok:true, query, framework_names:['Node.js'], primary_language:'JavaScript', relevant_files:[{ path:'src/index.js', content:'console.log("demo")' }], git:{ is_repository:true, status:'## main' }, telemetry:{ total_ms:2, filesystem_ms:1, brain_refresh_ms:1, git_ms:0 } }),
  applyAndVerify: async () => ({ ok:true, status:'completed', job_id:'job-1', changes:[], tasks:[], git_diff:'', telemetry:{ total_ms:1, filesystem_ms:0, brain_refresh_ms:0, git_ms:0 } }),
  operationStatus: async jobId => ({ ok:true, status:'completed', job_id:jobId }),
  writeFile: async () => { throw new Error('Write permission is disabled for project "demo"'); },
  deleteFile: async () => { throw new Error('Create/delete/rename permission is disabled for project "demo"'); },
  renameFile: async () => { throw new Error('Create/delete/rename permission is disabled for project "demo"'); },
  runTask: async () => { throw new Error('Task permission is disabled for project "demo"'); },
  exec: async (_project, command, opts) => ({ ok:true, job_id:'term-1', command, cwd:opts.cwd || '.', status:opts.background ? 'running' : 'completed', stdout:'TERM_OK', stderr:'', stdout_offset:7, stderr_offset:0, terminal:{ hidden:true } }),
  jobStatus: async jobId => ({ ok:true, job_id:jobId, status:'completed', stdout:'TERM_OK', stderr:'', stdout_offset:7, stderr_offset:0 }),
  jobStop: async jobId => ({ ok:true, job_id:jobId, status:'stopping', stop_requested:true }),
  gitStatus: async () => ({ ok:true, code:0, stdout:'## main', stderr:'' }),
  gitDiff: async () => ({ ok:true, code:0, stdout:'', stderr:'' }),
  gitStage: async () => { throw new Error('Git write permission is disabled for project "demo"'); },
  gitCommit: async () => { throw new Error('Git write permission is disabled for project "demo"'); },
  recordActivity: async () => {}
};

const server = await startMcpHttpServer({ port, token, api });
const client = new Client({ name:'personal-chatcode-ci', version:'1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(server.localUrl));

try {
  const health = await fetch(`http://127.0.0.1:${port}/health`); assert.equal(health.status, 200); assert.deepEqual(await health.json(), { ok:true, service:'personal-chatcode' });
  const blocked = await fetch(`http://127.0.0.1:${port}/wrong-token/mcp`, { method:'POST', headers:{ 'content-type':'application/json' }, body:'{}' }); assert.equal(blocked.status, 404);
  await client.connect(transport); assert.equal(client.getServerVersion()?.name, 'personal-chatcode'); assert.equal(client.getServerVersion()?.version, '0.9.0');

  const tools = await client.listTools(); const names = tools.tools.map(tool => tool.name);
  const legacy = ['list_projects','list_files','search_project','read_file','read_files','write_file','delete_file','rename_file','run_task','git_status','git_diff','git_stage','git_commit'];
  const brain = ['project_brain','find_symbols','find_references','related_files','project_context'];
  const fast = ['inspect_project','apply_and_verify','operation_status'];
  const terminal = ['exec','job_status','job_stop'];
  for (const expected of [...legacy,...brain,...fast,...terminal]) assert.ok(names.includes(expected), `missing tool: ${expected}`);
  assert.equal(names.length, 24, `expected 24 MCP tools, got ${names.length}`);

  const projects = await client.callTool({ name:'list_projects', arguments:{} }); assert.equal(JSON.parse(projects.content[0].text)[0].name, 'demo');
  const read = await client.callTool({ name:'read_file', arguments:{ project:'demo', path:'README.md' } }); assert.equal(JSON.parse(read.content[0].text).content, '# Demo');
  const search = await client.callTool({ name:'search_project', arguments:{ project:'demo', query:'checkout' } }); assert.equal(JSON.parse(search.content[0].text)[0].snippet, 'match:checkout');
  const overview = await client.callTool({ name:'project_brain', arguments:{ project:'demo' } }); assert.equal(JSON.parse(overview.content[0].text).stats.symbols, 3);
  const inspect = await client.callTool({ name:'inspect_project', arguments:{ project:'demo', query:'checkout address' } }); assert.equal(JSON.parse(inspect.content[0].text).primary_language, 'JavaScript');
  const apply = await client.callTool({ name:'apply_and_verify', arguments:{ project:'demo', changes:[], tasks:['node --version'] } }); assert.equal(JSON.parse(apply.content[0].text).status, 'completed');

  const terminalExec = await client.callTool({ name:'exec', arguments:{ project:'demo', command:'node --version', background:true } });
  const execValue = JSON.parse(terminalExec.content[0].text); assert.equal(execValue.status, 'running'); assert.equal(execValue.job_id, 'term-1');
  const terminalStatus = await client.callTool({ name:'job_status', arguments:{ job_id:'term-1', stdout_offset:0, stderr_offset:0 } }); assert.equal(JSON.parse(terminalStatus.content[0].text).stdout, 'TERM_OK');
  const terminalStop = await client.callTool({ name:'job_stop', arguments:{ job_id:'term-1' } }); assert.equal(JSON.parse(terminalStop.content[0].text).stop_requested, true);

  const deniedWrite = await client.callTool({ name:'write_file', arguments:{ project:'demo', path:'x.txt', content:'x' } });
  assert.equal(deniedWrite.isError, true); const denied = JSON.parse(deniedWrite.content[0].text); assert.equal(denied.ok, false); assert.equal(denied.error.code, 'PERMISSION_DENIED');

  console.log(`MCP smoke test passed: ${names.length} tools, legacy + Brain + fast path + Trusted terminal + structured errors OK`);
} finally {
  try { await client.close(); } catch {}
  try { await server.close(); } catch {}
}
