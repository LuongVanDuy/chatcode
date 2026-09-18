'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const net=require('net');
const vm=require('vm');
const {createRequire}=require('module');
const {EventEmitter}=require('events');
const {spawn,execFileSync}=require('child_process');
const {buildFreshInstallBootstrap}=require('../core/fresh-install-bootstrap');
const {createFreshInstallService}=require('../core/fresh-install-runtime');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('enc:'+s).map(b=>b^93),decryptString:b=>Buffer.from(b).map(v=>v^93).toString().slice(4)};
const appAt=root=>({getPath:()=>root});
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode)return;const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}

async function runCommon(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-finalize-'));
  try{
    const app=appAt(root),service=createFreshInstallService({app,safeStorage});
    const passwords=[`FTP!a+b&c%5\\d"e'f`, 'MậtKhẩu-FTP-2026!'];
    for(let n=0;n<passwords.length;n++){
      const task=service.create({domain:`fresh${n}.example.test`,username:'tester',password:passwords[n],theme:{id:'wordpress-default'}});
      const credentials=service.credentials(task.id);
      assert.equal(credentials.username,'duyanhweb');assert.equal(credentials.password,passwords[n]);
      const {createFreshInstallVault}=require('../core/fresh-install-vault');
      const secret=createFreshInstallVault(app,safeStorage).get(task.id);
      assert.equal(secret.adminPassword,secret.hostingPassword);
      assert.notEqual(secret.databasePassword,secret.hostingPassword);
      for(const file of ['fresh-install/tasks.json','fresh-install-secrets.json'])assert.ok(!fs.readFileSync(path.join(root,file),'utf8').includes(passwords[n]));
    }
    // Existing tasks/credentials are not migrated to the new defaults.
    const statePath=path.join(root,'fresh-install/tasks.json'),state=JSON.parse(fs.readFileSync(statePath));
    state.tasks[0].manifest.admin.username='chatcode';state.tasks[0].status='completed';
    fs.writeFileSync(statePath,JSON.stringify(state));
    const {createFreshInstallVault}=require('../core/fresh-install-vault');
    const vault=createFreshInstallVault(app,safeStorage),secrets=vault.get(state.tasks[0].id);
    vault.set(state.tasks[0].id,{...secrets,adminPassword:'Legacy-admin-secret-not-FTP'});
    const reopened=createFreshInstallService({app,safeStorage});
    assert.equal(reopened.credentials(state.tasks[0].id).username,'chatcode');
    assert.equal(reopened.credentials(state.tasks[0].id).password,'Legacy-admin-secret-not-FTP');
    console.log('PASS new admin is duyanhweb / exact FTP password; vault not plaintext; existing credentials unchanged');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
  for(const mode of ['http','legacy','lost-reply','ftp-failure'])await testCleanupRuntime(mode);
}
async function testCleanupRuntime(mode){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-cleanup-runtime-'));
  const originalFetch=globalThis.fetch,requests=[],ftp=[];
  let done;const finished=new Promise(r=>{done=r;});
  try{
    const file=path.resolve(__dirname,'../core/fresh-install-runtime.js');const realRequire=createRequire(file);
    const module={exports:{}};
    const fakeSpawn=()=>{
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
      child.stdin={end(raw){ftp.push(JSON.parse(raw));queueMicrotask(()=>{
        child.stdout.emit('data',Buffer.from(JSON.stringify(mode==='ftp-failure'?{ok:false,error:'Fixture permission denied'}:{ok:true})+'\n'));
        child.emit('exit',mode==='ftp-failure'?1:0);
      });}};return child;
    };
    vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,__dirname:path.dirname(file),process,Buffer,console,setTimeout,clearTimeout,AbortSignal,
      fetch:(...args)=>globalThis.fetch(...args),require:name=>name==='child_process'?{spawn:fakeSpawn}:realRequire(name)},{filename:file});
    const service=module.exports.createFreshInstallService({app:appAt(root),safeStorage,onChanged:t=>{if(t.status==='completed'||t.status==='failed')done(t);}});
    const task=service.create({domain:'cleanup.example.test',username:'tester',password:'FTP!fixture',theme:{id:'wordpress-default'}});
    const stateFile=path.join(root,'fresh-install/tasks.json'),state=JSON.parse(fs.readFileSync(stateFile));
    Object.assign(state.tasks[0],{checkpoint:'verified',status:'failed',connection:{host:'example.test',port:21,protocol:'ftps',remotePath:'/public_html'}});
    fs.writeFileSync(stateFile,JSON.stringify(state));
    globalThis.fetch=async(url,options)=>{
      const payload=JSON.parse(options.body);requests.push(payload.action);assert.equal(payload.action,'cleanup');
      if(mode==='lost-reply'||mode==='ftp-failure')throw new Error('Fixture socket disconnected');
      return new Response(JSON.stringify(mode==='legacy'?{ok:true}:{ok:true,markerRemoved:true}));
    };
    service.retry(task.id);
    let timer;const outcome=await Promise.race([finished,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cleanup test timeout')),1500);})]).finally(()=>clearTimeout(timer));
    assert.deepEqual(requests,['cleanup']);
    if(mode==='http')assert.equal(ftp.length,0);
    else{assert.equal(ftp.length,1);assert.equal(ftp[0].action,'delete');assert.ok(ftp[0].files.includes('.chatcode-install-id'));assert.equal(ftp[0].expectedInstallId,task.manifest.install_id);}
    assert.equal(outcome.status,mode==='ftp-failure'?'failed':'completed');
    if(mode==='ftp-failure'){assert.equal(outcome.checkpoint,'verified');assert.equal(outcome.error_code,'CLEANUP_FAILED');}
    console.log(`PASS cleanup ${mode}: no install replay; no silent completion on delete failure`);
  }finally{globalThis.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true});}
}

async function runPhp(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-php-cleanup-'));let server;
  try{
    const bridge=path.join(root,'bridge.php'),marker=path.join(root,'.chatcode-install-id'),id='b'.repeat(32);
    const php=buildFreshInstallBootstrap({token:'fixture-token',installId:id,bridgeName:'bridge.php'});
    const write=()=>fs.writeFileSync(bridge,php);write();execFileSync('php',['-l',bridge]);
    fs.mkdirSync(path.join(root,'wp-includes'));fs.writeFileSync(path.join(root,'wp-includes/version.php'),'<?php');
    fs.mkdirSync(path.join(root,'wp-admin/includes'),{recursive:true});
    fs.writeFileSync(path.join(root,'wp-admin/includes/plugin.php'),"<?php function is_plugin_active($entry){return true;}");
    fs.writeFileSync(path.join(root,'wp-load.php'),"<?php define('ABSPATH',__DIR__.'/'); $GLOBALS['wp_version']='fixture'; function get_option($name){return $name==='stylesheet'?'bricks-child':'https://example.test';}");
    const keep=path.join(root,'keep.txt');fs.writeFileSync(keep,'site data must survive');fs.writeFileSync(marker,id);
    const port=await freePort();server=spawn('php',['-S',`127.0.0.1:${port}`,'-t',root],{stdio:'ignore'});
    const url=`http://127.0.0.1:${port}/bridge.php`;for(let i=0;;i++){try{await fetch(url);break;}catch(e){if(i>50)throw e;await delay(20);}}
    const call=async action=>{const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-chatcode-token':'fixture-token'},body:JSON.stringify({action,theme:{active_theme:'bricks-child'},plugin:{entry:'duyanhwebpro/duyanhwebpro.php'}})});return res.json();};
    assert.equal((await call('verify')).ok,true);assert.ok(fs.existsSync(marker),'verify retains marker');
    const clean=await call('cleanup');assert.equal(clean.markerRemoved,true);assert.ok(!fs.existsSync(marker));assert.ok(!fs.existsSync(bridge));assert.equal(fs.readFileSync(keep,'utf8'),'site data must survive');
    write();assert.equal((await call('cleanup')).ok,true,'already absent marker is safe');
    write();fs.writeFileSync(marker,'c'.repeat(32));assert.equal((await call('cleanup')).code,'CLEANUP_MARKER_MISMATCH');assert.ok(fs.existsSync(bridge));assert.equal(fs.readFileSync(marker,'utf8'),'c'.repeat(32));
    console.log('PASS actual generated PHP: verify retains marker, cleanup removes it, repeated cleanup safe, foreign marker untouched');
  }finally{await stop(server);fs.rmSync(root,{recursive:true,force:true});}
}

async function runFtp(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-marker-ftp-'));let server;
  try{
    const site=path.join(root,'public_html');fs.mkdirSync(site);const marker=path.join(site,'.chatcode-install-id'),id='b'.repeat(32);
    const port=await freePort();server=spawn('python',['-m','pyftpdlib','-i','127.0.0.1','-p',String(port),'-w','-d',root,'-u','tester','-P','fixture'],{stdio:'ignore'});
    for(let i=0;;i++){try{await new Promise((resolve,reject)=>{const s=net.connect(port,'127.0.0.1',()=>{s.destroy();resolve();});s.once('error',reject);});break;}catch(e){if(i>80)throw e;await delay(50);}}
    const payload={action:'delete',host:'127.0.0.1',port,username:'tester',password:'fixture',protocol:'ftp',remotePath:'/public_html',files:['.chatcode-install-id'],expectedInstallId:id};
    const run=p=>{try{return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../tools/fresh-install.ps1')],{input:JSON.stringify(p),encoding:'utf8'}).trim());}catch(e){return JSON.parse(e.stdout.trim());}};
    fs.writeFileSync(marker,id);assert.equal(run(payload).ok,true);assert.ok(!fs.existsSync(marker));assert.equal(run(payload).ok,true);
    fs.writeFileSync(marker,'c'.repeat(32));assert.equal(run(payload).ok,false);assert.equal(fs.readFileSync(marker,'utf8'),'c'.repeat(32));
    assert.equal(run({...payload,expectedInstallId:''}).ok,false);
    console.log('PASS real Windows FTP marker cleanup: matched, absent, foreign and missing identity');
  }finally{await stop(server);fs.rmSync(root,{recursive:true,force:true});}
}

async function runLive(site){
  const {createFreshInstallVault}=require('../core/fresh-install-vault');
  const {httpJson}=require('../core/fresh-install-http');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-live-finalize-'));let server;
  try{
    const app=appAt(root),service=createFreshInstallService({app,safeStorage});
    const ftpPassword=process.env.PANEL_PASSWORD || 'FTP!a+b&c%5\\d"e\'f';
    const task=service.create({domain:'example.test',username:'tester',password:ftpPassword,theme:{id:'wordpress-default'}});
    const secrets=createFreshInstallVault(app,safeStorage).get(task.id),port=await freePort(),siteUrl=`http://127.0.0.1:${port}`;
    const meta=JSON.parse(fs.readFileSync(path.join(site,'fixture-meta.json')));
    fs.writeFileSync(path.join(site,task.bootstrap.name),buildFreshInstallBootstrap({token:secrets.bootstrapToken,installId:task.manifest.install_id,bridgeName:task.bootstrap.name}));
    server=spawn('php',['-S',`127.0.0.1:${port}`,'-t',site],{stdio:'ignore'});
    const url=`${siteUrl}/${task.bootstrap.name}`;for(let i=0;;i++){try{await fetch(url);break;}catch(e){if(i>50)throw e;await delay(20);}}
    const plugin={entry:'duyanhwebpro/duyanhwebpro.php',fallback_version:'1.9.4',manifest_url:'',fallback_package:'.chatcode-plugin-e2e.zip',fallback_sha256:meta.plugin_sha256};
    const payload={action:'install',panelUser:'tester',panelPassword:ftpPassword,dbName:task.manifest.database.name,dbUser:task.manifest.database.user,dbPassword:secrets.databasePassword,dbHost:'127.0.0.1',tablePrefix:task.manifest.database.table_prefix,siteTitle:'Default credentials E2E',adminUser:task.manifest.admin.username,adminPassword:secrets.adminPassword,adminEmail:'admin@example.test',siteUrl,clearRemote:true,theme:{id:'wordpress-default'},plugin};
    const install=await httpJson(url,secrets.bootstrapToken,payload,420000);assert.equal(install.ok,true);
    await httpJson(url,secrets.bootstrapToken,{action:'verify',plugin},90000);
    assert.equal(fs.readFileSync(path.join(site,'.chatcode-install-id'),'utf8'),task.manifest.install_id);
    const probeCode = "$u=null; require $argv[1]; $u=get_user_by('login','duyanhweb'); $p=getenv('CC_TEST_PASSWORD'); echo json_encode(array('userExists'=>(bool)$u,'canManage'=>$u ? user_can($u,'manage_options') : false,'exactPassword'=>$u ? wp_check_password($p,$u->user_pass,$u->ID) : false,'unslashedPassword'=>$u ? wp_check_password(stripslashes($p),$u->user_pass,$u->ID) : false));";
    const authState=JSON.parse(execFileSync('php',['-r',probeCode,path.join(site,'wp-load.php')],{encoding:'utf8',env:{...process.env,CC_TEST_PASSWORD:ftpPassword}}));
    console.log('WordPress account verification:',JSON.stringify(authState));
    assert.equal(authState.userExists,true);assert.equal(authState.canManage,true);assert.equal(authState.exactPassword,true,'stored password must match FTP exactly');
    const loginPage=await fetch(`${siteUrl}/wp-login.php`,{redirect:'manual'});
    const cookie=loginPage.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    await loginPage.text();
    const login=await fetch(`${siteUrl}/wp-login.php`,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams({log:'duyanhweb',pwd:ftpPassword,'wp-submit':'Log In',redirect_to:`${siteUrl}/wp-admin/`,testcookie:'1'})});
    if(login.status!==302){
      const html=await login.text();
      const messages=[...html.matchAll(/<div[^>]*id=["'](?:login_error|login-message)["'][^>]*>([\s\S]*?)<\/div>/g)].map(m=>m[1].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').split(ftpPassword).join('[redacted]').slice(0,400));
      throw new Error('WP login failed: '+JSON.stringify({status:login.status,messages,location:login.headers.get('location'),cookieNames:cookie.split('; ').map(v=>v.split('=')[0])}));
    }
    assert.match(login.headers.get('set-cookie') || '',/wordpress_logged_in_/);
    const cleaned=await httpJson(url,secrets.bootstrapToken,{action:'cleanup',plugin},60000);assert.equal(cleaned.markerRemoved,true);
    assert.ok(!fs.existsSync(path.join(site,'.chatcode-install-id')));assert.ok(!fs.existsSync(path.join(site,task.bootstrap.name)));assert.ok(fs.existsSync(path.join(site,'wp-config.php')));
    console.log('PASS real WordPress/MariaDB install + duyanhweb login with FTP special-character password + marker removed after verify');
  }finally{await stop(server);fs.rmSync(root,{recursive:true,force:true});}
}
module.exports={runCommon,runPhp,runFtp,runLive};
if(require.main===module)(async()=>{await runCommon();if(process.argv.includes('--php'))await runPhp();if(process.argv.includes('--ftp'))await runFtp();const n=process.argv.indexOf('--live');if(n>=0)await runLive(process.argv[n+1]);})().catch(e=>{console.error(e);process.exitCode=1;});
