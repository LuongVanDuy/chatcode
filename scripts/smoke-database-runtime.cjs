const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  classifyDbHost, parseWpConfig, validateReadSql, validateMutation,
  createDatabaseApi, HELPER_RE
} = require('../core/database-runtime');
const { buildFtpOwnedDeleteCommand } = require('../core/ftp-deploy');

assert.equal(classifyDbHost('localhost'),'server-local');
assert.equal(classifyDbHost('127.0.0.1:3306'),'server-local');
assert.equal(classifyDbHost('db.example.com:3306'),'remote-or-dns');
const parsed = parseWpConfig("define('DB_HOST','localhost');\n$table_prefix='wp9_';\ndefine('DB_PASSWORD','secret');");
assert.equal(parsed.db_host,'localhost');
assert.equal(parsed.table_prefix,'wp9_');
assert.equal(JSON.stringify(parsed).includes('secret'),false,'database topology must never expose DB credentials');
assert.equal(validateReadSql('SELECT ID FROM {posts} LIMIT 2').startsWith('SELECT'),true);
assert.throws(()=>validateReadSql('UPDATE wp_posts SET post_title="x"'), /read-only|SELECT\/SHOW/i);
assert.throws(()=>validateMutation('wpdb_delete',{ table:'{posts}', where:{ ID:1 }, data:{} }), /confirm_destructive/i);
assert.doesNotThrow(()=>validateMutation('wpdb_delete',{ table:'{posts}', where:{ ID:1 }, data:{}, confirm_destructive:true },10));
assert.throws(()=>buildFtpOwnedDeleteCommand('runner','C:/site','wp-content/uploads/a.php'), /restricted/i);
assert.ok(HELPER_RE.test('wp-content/chatcode-db-once-0123456789abcdef01234567.php'));

function tempProject({ persistent = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-db-smoke-'));
  fs.mkdirSync(path.join(root,'.vscode'),{recursive:true});
  fs.writeFileSync(path.join(root,'wp-config.php'),"<?php define('DB_HOST','localhost'); $table_prefix='wp_';",'utf8');
  fs.writeFileSync(path.join(root,'wp-load.php'),'<?php','utf8');
  fs.writeFileSync(path.join(root,'wp-settings.php'),'<?php','utf8');
  const config = { protocol:'ftp', host:'ftp.example.com', username:'u', password:'p', remotePath:'/public_html', uploadOnSave:false, siteUrl:'https://example.com' };
  if (persistent) config.chatcodeDatabase = { url:'https://example.com', path:'/wp-json/chatcode/v1/database', token:'private-token' };
  fs.writeFileSync(path.join(root,'.vscode','sftp.json'),JSON.stringify(config),'utf8');
  return root;
}

async function runOneShotLifecycle() {
  const root = tempProject();
  const project = { id:'p1', name:'example.com', root, workspaceMode:'trusted' };
  const store = { getProject:ref => { if (String(ref)!=='p1') throw new Error('missing'); return project; } };
  const patches = [], deployments = [], deletions = [], requests = [];
  const api = {
    workStatus:async id => ({ status:'active', project_id:id === 'wrong-task' ? 'p2' : 'p1', work_session_id:id, workspace_mode:'trusted' }),
    applyPatch:async (_ref,patch,task) => { patches.push({patch,task}); return { changed_files:[] }; }
  };
  const fetchImpl = async (url,opts={}) => {
    requests.push({url,method:opts.method||'GET'});
    if ((opts.method||'GET') === 'GET') return { ok:true, status:200, text:async()=>JSON.stringify({ name:'WordPress' }) };
    const body = JSON.parse(opts.body||'{}');
    if (body.action === 'mutate') return { ok:true,status:200,text:async()=>JSON.stringify({ ok:true,changed:true,post_id:77,recovery:{ kind:'delete_post',post_id:77 } }) };
    if (body.action === 'rollback') return { ok:true,status:200,text:async()=>JSON.stringify({ ok:true,rolled_back:true }) };
    return { ok:false,status:400,text:async()=>JSON.stringify({ ok:false,error:'unexpected' }) };
  };
  const runtime = createDatabaseApi(api,store,{
    fetchImpl,
    deployChangedFilesImpl:async (_api,_store,ref,files,task,options) => { deployments.push({ref,files,task,options}); return { ok:true,status:'completed' }; },
    deleteOwnedRemoteFileImpl:async (_api,_store,ref,file,task) => { deletions.push({ref,file,task}); return { ok:true,status:'completed',deleted:true }; }
  });

  const topo = await runtime.databaseOp('p1',{ action:'inspect' });
  assert.equal(topo.ftp_mirror,true);
  assert.equal(topo.full_local_wordpress,false);
  assert.equal(topo.db_host_class,'server-local');
  assert.equal(topo.local_wp_cli_reliable,false);
  assert.equal(topo.preferred_path,'guarded_one_shot_server_helper');

  const changed = await runtime.databaseOp('p1',{ action:'mutate',task_id:'task-1',operation:'insert_post',payload:{ post_type:'tai_lieu',post_title:'Sample',idempotency_key:'fixture-1' } });
  assert.equal(changed.ok,true);
  assert.ok(changed.recovery_id);
  assert.equal(changed.transport,'guarded_one_shot_server_helper');
  assert.equal(deployments.length,1,'one-shot helper must deploy once');
  assert.equal(deletions.length,1,'one-shot helper must always get remote cleanup');
  assert.equal(patches.length,2,'helper must be created and removed locally in the same task');
  assert.equal(requests.filter(x=>x.method==='POST').length,1,'mutation path must not retry the same server operation');
  assert.ok(deployments[0].files[0].match(HELPER_RE));
  assert.equal(deployments[0].options?.explicit,true,'explicit database helper deploy must not depend on uploadOnSave');

  const rolled = await runtime.databaseOp('p1',{ action:'rollback',task_id:'task-1',recovery_id:changed.recovery_id });
  assert.equal(rolled.rolled_back,true);
  assert.equal(requests.filter(x=>x.method==='POST').length,2,'rollback is a separate explicit action, not a mutation retry loop');
  await assert.rejects(()=>runtime.databaseOp('p1',{ action:'mutate',task_id:'wrong-task',operation:'update_option',payload:{key:'x',value:'y'} }), error => error?.code === 'PROJECT_SCOPE_VIOLATION');
  fs.rmSync(root,{recursive:true,force:true});
}

async function runPersistentFallbackOnce() {
  const root = tempProject({ persistent:true });
  const project = { id:'p1', name:'example.com', root, workspaceMode:'trusted' };
  const store = { getProject:()=>project };
  let persistentAttempts=0, helperPosts=0, deploys=0;
  const api = {
    workStatus:async id => ({ status:'active', project_id:'p1', work_session_id:id }),
    applyPatch:async()=>({changed_files:[]})
  };
  const fetchImpl = async (url,opts={}) => {
    if (String(url).includes('/wp-json/chatcode/v1/database')) { persistentAttempts++; throw new Error('bridge unavailable'); }
    if ((opts.method||'GET') === 'GET') return { ok:true,status:200,text:async()=>'{"ok":true}' };
    helperPosts++;
    return { ok:true,status:200,text:async()=>JSON.stringify({ ok:true,changed:false,no_op:true }) };
  };
  const runtime = createDatabaseApi(api,store,{
    fetchImpl,
    deployChangedFilesImpl:async()=>{deploys++;return {ok:true,status:'completed'};},
    deleteOwnedRemoteFileImpl:async()=>({ok:true,status:'completed',deleted:true})
  });
  const result = await runtime.databaseOp('p1',{ action:'mutate',task_id:'t1',operation:'update_option',payload:{ key:'fixture_option',value:'x' } });
  assert.equal(result.ok,true);
  assert.equal(persistentAttempts,1,'persistent bridge gets one attempt only');
  assert.equal(helperPosts,1,'fallback helper gets one attempt only');
  assert.equal(deploys,1);
  fs.rmSync(root,{recursive:true,force:true});
}

Promise.resolve().then(runOneShotLifecycle).then(runPersistentFallbackOnce).then(()=>{
  console.log('Database runtime smoke test: PASS (FTP topology + bounded one-shot + cleanup + rollback + no retry loop)');
}).catch(error=>{ console.error(error); process.exitCode=1; });
