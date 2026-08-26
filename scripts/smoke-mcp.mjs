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
  prepareTask: async (_project, request) => ({ ok:true, status:'ready', task_id:'agent-1', work_session_id:'agent-1', request, context:{ primary_language:'JavaScript', relevant_files:[{ path:'src/index.js', content:'console.log("demo")' }], git:{ is_repository:true, status:'## main' } }, verification_hints:[{ command:'npm run test' }], agent_contract:{ preferred_calls:2, next_tool:'complete_task' }, telemetry:{ total_ms:2, inspect_ms:1 } }),
  completeTask: async (taskId, patch, commands) => ({ ok:true, status:'completed', task_id:taskId, work_session_id:taskId, verification:commands.map(command => ({ command, ok:true })), verification_passed:true, changed_files:['src/index.js'], git:{ diff:patch.includes('demo2') ? 'diff' : '' }, agent_contract:{ preferred_calls:2, completed_in_call:2 }, telemetry:{ total_ms:3, patch_ms:1, verify_ms:1, finalize_ms:1 } }),
  inspectProject: async (_project, query) => ({ ok:true, query, framework_names:['Node.js'], primary_language:'JavaScript', relevant_files:[{ path:'src/index.js', content:'console.log("demo")' }], git:{ is_repository:true, status:'## main' }, telemetry:{ total_ms:2, filesystem_ms:1, brain_refresh_ms:1, git_ms:0 } }),
  applyAndVerify: async () => ({ ok:true, status:'completed', job_id:'job-1', changes:[], tasks:[], git_diff:'', telemetry:{ total_ms:1, filesystem_ms:0, brain_refresh_ms:0, git_ms:0 } }),
  operationStatus: async jobId => ({ ok:true, status:'completed', job_id:jobId }),
  startWork: async (_project, goal) => ({ work_session_id:'work-1', project_id:'demo', workspace_mode:'trusted', goal, status:'active', changed_files:[], baseline:{ git:{ is_repository:true, status:'## main', diff:'' } } }),
  applyPatch: async (_project, patch, id) => ({ ok:true, work_session_id:id, files:[{ path:'src/index.js', operation:'modify', hunks:1 }], changed_files:['src/index.js'], git:{ is_repository:true, diff:patch.includes('demo') ? 'diff' : '' } }),
  workStatus: async id => ({ work_session_id:id, project_id:'demo', workspace_mode:'trusted', status:'active', changed_files:['src/index.js'], commands:[], current:{ git:{ status:' M src/index.js', diff:'diff' } } }),
  finishWork: async (id, commands) => ({ work_session_id:id, status:'completed', verification:commands.map(command => ({ command, ok:true })), verification_passed:true, final:{ git:{ diff:'diff' } } }),
  rollbackWork: async id => ({ work_session_id:id, status:'rolled_back', ok:true, restored:[{ path:'src/index.js' }], final:{ git:{ diff:'' } } }),
  writeFile: async () => { throw new Error('Write permission is disabled for project "demo"'); },
  deleteFile: async () => { throw new Error('Create/delete/rename permission is disabled for project "demo"'); },
  renameFile: async () => { throw new Error('Create/delete/rename permission is disabled for project "demo"'); },
  runTask: async () => { throw new Error('Task permission is disabled for project "demo"'); },
  exec: async (_project, command, opts) => ({ ok:true, job_id:'term-1', command, cwd:opts.cwd || '.', work_session_id:opts.work_session_id || null, status:opts.background ? 'running' : 'completed', exit_code:0, stdout:'TERM_OK', stderr:'', stdout_offset:7, stderr_offset:0, terminal:{ hidden:true } }),
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
  await client.connect(transport); assert.equal(client.getServerVersion()?.name, 'personal-chatcode'); assert.equal(client.getServerVersion()?.version, '1.0.0');

  const tools = await client.listTools(); const names = tools.tools.map(tool => tool.name);
  const legacy = ['list_projects','list_files','search_project','read_file','read_files','write_file','delete_file','rename_file','run_task','git_status','git_diff','git_stage','git_commit'];
  const brain = ['project_brain','find_symbols','find_references','related_files','project_context'];
  const agent = ['prepare_task','complete_task'];
  const fast = ['inspect_project','apply_and_verify','operation_status'];
  const terminal = ['exec','job_status','job_stop'];
  const editing = ['start_work','apply_patch','work_status','finish_work','rollback_work'];
  for (const expected of [...legacy,...brain,...agent,...fast,...terminal,...editing]) assert.ok(names.includes(expected), `missing tool: ${expected}`);
  assert.equal(names.length, 31, `expected 31 MCP tools, got ${names.length}`);

  const projects = await client.callTool({ name:'list_projects', arguments:{} }); assert.equal(JSON.parse(projects.content[0].text)[0].name, 'demo');
  const read = await client.callTool({ name:'read_file', arguments:{ project:'demo', path:'README.md' } }); assert.equal(JSON.parse(read.content[0].text).content, '# Demo');
  const inspect = await client.callTool({ name:'inspect_project', arguments:{ project:'demo', query:'checkout address' } }); assert.equal(JSON.parse(inspect.content[0].text).primary_language, 'JavaScript');

  const prepared = await client.callTool({ name:'prepare_task', arguments:{ project:'demo', request:'fix demo output' } });
  const preparedValue = JSON.parse(prepared.content[0].text); assert.equal(preparedValue.status, 'ready'); assert.equal(preparedValue.task_id, 'agent-1'); assert.equal(preparedValue.agent_contract.preferred_calls, 2);
  const unified = '--- a/src/index.js\n+++ b/src/index.js\n@@ -1,1 +1,1 @@\n-console.log("demo")\n+console.log("demo2")\n';
  const completed = await client.callTool({ name:'complete_task', arguments:{ task_id:'agent-1', patch:unified, verify_commands:['node --version'] } });
  const completedValue = JSON.parse(completed.content[0].text); assert.equal(completedValue.status, 'completed'); assert.equal(completedValue.verification_passed, true); assert.equal(completedValue.agent_contract.completed_in_call, 2);

  const started = await client.callTool({ name:'start_work', arguments:{ project:'demo', goal:'edit demo' } });
  assert.equal(JSON.parse(started.content[0].text).work_session_id, 'work-1');
  const patched = await client.callTool({ name:'apply_patch', arguments:{ project:'demo', work_session_id:'work-1', patch:unified } });
  assert.equal(JSON.parse(patched.content[0].text).files[0].operation, 'modify');
  const work = await client.callTool({ name:'work_status', arguments:{ work_session_id:'work-1' } }); assert.equal(JSON.parse(work.content[0].text).status, 'active');

  const terminalExec = await client.callTool({ name:'exec', arguments:{ project:'demo', command:'node --version', background:true, work_session_id:'work-1' } });
  const execValue = JSON.parse(terminalExec.content[0].text); assert.equal(execValue.status, 'running'); assert.equal(execValue.work_session_id, 'work-1');
  const terminalStatus = await client.callTool({ name:'job_status', arguments:{ job_id:'term-1', stdout_offset:0, stderr_offset:0 } }); assert.equal(JSON.parse(terminalStatus.content[0].text).stdout, 'TERM_OK');
  const terminalStop = await client.callTool({ name:'job_stop', arguments:{ job_id:'term-1' } }); assert.equal(JSON.parse(terminalStop.content[0].text).stop_requested, true);

  const finished = await client.callTool({ name:'finish_work', arguments:{ work_session_id:'work-1', verify_commands:['node --version'] } }); assert.equal(JSON.parse(finished.content[0].text).verification_passed, true);
  const rolledBack = await client.callTool({ name:'rollback_work', arguments:{ work_session_id:'work-1' } }); assert.equal(JSON.parse(rolledBack.content[0].text).status, 'rolled_back');

  const deniedWrite = await client.callTool({ name:'write_file', arguments:{ project:'demo', path:'x.txt', content:'x' } });
  assert.equal(deniedWrite.isError, true); const denied = JSON.parse(deniedWrite.content[0].text); assert.equal(denied.ok, false); assert.equal(denied.error.code, 'PERMISSION_DENIED');

  console.log(`MCP smoke test passed: ${names.length} tools, including v1.0 Fast Agent Path + Trusted terminal + Codex editing sessions`);
} finally {
  try { await client.close(); } catch {}
  try { await server.close(); } catch {}
}
