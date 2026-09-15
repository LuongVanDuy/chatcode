const fs = require('fs');
const file='mcp-server.mjs';
let s=fs.readFileSync(file,'utf8');
function rep(a,b){if(!s.includes(a))throw new Error(`mcp marker missing: ${a.slice(0,80)}`);s=s.replace(a,b);}
rep("    case 'rollback_work': return { category:'manage', project:'', target:`Rollback work ${String(args.work_session_id || '').slice(0,36)}` };",
"    case 'rollback_work': return { category:'manage', project:'', target:`Rollback work ${String(args.work_session_id || '').slice(0,36)}` };\n    case 'database': return { category:['mutate','rollback'].includes(String(args.action || '').toLowerCase()) ? 'write' : 'read', project, target:`Database ${String(args.action || 'inspect')} ${String(args.operation || '').slice(0,80)}`.trim() };");
rep("    work_status:'status', finish_work:'finish', rollback_work:'rollback'",
"    work_status:'status', finish_work:'finish', rollback_work:'rollback', database:'database'");
rep("(?:failed|needs_fix|deploy_failed|verification_failed|timeout|timed_out|rollback_partial)",
"(?:failed|needs_fix|path_exhausted|deploy_failed|verification_failed|timeout|timed_out|rollback_partial)");
const marker = "  server.registerTool('rollback_work',{ title:'Rollback work session', description:'Restore all file states changed by the work session in reverse order, including files created during the session, then refresh Brain. Rollback does not depend on Git.', inputSchema:z.object({ work_session_id:z.string().min(1) }), annotations:LOCAL_WRITE },wrap(api,'rollback_work',({work_session_id})=>api.rollbackWork(work_session_id)));\n";
const insert = `${marker}\n  server.registerTool('database',{ title:'WordPress database capability', description:'Inspect WordPress/FTP database topology, run bounded read-only queries, execute structured recoverable mutations, or rollback a mutation. FTP mirrors prefer an authenticated server-side WordPress path; local DB credentials are never returned. mutate/rollback require the current task_id.', inputSchema:z.object({ project:z.string(), action:z.enum(['inspect','query','mutate','rollback']).default('inspect'), task_id:z.string().min(1).optional(), sql:z.string().max(32000).optional(), params:z.array(z.any()).max(50).optional(), operation:z.enum(['insert_post','update_meta','update_option','wpdb_insert','wpdb_update','wpdb_delete','bricks_update_meta']).optional(), payload:z.record(z.string(),z.any()).optional(), recovery_id:z.string().min(1).optional(), max_rows:z.number().int().min(1).max(200).optional(), probe_remote:z.boolean().optional() }), annotations:LOCAL_WRITE_OPEN_WORLD },wrap(api,'database',({project,...input})=>api.databaseOp(project,input)));\n`;
rep(marker,insert);
fs.writeFileSync(file,s);
console.log('single database MCP tool staged');
