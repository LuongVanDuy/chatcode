import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createRequire } from 'node:module';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const { normalizeError } = require('./core/errors');

function byteSize(value) { try { return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null), 'utf8'); } catch { return 0; } }
function telemetryShape(value = {}, totalMs = 0) {
  return {
    total_ms:Math.max(0, Number(value.total_ms) || totalMs || 0),
    filesystem_ms:Math.max(0, Number(value.filesystem_ms) || 0),
    brain_refresh_ms:Math.max(0, Number(value.brain_refresh_ms) || 0),
    git_ms:Math.max(0, Number(value.git_ms) || 0),
    ...(value.inspect_ms != null ? { inspect_ms:Number(value.inspect_ms) || 0 } : {}),
    ...(value.patch_ms != null ? { patch_ms:Number(value.patch_ms) || 0 } : {}),
    ...(value.verify_ms != null ? { verify_ms:Number(value.verify_ms) || 0 } : {}),
    ...(value.finalize_ms != null ? { finalize_ms:Number(value.finalize_ms) || 0 } : {}),
    ...(value.write_to_searchable_ms != null ? { write_to_searchable_ms:Number(value.write_to_searchable_ms) || 0 } : {}),
    ...(value.rename_to_brain_ms != null ? { rename_to_brain_ms:Number(value.rename_to_brain_ms) || 0 } : {}),
    ...(value.delete_stale_cleanup_ms != null ? { delete_stale_cleanup_ms:Number(value.delete_stale_cleanup_ms) || 0 } : {})
  };
}
function result(value, telemetry = {}) { const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); return { content:[{ type:'text', text }], _meta:{ telemetry } }; }
function errorResult(error, telemetry = {}) { const normalized = normalizeError(error); return { content:[{ type:'text', text:JSON.stringify({ ok:false, error:normalized }, null, 2) }], isError:true, _meta:{ telemetry } }; }

function activityMeta(tool, args = {}) {
  const project = String(args.project || '');
  switch (tool) {
    case 'list_projects': return { category:'read', project:'', target:'Danh sách dự án' };
    case 'list_files': return { category:'read', project, target:'Danh sách tệp' };
    case 'search_project': return { category:'read', project, target:'Tìm kiếm trong dự án' };
    case 'read_file': return { category:'read', project, target:String(args.path || '') };
    case 'read_files': return { category:'read', project, target:`${Array.isArray(args.paths) ? args.paths.length : 0} tệp` };
    case 'project_brain': return { category:'read', project, target:'Project Brain tổng quan' };
    case 'find_symbols': return { category:'read', project, target:`Symbol: ${String(args.query || '').slice(0,120)}` };
    case 'find_references': return { category:'read', project, target:`References: ${String(args.symbol || '').slice(0,120)}` };
    case 'related_files': return { category:'read', project, target:`Related: ${String(args.path || '').slice(0,160)}` };
    case 'project_context': return { category:'read', project, target:`Context: ${String(args.query || '').slice(0,160)}` };
    case 'prepare_task': return { category:'read', project, target:`Agent prepare: ${String(args.request || '').slice(0,160)}` };
    case 'complete_task': return { category:'write', project:'', target:`Agent complete ${String(args.task_id || '').slice(0,36)}` };
    case 'inspect_project': return { category:'read', project, target:`Inspect: ${String(args.query || '').slice(0,160)}` };
    case 'apply_and_verify': return { category:'write', project, target:`Fast-path ${Array.isArray(args.changes) ? args.changes.length : 0} changes / ${Array.isArray(args.tasks) ? args.tasks.length : 0} tasks` };
    case 'operation_status': return { category:'read', project:'', target:`Fast-path job ${String(args.job_id || '').slice(0,80)}` };
    case 'start_work': return { category:'read', project, target:`Work: ${String(args.goal || '').slice(0,160)}` };
    case 'apply_patch': return { category:'write', project, target:`Unified patch ${String(args.work_session_id || '').slice(0,36)}` };
    case 'work_status': return { category:'read', project:'', target:`Work ${String(args.work_session_id || '').slice(0,36)}` };
    case 'finish_work': return { category:'task', project:'', target:`Finish work ${String(args.work_session_id || '').slice(0,36)}` };
    case 'rollback_work': return { category:'manage', project:'', target:`Rollback work ${String(args.work_session_id || '').slice(0,36)}` };
    case 'write_file': return { category:'write', project, target:String(args.path || '') };
    case 'delete_file': return { category:'manage', project, target:String(args.path || '') };
    case 'rename_file': return { category:'manage', project, target:`${String(args.from || '')} → ${String(args.to || '')}` };
    case 'run_task': return { category:'task', project, target:String(args.command || '').slice(0,140) };
    case 'exec': return { category:args.background ? 'other' : 'task', project, target:`Terminal: ${String(args.command || '').slice(0,140)}` };
    case 'job_status': return { category:'read', project:'', target:`Terminal job ${String(args.job_id || '').slice(0,80)}` };
    case 'job_stop': return { category:'other', project:'', target:`Stop terminal job ${String(args.job_id || '').slice(0,80)}` };
    case 'git_status': return { category:'git', project, target:'Git status' };
    case 'git_diff': return { category:'git', project, target:args.staged ? 'Git diff (staged)' : 'Git diff' };
    case 'git_stage': return { category:'git', project, target:`Stage ${Array.isArray(args.paths) ? args.paths.length : 0} tệp` };
    case 'git_commit': return { category:'git', project, target:'Tạo local commit' };
    default: return { category:'other', project, target:tool };
  }
}

function wrap(api, tool, fn) {
  return async args => {
    const safeArgs = args || {}, started = Date.now(), meta = activityMeta(tool, safeArgs), bytesIn = byteSize(safeArgs);
    try {
      const value = await fn(safeArgs); const elapsed = Date.now() - started; const telemetry = telemetryShape(value?.telemetry || {}, elapsed);
      if (typeof api.recordActivity === 'function') try { await api.recordActivity({ tool, ...meta, ok:true, durationMs:elapsed, bytesIn, bytesOut:byteSize(value) }); } catch {}
      return result(value, telemetry);
    } catch (error) {
      const elapsed = Date.now() - started, normalized = normalizeError(error), telemetry = telemetryShape({}, elapsed);
      if (typeof api.recordActivity === 'function') try { await api.recordActivity({ tool, ...meta, ok:false, durationMs:elapsed, bytesIn, bytesOut:byteSize(normalized), error:`${normalized.code}: ${normalized.message}` }); } catch {}
      return errorResult(error, telemetry);
    }
  };
}

const changeSchema = z.object({
  op:z.enum(['write','patch','rename','move','delete']), path:z.string().optional(), content:z.string().optional(), from:z.string().optional(), to:z.string().optional(),
  edits:z.array(z.object({ find:z.string(), replace:z.string(), all:z.boolean().optional() })).max(40).optional()
});

function buildMcpServer(api) {
  const server = new McpServer({ name:'personal-chatcode', version:'1.0.0' }, { instructions:'ChatCode v1.0 gives controlled access to local projects. For normal coding tasks, use the Fast Agent Path: call prepare_task(project,request) first. It opens a work session and returns ranked context, relevant file contents, Brain/framework data, Git baseline and verification hints. Then create a standard unified diff and call complete_task(task_id,patch,verify_commands). A normal task should finish in 2 MCP calls. If complete_task returns needs_fix, keep the same task_id, create a corrective diff against the current files and call complete_task again; do not restart inspection. Use rollback_work(task_id) only when abandoning the task. Lower-level start_work/apply_patch/work_status/finish_work and inspect_project/apply_and_verify remain available for compatibility or unusual workflows. Safe Workspace keeps approvals and run_task allow-list behavior. Trusted Workspace can use real shell exec with chaining/pipes/background jobs; exec is not an OS filesystem sandbox. Git push/reset --hard remain blocked. Never push Git.' });

  server.registerTool('list_projects',{ title:'List projects', description:'List folders explicitly shared with ChatCode, including permissions and workspace mode.', inputSchema:z.object({}), annotations:{ readOnlyHint:true } },wrap(api,'list_projects',async()=>api.listProjects()));
  server.registerTool('list_files',{ title:'List project files', description:'List indexed non-sensitive files inside a project.', inputSchema:z.object({ project:z.string(), limit:z.number().int().min(1).max(5000).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'list_files',({project,limit})=>api.listFiles(project,limit)));
  server.registerTool('search_project',{ title:'Search project', description:'Search filenames and UTF-8 text/code content and return ranked snippets.', inputSchema:z.object({ project:z.string(), query:z.string().min(1) }), annotations:{ readOnlyHint:true } },wrap(api,'search_project',({project,query})=>api.search(project,query)));
  server.registerTool('read_file',{ title:'Read file', description:'Read one UTF-8 text/code file. Sensitive paths are blocked unless explicitly enabled in Trusted Workspace.', inputSchema:z.object({ project:z.string(), path:z.string().min(1) }), annotations:{ readOnlyHint:true } },wrap(api,'read_file',({project,path})=>api.readFile(project,path)));
  server.registerTool('read_files',{ title:'Read multiple files', description:'Read up to 12 UTF-8 text/code files from one project.', inputSchema:z.object({ project:z.string(), paths:z.array(z.string().min(1)).min(1).max(12) }), annotations:{ readOnlyHint:true } },wrap(api,'read_files',({project,paths})=>api.readFiles(project,paths)));

  server.registerTool('project_brain',{ title:'Project Brain overview', description:'Return framework summary, primary language, entrypoints, WordPress hooks/routes, symbols, hotspots and dependency graph.', inputSchema:z.object({ project:z.string() }), annotations:{ readOnlyHint:true } },wrap(api,'project_brain',({project})=>api.projectBrain(project)));
  server.registerTool('find_symbols',{ title:'Find code symbols', description:'Find indexed code/WordPress symbols.', inputSchema:z.object({ project:z.string(), query:z.string().default(''), kind:z.string().optional(), limit:z.number().int().min(1).max(100).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'find_symbols',({project,query,kind,limit})=>api.findSymbols(project,query,kind||'',limit)));
  server.registerTool('find_references',{ title:'Find symbol references', description:'Find indexed definitions and reference lines for a symbol.', inputSchema:z.object({ project:z.string(), symbol:z.string().min(1), limit:z.number().int().min(1).max(160).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'find_references',({project,symbol,limit})=>api.findReferences(project,symbol,limit)));
  server.registerTool('related_files',{ title:'Find related files', description:'Rank related files using imports, WordPress relations, selectors and reverse dependencies.', inputSchema:z.object({ project:z.string(), path:z.string().min(1), limit:z.number().int().min(1).max(50).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'related_files',({project,path,limit})=>api.relatedFiles(project,path,limit)));
  server.registerTool('project_context',{ title:'Get task-focused project context', description:'Return WordPress-aware ranked files/symbols/relations for a task.', inputSchema:z.object({ project:z.string(), query:z.string().min(1), limit:z.number().int().min(3).max(24).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'project_context',({project,query,limit})=>api.projectContext(project,query,limit)));

  server.registerTool('prepare_task',{ title:'Prepare coding task', description:'Fast Agent Path call 1/2. Opens a Work Session and returns the task_id plus ranked source contents, Brain/framework context, Git baseline and verification hints. Prefer this over separate inspect_project + start_work calls.', inputSchema:z.object({ project:z.string(), request:z.string().min(1).max(2000), limit:z.number().int().min(4).max(12).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'prepare_task',({project,request,limit})=>api.prepareTask(project,request,limit)));
  server.registerTool('complete_task',{ title:'Complete coding task', description:'Fast Agent Path call 2/2. Apply a transactional unified diff, run up to six verification commands, refresh Brain/Git and finalize the task. Verification failure returns needs_fix while keeping the same task active for a corrective complete_task call.', inputSchema:z.object({ task_id:z.string().min(1), patch:z.string().min(1).max(2097152), verify_commands:z.array(z.string().min(1).max(16000)).max(6).default([]), finalize:z.boolean().default(true), rollback_on_failure:z.boolean().default(false) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'complete_task',({task_id,patch,verify_commands,finalize,rollback_on_failure})=>api.completeTask(task_id,patch,verify_commands,{ finalize, rollbackOnFailure:rollback_on_failure })));

  server.registerTool('inspect_project',{ title:'Inspect project for a coding task', description:'Legacy fast context call: framework/WordPress summary, relevant file contents, symbols, relations and Git state.', inputSchema:z.object({ project:z.string(), query:z.string().min(1), limit:z.number().int().min(4).max(16).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'inspect_project',({project,query,limit})=>api.inspectProject(project,query,limit)));
  server.registerTool('apply_and_verify',{ title:'Apply changes and verify', description:'Legacy fast mutation path with recovery, Brain refresh, verification and Git diff.', inputSchema:z.object({ project:z.string(), changes:z.array(changeSchema).max(24).default([]), tasks:z.array(z.string()).max(6).default([]) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'apply_and_verify',({project,changes,tasks})=>api.applyAndVerify(project,changes,tasks)));
  server.registerTool('operation_status',{ title:'Fast-path operation status', description:'Read a pending apply_and_verify job after approval.', inputSchema:z.object({ job_id:z.string().min(1) }), annotations:{ readOnlyHint:true } },wrap(api,'operation_status',({job_id})=>api.operationStatus(job_id)));

  server.registerTool('start_work',{ title:'Start coding work session', description:'Create a work session with goal, baseline Git state and Brain summary. Use its id with apply_patch and Trusted exec.', inputSchema:z.object({ project:z.string(), goal:z.string().max(1200).default('') }), annotations:{ readOnlyHint:true } },wrap(api,'start_work',({project,goal})=>api.startWork(project,goal)));
  server.registerTool('apply_patch',{ title:'Apply unified diff', description:'Apply a standard multi-file unified diff transactionally. Preflights hunks, uses existing safety/recovery rules, refreshes Brain and returns Git state. If a later file fails, earlier files are auto-restored.', inputSchema:z.object({ project:z.string(), patch:z.string().min(1).max(2097152), work_session_id:z.string().optional() }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'apply_patch',({project,patch,work_session_id})=>api.applyPatch(project,patch,work_session_id||'')));
  server.registerTool('work_status',{ title:'Read work session', description:'Return session operations, changed files, commands, recovery points and current Git status/diff.', inputSchema:z.object({ work_session_id:z.string().min(1) }), annotations:{ readOnlyHint:true } },wrap(api,'work_status',({work_session_id})=>api.workStatus(work_session_id)));
  server.registerTool('finish_work',{ title:'Finish and verify work session', description:'Optionally run up to six verification commands, refresh Brain and return final Git diff/status.', inputSchema:z.object({ work_session_id:z.string().min(1), verify_commands:z.array(z.string().min(1)).max(6).default([]) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'finish_work',({work_session_id,verify_commands})=>api.finishWork(work_session_id,verify_commands)));
  server.registerTool('rollback_work',{ title:'Rollback work session', description:'Restore all file states changed by the work session in reverse order, including files created during the session, then refresh Brain and return Git state.', inputSchema:z.object({ work_session_id:z.string().min(1) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'rollback_work',({work_session_id})=>api.rollbackWork(work_session_id)));

  server.registerTool('write_file',{ title:'Create or replace file', description:'Create or replace UTF-8 text with existing approval/recovery behavior.', inputSchema:z.object({ project:z.string(), path:z.string().min(1), content:z.string() }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'write_file',({project,path,content})=>api.writeFile(project,path,content)));
  server.registerTool('delete_file',{ title:'Delete file', description:'Delete one file with existing permission/recovery behavior.', inputSchema:z.object({ project:z.string(), path:z.string().min(1) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'delete_file',({project,path})=>api.deleteFile(project,path)));
  server.registerTool('rename_file',{ title:'Rename file', description:'Rename/move one file inside the project.', inputSchema:z.object({ project:z.string(), from:z.string().min(1), to:z.string().min(1) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'rename_file',({project,from,to})=>api.renameFile(project,from,to)));
  server.registerTool('run_task',{ title:'Run development task', description:'Safe-compatible allow-listed task runner. Trusted Workspace should prefer exec.', inputSchema:z.object({ project:z.string(), command:z.string().min(1) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'run_task',({project,command})=>api.runTask(project,command)));

  server.registerTool('exec',{ title:'Run Trusted terminal command', description:'Trusted Workspace only. Run a real shell command inside project cwd, foreground or background. Supports chaining/pipes.', inputSchema:z.object({ project:z.string(), command:z.string().min(1).max(16000), cwd:z.string().optional(), background:z.boolean().optional(), timeout_ms:z.number().int().min(1000).max(43200000).optional(), work_session_id:z.string().optional() }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'exec',({project,command,cwd,background,timeout_ms,work_session_id})=>api.exec(project,command,{ cwd,background,timeout_ms,work_session_id })));
  server.registerTool('job_status',{ title:'Read terminal job output', description:'Read current state and incremental stdout/stderr for a terminal job.', inputSchema:z.object({ job_id:z.string().min(1), stdout_offset:z.number().int().min(0).optional(), stderr_offset:z.number().int().min(0).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'job_status',({job_id,stdout_offset,stderr_offset})=>api.jobStatus(job_id,{ stdout_offset,stderr_offset })));
  server.registerTool('job_stop',{ title:'Stop terminal job', description:'Stop a running Trusted terminal process tree.', inputSchema:z.object({ job_id:z.string().min(1) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'job_stop',({job_id})=>api.jobStop(job_id)));

  server.registerTool('git_status',{ title:'Git status', description:'Read Git branch/status.', inputSchema:z.object({ project:z.string() }), annotations:{ readOnlyHint:true } },wrap(api,'git_status',({project})=>api.gitStatus(project)));
  server.registerTool('git_diff',{ title:'Git diff', description:'Read unstaged or staged Git diff.', inputSchema:z.object({ project:z.string(), staged:z.boolean().optional() }), annotations:{ readOnlyHint:true } },wrap(api,'git_diff',({project,staged})=>api.gitDiff(project,!!staged)));
  server.registerTool('git_stage',{ title:'Stage git files', description:'Stage explicit non-sensitive files. Never pushes.', inputSchema:z.object({ project:z.string(), paths:z.array(z.string().min(1)).min(1).max(100) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'git_stage',({project,paths})=>api.gitStage(project,paths)));
  server.registerTool('git_commit',{ title:'Create local git commit', description:'Commit staged changes locally. Never pushes.', inputSchema:z.object({ project:z.string(), message:z.string().min(1).max(300) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'git_commit',({project,message})=>api.gitCommit(project,message)));
  return server;
}

export async function startMcpHttpServer({ port, token, api }) {
  const route = `/${token}/mcp`;
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type':'application/json' }); res.end(JSON.stringify({ ok:true, service:'personal-chatcode' })); return; }
    if (url.pathname !== route) { res.writeHead(404, { 'content-type':'application/json' }); res.end(JSON.stringify({ error:'Not found' })); return; }
    if (!['POST','GET','DELETE'].includes(req.method || '')) { res.writeHead(405, { 'content-type':'application/json' }); res.end(JSON.stringify({ error:'Method not allowed' })); return; }
    const server = buildMcpServer(api), transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator:undefined, enableJsonResponse:true });
    try { await server.connect(transport); await transport.handleRequest(req, res); }
    catch (error) { if (!res.headersSent) { const normalized = normalizeError(error); res.writeHead(500, { 'content-type':'application/json' }); res.end(JSON.stringify({ jsonrpc:'2.0', error:{ code:-32603, message:normalized.message, data:{ chatcode_error:normalized } }, id:null })); } }
    finally { try { await transport.close(); } catch {} try { await server.close(); } catch {} }
  });
  await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(port, '127.0.0.1', resolve); });
  return { route, localUrl:`http://127.0.0.1:${port}${route}`, close:() => new Promise(resolve => httpServer.close(() => resolve())) };
}