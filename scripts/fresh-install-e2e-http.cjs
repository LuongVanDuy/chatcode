'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const http=require('http');
const { httpJson, requiresReconciliation, reconcileInstall, installWithReconciliation }=require('../core/fresh-install-http');
const token='fixture-token-0123456789';
const verifyPayload={ theme:{ active_theme:'bricks-child' }, plugin:{ entry:'duyanhwebpro/duyanhwebpro.php' } };
const verified={ ok:true, wordpressVersion:'fixture-version', activeTheme:'bricks-child', pluginActive:true, siteUrl:'https://example.test' };
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fixture(mode, run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-http-'));
  const committed=path.join(root,'installed.json');
  const calls=[]; const timers=[];
  const server=http.createServer(async (req,res)=>{
    if (req.headers['x-chatcode-token']!==token) { res.writeHead(403); res.end('{"ok":false,"code":"TOKEN_INVALID"}'); return; }
    let raw=''; for await (const chunk of req) raw+=chunk;
    const payload=JSON.parse(raw); calls.push(payload.action);
    const answer=(status,body)=>{ res.writeHead(status,{'content-type':'application/json'}); res.end(JSON.stringify(body)); };
    if (payload.action==='verify') {
      if (!fs.existsSync(committed)) return answer(409,{ok:false,code:'VERIFY_INSTALL_MARKER_FAILED'});
      return answer(200,JSON.parse(fs.readFileSync(committed)));
    }
    if (payload.action!=='install') return answer(400,{ok:false,code:'ACTION_UNSUPPORTED'});
    if (mode==='business-error') return answer(502,{ok:false,code:'CORE_DOWNLOAD_FAILED',message:'Fixture download failure'});
    if (mode==='definite-error') return answer(500,{ok:false,code:'INSTALL_FAILED',message:'Fixture DB error'});
    if (mode==='delayed') timers.push(setTimeout(()=>fs.writeFileSync(committed,JSON.stringify(verified)),40));
    else if (mode!=='never') fs.writeFileSync(committed,JSON.stringify(verified));
    if (mode==='gateway') { res.writeHead(504,{'content-type':'text/html'}); res.end('<h1>Gateway timeout</h1>'); }
    else if (mode==='partial-body') {
      res.writeHead(200,{'content-type':'application/json','content-length':'100'}); res.write('{"ok":');
      timers.push(setTimeout(()=>res.destroy(),10));
    } else if (mode==='success') answer(200,{ok:true,wordpressVersion:'fixture-version'});
    else res.destroy();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/bootstrap.php`;
  try { await run({ request:(payload,timeout)=>httpJson(url,token,payload,timeout), calls, committed }); }
  finally {
    timers.forEach(clearTimeout); server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve)); fs.rmSync(root,{recursive:true,force:true});
  }
}

async function runHttpTests() {
  for (const mode of ['drop','delayed','gateway','partial-body']) {
    await fixture(mode,async ({request,calls})=>{
      const result=await installWithReconciliation({ request, installPayload:{action:'install'}, verifyPayload,
        siteUrl:'https://example.test', intervalMs:10, attempts:20, budgetMs:2000 });
      assert.equal(result.recoveredAfterDisconnect,true,mode);
      assert.equal(calls.filter(action=>action==='install').length,1,`${mode}: MUST NOT replay install`);
      assert.ok(calls.includes('verify'));
      assert.ok(!calls.includes('cleanup'));
    });
    console.log(`PASS HTTP ${mode}: recover committed result without reinstall`);
  }
  await fixture('never',async ({request,calls})=>{
    await assert.rejects(installWithReconciliation({request,installPayload:{action:'install'},verifyPayload,
      siteUrl:'https://example.test',attempts:3,intervalMs:1,budgetMs:1000}),error=>error.code==='INSTALL_RESULT_UNCONFIRMED');
    assert.deepEqual(calls,['install','verify','verify','verify']);
  });
  console.log('PASS unknown outcome remains unconfirmed, not successful and not reinstalled');
  for (const mode of ['business-error','definite-error']) {
    await fixture(mode,async ({request,calls})=>{
      await assert.rejects(installWithReconciliation({request,installPayload:{action:'install'},verifyPayload}),
        error=>error.code===(mode==='business-error'?'CORE_DOWNLOAD_FAILED':'INSTALL_FAILED'));
      assert.deepEqual(calls,['install']);
    });
  }
  console.log('PASS explicit server download/DB errors remain errors and preserve fallback routing');
  for (const wrong of [{...verified,pluginActive:false},{...verified,activeTheme:'wrong'},{...verified,siteUrl:'https://another.test'},{ok:true}]) {
    await assert.rejects(reconcileInstall({request:async()=>wrong,verifyPayload,siteUrl:'https://example.test'}),
      error=>/^VERIFY_/.test(error.code));
  }
  console.log('PASS wrong theme, plugin, site and incomplete evidence cannot pass reconciliation');
  const secret='Secret-not-for-logs';
  await assert.rejects(httpJson('https://example.test/bridge.php',token,{action:'install',panelPassword:secret},100,
    async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error(`socket closed ${secret} ${token}`),{code:'ECONNRESET'})});}),
    error=>error.detail.causes[1].code==='ECONNRESET' && !JSON.stringify(error.detail).includes(secret) && !JSON.stringify(error.detail).includes(token));
  assert.equal(requiresReconciliation({checkpoint:'uploaded',error_code:'BOOTSTRAP_HTTP_FAILED'}),true);
  assert.equal(requiresReconciliation({checkpoint:'uploaded',install_request_pending:true}),true);
  assert.equal(requiresReconciliation({checkpoint:'uploaded',install_request_pending:false,error_code:'TASK_INTERRUPTED'}),false);
  assert.equal(requiresReconciliation({checkpoint:'uploaded',error_code:'TASK_INTERRUPTED'}),true);
  assert.equal(requiresReconciliation({checkpoint:'discovered',error_code:'BOOTSTRAP_HTTP_FAILED'}),false);
  assert.equal(requiresReconciliation({checkpoint:'uploaded',error_code:'PLUGIN_DOWNLOAD_FAILED'}),false);
  console.log('PASS cause diagnostics, secret redaction and v1.0.62 interrupted-task migration');
}

async function runRuntimeTests() {
  const { createFreshInstallService }=require('../core/fresh-install-runtime');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-http-runtime-'));
  const savedFetch=globalThis.fetch;
  let completed;
  const finished=new Promise(resolve=>{completed=resolve;});
  try {
    const service=createFreshInstallService({
      app:{getPath:()=>root},
      safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},
      onChanged:task=>{ if (task.status==='completed'||task.status==='failed') completed(task); }
    });
    const task=service.create({domain:'example.test',username:'tester',password:'fixture-password',theme:{id:'wordpress-default'}});
    const file=path.join(root,'fresh-install','tasks.json');
    const state=JSON.parse(fs.readFileSync(file));
    Object.assign(state.tasks[0],{status:'failed',checkpoint:'uploaded',percent:25,attempt_count:1,
      error_code:'BOOTSTRAP_HTTP_FAILED',error:'fetch failed',remote_policy:{clear_remote:true},
      connection:{host:'example.test',port:21,protocol:'ftps',remotePath:'/public_html'}});
    delete state.tasks[0].install_request_pending;
    fs.writeFileSync(file,JSON.stringify(state));
    const calls=[];
    globalThis.fetch=async (url,options={})=>{
      const payload=options.body?JSON.parse(options.body):{};
      calls.push(payload.action || 'public-get');
      assert.notEqual(payload.action,'install','Retry must not reinstall the already-published site');
      if (payload.action==='verify') return new Response(JSON.stringify(verified));
      if (payload.action==='cleanup') return new Response('{"ok":true,"markerRemoved":true}');
      assert.equal(options.method,'GET'); return new Response('public-page');
    };
    service.retry(task.id);
    const outcome=await Promise.race([finished,delay(1500).then(()=>{throw new Error('Runtime recovery did not finish');})]);
    assert.equal(outcome.status,'completed',outcome.error);
    assert.equal(outcome.checkpoint,'completed'); assert.equal(outcome.percent,100);
    assert.equal(outcome.attempt_count,2);
    assert.ok(outcome.result.install.recoveredAfterDisconnect);
    assert.equal(outcome.install_request_pending,false);
    assert.deepEqual(calls,['verify','verify','public-get','public-get','cleanup']);
    console.log('PASS actual service.retry: v1.0.62 uploaded/HTTP-failed task reaches SITE_READY, zero install/FTP upload requests');
  } finally { globalThis.fetch=savedFetch; fs.rmSync(root,{recursive:true,force:true}); }
}
async function run() { await runHttpTests(); await runRuntimeTests(); }
module.exports={run,runHttpTests,runRuntimeTests};
if (require.main===module) run().catch(error=>{console.error(error);process.exitCode=1;});
