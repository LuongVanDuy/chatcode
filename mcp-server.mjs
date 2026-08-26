import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createRequire } from 'node:module';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const { normalizeError } = require('./core/errors');

function byteSize(value) { try { return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null), 'utf8'); } catch { return 0; } }
function telemetryShape(value = {}, totalMs = 0) { return { total_ms:Math.max(0, Number(value.total_ms) || totalMs || 0), filesystem_ms:Math.max(0, Number(value.filesystem_ms) || 0), brain_refresh_ms:Math.max(0, Number(value.brain_refresh_ms) || 0), git_ms:Math.max(0, Number(value.git_ms) || 0), ...(value.write_to_searchable_ms != null ? { write_to_searchable_ms:Number(value.write_to_searchable_ms) || 0 } : {}), ...(value.rename_to_brain_ms != null ? { rename_to_brain_ms:Number(value.rename_to_brain_ms) || 0 } : {}), ...(value.delete_stale_cleanup_ms != null ? { delete_stale_cleanup_ms:Number(value.delete_stale_cleanup_ms) || 0 } : {}) }; }
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
    case 'inspect_project': return { category:'read', project, target:`Inspect: ${String(args.query || '').slice(0,160)}` };
    case 'apply_and_verify': return { category:'write', project, target:`Fast-path ${Array.isArray(args.changes) ? args.changes.length : 0} changes / ${Array.isArray(args.tasks) ? args.tasks.length : 0} tasks` };
    case 'operation_status': return { category:'read', project:'', target:`Fast-path job ${String(args.job_id || '').slice(0,80)}` };
    case 'write_file': return { category:'write', project, target:String(args.path || '') };
    case 'delete_file': return { category:'manage', project, target:String(args.path || '') };
    case 'rename_file': return { category:'manage', project, target:`${String(args.from || '')} → ${String(args.to || '')}` };
    case 'run_task': return { category:'task', project, target:String(args.command || '').slice(0,140) };
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
  op:z.enum(['write','patch','rename','move','delete']),
  path:z.string().optional(),
  content:z.string().optional(),
  from:z.string().optional(),
  to:z.string().optional(),
  edits:z.array(z.object({ find:z.string(), replace:z.string(), all:z.boolean().optional() })).max(40).optional()
});

function buildMcpServer(api) {
  const server = new McpServer({ name:'personal-chatcode', version:'0.9.0' }, { instructions:'ChatCode gives controlled access to local projects. Prefer inspect_project(query) as the first call for normal coding tasks: it returns framework summary, WordPress-aware context, relevant file contents, dependency graph and Git state. Prefer apply_and_verify(changes,tasks) for edits; it creates recovery snapshots, refreshes Project Brain, verifies mutations and returns git diff. If apply_and_verify returns status=pending, DO NOT retry it. Wait for the user to approve in ChatCode and then call operation_status(job_id). Legacy read/write/Brain/Git tools remain available for precise work. Sensitive paths and project escapes are blocked. Never push Git.' });

  server.registerTool('list_projects',{ title:'List projects', description:'List folders explicitly shared with ChatCode, including permissions.', inputSchema:z.object({}), annotations:{ readOnlyHint:true } },wrap(api,'list_projects',async()=>api.listProjects()));
  server.registerTool('list_files',{ title:'List project files', description:'List indexed non-sensitive files inside a project.', inputSchema:z.object({ project:z.string(), limit:z.number().int().min(1).max(5000).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'list_files',({project,limit})=>api.listFiles(project,limit)));
  server.registerTool('search_project',{ title:'Search project', description:'Search filenames and UTF-8 text/code content and return ranked snippets.', inputSchema:z.object({ project:z.string(), query:z.string().min(1) }), annotations:{ readOnlyHint:true } },wrap(api,'search_project',({project,query})=>api.search(project,query)));
  server.registerTool('read_file',{ title:'Read file', description:'Read one UTF-8 text/code file. Unknown extensions are content-sniffed; sensitive paths are blocked.', inputSchema:z.object({ project:z.string(), path:z.string().min(1) }), annotations:{ readOnlyHint:true } },wrap(api,'read_file',({project,path})=>api.readFile(project,path)));
  server.registerTool('read_files',{ title:'Read multiple files', description:'Read up to 12 UTF-8 text/code files from one project.', inputSchema:z.object({ project:z.string(), paths:z.array(z.string().min(1)).min(1).max(12) }), annotations:{ readOnlyHint:true } },wrap(api,'read_files',({project,paths})=>api.readFiles(project,paths)));

  server.registerTool('project_brain',{ title:'Project Brain overview', description:'Return framework summary, primary language, entrypoints, WordPress hooks/routes, symbols, hotspots and cross-language dependency graph.', inputSchema:z.object({ project:z.string() }), annotations:{ readOnlyHint:true } },wrap(api,'project_brain',({project})=>api.projectBrain(project)));
  server.registerTool('find_symbols',{ title:'Find code symbols', description:'Find functions, classes, methods, interfaces, types and indexed PHP/WordPress symbols.', inputSchema:z.object({ project:z.string(), query:z.string().default(''), kind:z.string().optional(), limit:z.number().int().min(1).max(100).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'find_symbols',({project,query,kind,limit})=>api.findSymbols(project,query,kind||'',limit)));
  server.registerTool('find_references',{ title:'Find symbol references', description:'Find indexed definitions and reference lines for a symbol.', inputSchema:z.object({ project:z.string(), symbol:z.string().min(1), limit:z.number().int().min(1).max(160).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'find_references',({project,symbol,limit})=>api.findReferences(project,symbol,limit)));
  server.registerTool('related_files',{ title:'Find related files', description:'Rank related files using imports, PHP includes, WordPress enqueue/localize relations, selectors and reverse dependencies.', inputSchema:z.object({ project:z.string(), path:z.string().min(1), limit:z.number().int().min(1).max(50).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'related_files',({project,path,limit})=>api.relatedFiles(project,path,limit)));
  server.registerTool('project_context',{ title:'Get task-focused project context', description:'Return WordPress-aware ranked files/symbols/relations for a task. Custom child theme/plugin code is preferred over core/vendor/minified files.', inputSchema:z.object({ project:z.string(), query:z.string().min(1), limit:z.number().int().min(3).max(24).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'project_context',({project,query,limit})=>api.projectContext(project,query,limit)));

  server.registerTool('inspect_project',{ title:'Inspect project for a coding task', description:'Fast coding path. In one call return framework/WordPress summary, primary language, entrypoints, ranked relevant file contents, symbols, dependency relations and Git state for a query.', inputSchema:z.object({ project:z.string(), query:z.string().min(1), limit:z.number().int().min(4).max(16).optional() }), annotations:{ readOnlyHint:true } },wrap(api,'inspect_project',({project,query,limit})=>api.inspectProject(project,query,limit)));
  server.registerTool('apply_and_verify',{ title:'Apply changes and verify', description:'Fast coding path. Apply up to 24 write/patch/rename/delete changes and up to 6 safe tasks, create recovery snapshots, refresh indexes/Brain, verify state and return git diff. If approval is required it returns a pending job immediately; do not retry this call.', inputSchema:z.object({ project:z.string(), changes:z.array(changeSchema).max(24).default([]), tasks:z.array(z.string()).max(6).default([]) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'apply_and_verify',({project,changes,tasks})=>api.applyAndVerify(project,changes,tasks)));
  server.registerTool('operation_status',{ title:'Fast-path operation status', description:'Read the state/result of a pending apply_and_verify job after user approval. This tool is read-only and must be used instead of retrying the mutation.', inputSchema:z.object({ job_id:z.string().min(1) }), annotations:{ readOnlyHint:true } },wrap(api,'operation_status',({job_id})=>api.operationStatus(job_id)));

  server.registerTool('write_file',{ title:'Create or replace file', description:'Create or replace UTF-8 text. Returns machine-readable approval and recovery snapshot status.', inputSchema:z.object({ project:z.string(), path:z.string().min(1), content:z.string() }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'write_file',({project,path,content})=>api.writeFile(project,path,content)));
  server.registerTool('delete_file',{ title:'Delete file', description:'Delete one file. Requires permission and may wait for approval; returns recovery snapshot status.', inputSchema:z.object({ project:z.string(), path:z.string().min(1) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'delete_file',({project,path})=>api.deleteFile(project,path)));
  server.registerTool('rename_file',{ title:'Rename file', description:'Rename/move one file inside the project. Requires permission and may wait for approval.', inputSchema:z.object({ project:z.string(), from:z.string().min(1), to:z.string().min(1) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'rename_file',({project,from,to})=>api.renameFile(project,from,to)));
  server.registerTool('run_task',{ title:'Run development task', description:'Run one allow-listed command with no shell chaining. Returns approval and Windows notification count/status.', inputSchema:z.object({ project:z.string(), command:z.string().min(1) }), annotations:{ readOnlyHint:false, destructiveHint:true } },wrap(api,'run_task',({project,command})=>api.runTask(project,command)));
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