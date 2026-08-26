import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';

function result(value) { const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); return { content: [{ type: 'text', text }] }; }
function errorResult(error) { return { content: [{ type: 'text', text: `Error: ${String(error?.message || error)}` }], isError: true }; }
function byteSize(value) { try { return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null), 'utf8'); } catch { return 0; } }
function activityMeta(tool,args={}) {
  const project=String(args.project||'');
  switch(tool){
    case 'list_projects':return{category:'read',project:'',target:'Danh sách dự án'};
    case 'list_files':return{category:'read',project,target:'Danh sách tệp'};
    case 'search_project':return{category:'read',project,target:'Tìm kiếm trong dự án'};
    case 'read_file':return{category:'read',project,target:String(args.path||'')};
    case 'read_files':return{category:'read',project,target:`${Array.isArray(args.paths)?args.paths.length:0} tệp`};
    case 'write_file':return{category:'write',project,target:String(args.path||'')};
    case 'delete_file':return{category:'manage',project,target:String(args.path||'')};
    case 'rename_file':return{category:'manage',project,target:`${String(args.from||'')} → ${String(args.to||'')}`};
    case 'run_task':return{category:'task',project,target:String(args.command||'').slice(0,140)};
    case 'git_status':return{category:'git',project,target:'Git status'};
    case 'git_diff':return{category:'git',project,target:args.staged?'Git diff (staged)':'Git diff'};
    case 'git_stage':return{category:'git',project,target:`Stage ${Array.isArray(args.paths)?args.paths.length:0} tệp`};
    case 'git_commit':return{category:'git',project,target:'Tạo local commit'};
    default:return{category:'other',project,target:tool};
  }
}
function wrap(api,tool,fn){return async(args)=>{const safeArgs=args||{},started=Date.now(),meta=activityMeta(tool,safeArgs),bytesIn=byteSize(safeArgs);try{const value=await fn(safeArgs);if(typeof api.recordActivity==='function')try{await api.recordActivity({tool,...meta,ok:true,durationMs:Date.now()-started,bytesIn,bytesOut:byteSize(value)})}catch{}return result(value)}catch(error){if(typeof api.recordActivity==='function')try{await api.recordActivity({tool,...meta,ok:false,durationMs:Date.now()-started,bytesIn,bytesOut:byteSize(String(error?.message||error)),error:String(error?.message||error)})}catch{}return errorResult(error)}}}

function buildMcpServer(api){
  const server=new McpServer({name:'personal-chatcode',version:'0.7.0'},{instructions:'This server gives ChatGPT controlled access to folders explicitly added by the user. Start with list_projects. Use read/search tools before editing. Sensitive files and paths escaping the project through symlinks or junctions are blocked. Respect each project permission and Safety Rule. Some write/manage/task/git actions may pause while the user approves them in ChatCode Safety Center; do not retry the same tool call while approval is pending. After changes, inspect git diff and run relevant tests only when task permission is enabled.'});
  server.registerTool('list_projects',{title:'List projects',description:'List folders the user explicitly shared with ChatCode, including current permissions.',inputSchema:z.object({}),annotations:{readOnlyHint:true}},wrap(api,'list_projects',async()=>api.listProjects()));
  server.registerTool('list_files',{title:'List project files',description:'List indexed non-sensitive files inside a project. Build/cache folders and symlink/junction escapes are skipped.',inputSchema:z.object({project:z.string().describe('Project id or exact project name'),limit:z.number().int().min(1).max(5000).optional()}),annotations:{readOnlyHint:true}},wrap(api,'list_files',({project,limit})=>api.listFiles(project,limit)));
  server.registerTool('search_project',{title:'Search project',description:'Search indexed filenames and UTF-8 text/code content in a project and return ranked snippets.',inputSchema:z.object({project:z.string(),query:z.string().min(1)}),annotations:{readOnlyHint:true}},wrap(api,'search_project',({project,query})=>api.search(project,query)));
  server.registerTool('read_file',{title:'Read file',description:'Read one UTF-8 text/code file. Sensitive files and symlink/junction escapes are blocked.',inputSchema:z.object({project:z.string(),path:z.string().min(1)}),annotations:{readOnlyHint:true}},wrap(api,'read_file',({project,path})=>api.readFile(project,path)));
  server.registerTool('read_files',{title:'Read multiple files',description:'Read up to 12 UTF-8 text/code files from one project.',inputSchema:z.object({project:z.string(),paths:z.array(z.string().min(1)).min(1).max(12)}),annotations:{readOnlyHint:true}},wrap(api,'read_files',({project,paths})=>api.readFiles(project,paths)));
  server.registerTool('write_file',{title:'Create or replace file',description:'Create or replace a UTF-8 text file. Requires Write permission and may require user approval according to the project Safety Rule.',inputSchema:z.object({project:z.string(),path:z.string().min(1),content:z.string()}),annotations:{readOnlyHint:false,destructiveHint:true}},wrap(api,'write_file',({project,path,content})=>api.writeFile(project,path,content)));
  server.registerTool('delete_file',{title:'Delete file',description:'Delete one file. Requires Manage Files permission and may wait for user approval.',inputSchema:z.object({project:z.string(),path:z.string().min(1)}),annotations:{readOnlyHint:false,destructiveHint:true}},wrap(api,'delete_file',({project,path})=>api.deleteFile(project,path)));
  server.registerTool('rename_file',{title:'Rename file',description:'Rename or move one file within the same project. Requires Manage Files permission and may wait for user approval.',inputSchema:z.object({project:z.string(),from:z.string().min(1),to:z.string().min(1)}),annotations:{readOnlyHint:false,destructiveHint:true}},wrap(api,'rename_file',({project,from,to})=>api.renameFile(project,from,to)));
  server.registerTool('run_task',{title:'Run development task',description:'Run an allow-listed development command such as npm test, npm run build, pytest, cargo test, go test, or dotnet test. Requires Task permission and may wait for user approval.',inputSchema:z.object({project:z.string(),command:z.string().min(1)}),annotations:{readOnlyHint:false,destructiveHint:true}},wrap(api,'run_task',({project,command})=>api.runTask(project,command)));
  server.registerTool('git_status',{title:'Git status',description:'Read git branch/status for a project.',inputSchema:z.object({project:z.string()}),annotations:{readOnlyHint:true}},wrap(api,'git_status',({project})=>api.gitStatus(project)));
  server.registerTool('git_diff',{title:'Git diff',description:'Read unstaged or staged git diff for a project.',inputSchema:z.object({project:z.string(),staged:z.boolean().optional()}),annotations:{readOnlyHint:true}},wrap(api,'git_diff',({project,staged})=>api.gitDiff(project,!!staged)));
  server.registerTool('git_stage',{title:'Stage git files',description:'Stage explicit non-sensitive file paths. Requires Git write permission and follows the project Safety Rule.',inputSchema:z.object({project:z.string(),paths:z.array(z.string().min(1)).min(1).max(100)}),annotations:{readOnlyHint:false,destructiveHint:true}},wrap(api,'git_stage',({project,paths})=>api.gitStage(project,paths)));
  server.registerTool('git_commit',{title:'Create local git commit',description:'Commit already staged changes locally. Requires Git write permission, may wait for user approval, and never pushes.',inputSchema:z.object({project:z.string(),message:z.string().min(1).max(300)}),annotations:{readOnlyHint:false,destructiveHint:true}},wrap(api,'git_commit',({project,message})=>api.gitCommit(project,message)));
  return server;
}

export async function startMcpHttpServer({port,token,api}){
  const route=`/${token}/mcp`;
  const httpServer=createServer(async(req,res)=>{
    const url=new URL(req.url||'/',`http://${req.headers.host||'127.0.0.1'}`);
    if(url.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,service:'personal-chatcode'}));return}
    if(url.pathname!==route){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:'Not found'}));return}
    if(!['POST','GET','DELETE'].includes(req.method||'')){res.writeHead(405,{'content-type':'application/json'});res.end(JSON.stringify({error:'Method not allowed'}));return}
    const server=buildMcpServer(api),transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    try{await server.connect(transport);await transport.handleRequest(req,res)}catch(error){if(!res.headersSent){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32603,message:String(error?.message||error)},id:null}))}}finally{try{await transport.close()}catch{}try{await server.close()}catch{}}
  });
  await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(port,'127.0.0.1',resolve)});
  return{route,localUrl:`http://127.0.0.1:${port}${route}`,close:()=>new Promise(resolve=>httpServer.close(()=>resolve()))};
}
