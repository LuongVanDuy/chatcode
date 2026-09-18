'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {execFileSync,spawn}=require('child_process');
const {EventEmitter}=require('events');
const {buildDatabaseBootstrap,needsDatabaseBootstrapRefresh}=require('../core/fresh-install-database');
const {buildFreshInstallBootstrap}=require('../core/fresh-install-bootstrap');

async function run() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatcode-db-'));
  let server;
  try {
    const library=path.join(root,'library.php');
    fs.writeFileSync(library,'<?php\n'+buildDatabaseBootstrap());
    const test=String.raw`<?php
require $argv[1];
function check($ok,$label) { if (!$ok) throw new Exception($label); }
$data=array('panelUser'=>'tester','panelPassword'=>'PanelSecret!123','dbName'=>'tester_cc123456','dbUser'=>'tester_cc123456','dbPassword'=>'DatabaseSecret!123');
$data['dbHost']='localhost';
$cases=array(
 array('status'=>500,'body'=>'error=1&text=Unable+to+create+database&details=Maximum+number+of+databases+reached','code'=>'DB_PANEL_LIMIT'),
 array('status'=>500,'body'=>'{"error":1,"text":"Create failed","details":"MySQL internal service failure"}','code'=>'DB_PANEL_REJECTED'),
 array('status'=>401,'body'=>'error=1&text=Login+failed','code'=>'DB_PANEL_AUTH_FAILED'),
 array('status'=>200,'body'=>'error=1&details=Access+denied','code'=>'DB_PANEL_REJECTED'),
 array('status'=>500,'body'=>'<h1>Internal server error</h1>','code'=>'DB_PANEL_REJECTED'),
 array('status'=>500,'body'=>'error=0','code'=>'DB_PANEL_REJECTED'),
 array('status'=>200,'body'=>'error=0&text=Created','code'=>'DB_CONNECT_FAILED'),
 array('status'=>0,'errno'=>28,'error'=>'Operation timed out','code'=>'DB_PANEL_UNAVAILABLE')
);
foreach ($cases as $case) {
 $calls=0;$opens=0;$selected=null;$detail=null;
 $send=function($url,$body) use (&$calls,$case,$data) {
   $calls++;parse_str($body,$sent);
   check($sent['action']==='create' && $sent['name']==='cc123456' && $sent['user']==='cc123456','manifest names');
   check($sent['passwd']===$data['dbPassword'] && $sent['passwd2']===$data['dbPassword'],'manifest password');
   return $case;
 };
 $connect=function($candidate) use (&$opens) { $opens++;return array('db'=>null,'errno'=>1045,'message'=>'Access denied'); };
 check(cc_connect_database($data,$selected,$detail,$connect,$send)===null,'must fail');
 check($calls===1 && $opens===2,'one create + one reconnect, no plaintext replay');
 check($detail['code']===$case['code'],'typed code');
}
$detail=array();$calls=0;
$send=function($url,$body) use (&$calls) { $calls++;return $calls===1 ? array('status'=>0,'errno'=>35,'error'=>'wrong version number') : array('status'=>200,'body'=>'error=0&text=Created'); };
check(cc_directadmin_create_database($data,$detail,$send)===true && $calls===2,'TLS handshake fallback to loopback HTTP');
$connectCount=0;$calls=0;$selected=null;
$connect=function($candidate) use (&$connectCount) { $connectCount++;return array('db'=>$connectCount===2 ? (object)array('connected'=>true) : null,'errno'=>1045,'message'=>'Access denied'); };
$send=function() use (&$calls) { $calls++;return array('status'=>500,'body'=>'error=1&details=lost+reply'); };
check(cc_connect_database($data,$selected,$detail,$connect,$send)!==null && $calls===1,'CREATE committed despite 500');
$calls=0;$connect=function() { return array('db'=>(object)array('connected'=>true)); };
check(cc_connect_database($data,$selected,$detail,$connect,$send)!==null && $calls===0,'existing task database skips CREATE');
foreach (array('error=1&details=PanelSecret%21123+DatabaseSecret%21123','{"error":1,"details":{"a":"PanelSecret!123","b":"DatabaseSecret!123"}}','<p>PanelSecret!123 DatabaseSecret!123</p>') as $body) {
 $result=cc_db_panel_result(array('status'=>500,'body'=>$body),$data);
 check(strpos(json_encode($result),'Secret')===false,'secrets redacted');
}
$result=cc_db_panel_result(array('status'=>500,'body'=>$cases[0]['body']),$data);
check(strpos($result['message'],'Maximum number of databases reached')!==false,'HTTP 500 body retained');
echo 'PASS: PHP DirectAdmin 500/form/JSON/HTML parsing, auth, quota, single CREATE, TLS fallback, reconnect, redaction'.PHP_EOL;
`;
    fs.writeFileSync(path.join(root,'test.php'),test);
    console.log(execFileSync('php',[path.join(root,'test.php'),library],{encoding:'utf8'}).trim());
    for (const [task,expected] of [
      [{checkpoint:'uploaded',error_code:'INSTALL_FAILED',error:'Không tự tạo/kết nối được database. DirectAdmin: HTTP 500'},true],
      [{checkpoint:'uploaded',error_code:'DB_PANEL_LIMIT'},true],
      [{checkpoint:'uploaded',error_code:'BOOTSTRAP_HTTP_FAILED'},false],
      [{checkpoint:'uploaded',error_code:'DB_PANEL_LIMIT',install_request_pending:true},false],
      [{checkpoint:'installed',error_code:'DB_PANEL_LIMIT'},false],
      [{checkpoint:'uploaded',error_code:'INSTALL_FAILED',error:'Unrelated error'},false]
    ]) assert.equal(needsDatabaseBootstrapRefresh(task),expected);
    console.log('PASS: legacy DB-error task refresh is narrowly scoped; uncertain install is untouched');

    // Execute the actual generated PHP entrypoint against deterministic DB/panel
    // doubles, with clearRemote=true. This reproduces the reported 500 and must
    // leave all existing files unchanged. No actual hosting credentials are used.
    await testRuntimeRefresh(root);
    const php=buildFreshInstallBootstrap({token:'test-token',installId:'b'.repeat(32),bridgeName:'bridge.php'});
    fs.writeFileSync(path.join(root,'bridge.php'),php);
    execFileSync('php',['-l',path.join(root,'bridge.php')]);
    const fixture=String.raw`<?php
class mysqli { public $connect_errno=1045; public $connect_error='Access denied'; }
function mysqli_report($value) {}
define('MYSQLI_REPORT_OFF',0);
foreach (array('CURLOPT_POST','CURLOPT_POSTFIELDS','CURLOPT_RETURNTRANSFER','CURLOPT_HTTPAUTH','CURLAUTH_BASIC','CURLOPT_USERPWD','CURLOPT_CONNECTTIMEOUT','CURLOPT_TIMEOUT','CURLOPT_FOLLOWLOCATION','CURLOPT_HTTPHEADER','CURLOPT_SSL_VERIFYPEER','CURLOPT_SSL_VERIFYHOST','CURLINFO_RESPONSE_CODE') as $i=>$name) define($name,$i+1);
function curl_init($url) { return $url; }
function curl_setopt_array($c,$v) {}
function curl_setopt($c,$k,$v) {}
function curl_exec($c) { file_put_contents(__DIR__.'/panel-calls','CREATE\n',FILE_APPEND); return 'error=1&text=Unable+to+create+database&details=Maximum+number+of+databases+reached'; }
function curl_getinfo($c,$v) { return 500; }
function curl_errno($c) { return 0; }
function curl_error($c) { return ''; }
function curl_close($c) {}
`;
    fs.writeFileSync(path.join(root,'fixture.php'),fixture);
    fs.writeFileSync(path.join(root,'wp-config.php'), "<?php define('DB_NAME','tester_existing'); define('DB_USER','tester_existing'); define('DB_PASSWORD','existing-secret'); define('DB_HOST','localhost'); $table_prefix='wp_';");
    const existingConfig=fs.readFileSync(path.join(root,'wp-config.php'),'utf8');
    fs.mkdirSync(path.join(root,'wp-content'));fs.writeFileSync(path.join(root,'wp-content','keep.txt'),'must survive');
    const net=require('net');const portServer=net.createServer();
    await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;
    await new Promise(r=>portServer.close(r));
    server=spawn('php',['-n','-d','extension=tokenizer','-d',`auto_prepend_file=${path.join(root,'fixture.php')}`,'-S',`127.0.0.1:${port}`,'-t',root],{stdio:['ignore','ignore','pipe']});
    let logs='';server.stderr.on('data',b=>logs+=b);
    const url=`http://127.0.0.1:${port}/bridge.php`;
    for(let n=0;;n++) {
      try {await fetch(url);break;} catch(e) {if(n>50)throw new Error(logs||e.message);await new Promise(r=>setTimeout(r,20));}
    }
    const requestOptions={method:'POST',headers:{'content-type':'application/json','x-chatcode-token':'test-token'},body:JSON.stringify({
      action:'install',panelUser:'tester',panelPassword:'fixture-secret',dbName:'tester_cc123456',dbUser:'tester_cc123456',dbPassword:'db-secret',dbHost:'localhost',tablePrefix:'wp_test_',siteTitle:'Fixture',adminUser:'tester',adminEmail:'admin@example.test',adminPassword:'admin-secret',siteUrl:'https://example.test',clearRemote:true
    })};
    const response=await fetch(url,requestOptions);
    const result=await response.json();assert.equal(response.status,409);assert.equal(result.code,'DB_REUSE_CONNECT_FAILED');
    assert.equal(result.mysqlErrno,1045);
    assert.ok(!fs.existsSync(path.join(root,'panel-calls')), 'reuse failure must not create another database');
    assert.equal(fs.readFileSync(path.join(root,'wp-config.php'),'utf8'),existingConfig);
    assert.equal(fs.readFileSync(path.join(root,'wp-content','keep.txt'),'utf8'),'must survive');
    fs.unlinkSync(path.join(root,'wp-config.php'));
    const panelResponse=await fetch(url,requestOptions);const panelResult=await panelResponse.json();
    assert.equal(panelResponse.status,409);assert.equal(panelResult.code,'DB_PANEL_LIMIT');
    assert.match(panelResult.message,/Maximum number of databases reached/);
    assert.equal(panelResult.databaseDetail.mysql.errno,1045);
    assert.equal(fs.readFileSync(path.join(root,'panel-calls'),'utf8'),'CREATE\\n');
    assert.equal(fs.readFileSync(path.join(root,'wp-content','keep.txt'),'utf8'),'must survive');
    console.log('PASS: generated bootstrap preserves old config/content on reuse failure and existing files on fresh panel HTTP 500');
  } finally {
    if(server) { const exit=new Promise(r=>server.once('exit',r));server.kill();await exit; }
    fs.rmSync(root,{recursive:true,force:true});
  }
}
async function testRuntimeRefresh(root) {
  const childProcess=require('child_process');const originalSpawn=childProcess.spawn,originalFetch=globalThis.fetch;
  const uploads=[],requests=[];let finish;
  const completed=new Promise(resolve=>{finish=resolve;});
  childProcess.spawn=(command,args)=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    child.stdin={end(raw){const payload=JSON.parse(raw);uploads.push(payload);queueMicrotask(()=>{
      child.stdout.emit('data',Buffer.from(JSON.stringify({ok:true,files:[{status:'confirmed'}]})+'\n'));child.emit('exit',0);
    });}};
    return child;
  };
  try {
    const {createFreshInstallService}=require('../core/fresh-install-runtime');
    const service=createFreshInstallService({app:{getPath:()=>root},safeStorage:{isEncryptionAvailable:()=>true,
      encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},onChanged:t=>{if(t.status==='failed'||t.status==='completed')finish(t);}});
    const task=service.create({domain:'example.test',username:'tester',password:'original-password',theme:{id:'wordpress-default'}});
    const stateFile=path.join(root,'fresh-install','tasks.json');const state=JSON.parse(fs.readFileSync(stateFile));
    Object.assign(state.tasks[0],{status:'failed',checkpoint:'uploaded',percent:25,
      error_code:'INSTALL_FAILED',error:'Không tự tạo/kết nối được database. DirectAdmin: HTTP 500',
      connection:{host:'example.test',port:21,protocol:'ftps',remotePath:'/public_html'}});
    const expectedDB=JSON.stringify(state.tasks[0].manifest.database);fs.writeFileSync(stateFile,JSON.stringify(state));
    globalThis.fetch=async(url,options)=>{
      const p=JSON.parse(options.body);requests.push(p);
      if(p.action==='probe')return new Response(JSON.stringify({ok:true}));
      assert.equal(p.action,'install');
      return new Response(JSON.stringify({ok:false,code:'DB_PANEL_LIMIT',message:'Maximum number of databases reached'}),{status:409});
    };
    service.retry(task.id);
    let timer;const outcome=await Promise.race([completed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('runtime test timeout')),1000);})]).finally(()=>clearTimeout(timer));
    assert.equal(outcome.error_code,'DB_PANEL_LIMIT',outcome.error);
    assert.equal(uploads.length,1);assert.equal(uploads[0].files.length,1);
    assert.equal(uploads[0].files[0].remoteName,task.bootstrap.name);
    assert.match(fs.readFileSync(uploads[0].files[0].localPath,'utf8'),/cc_db_panel_result/);
    assert.deepEqual(requests.map(p=>p.action),['probe','install']);
    assert.equal(JSON.stringify(outcome.manifest.database),expectedDB);
    console.log('PASS: actual service.retry refreshes only legacy DB bootstrap, preserves database identity, no ZIP resend');
  } finally {childProcess.spawn=originalSpawn;globalThis.fetch=originalFetch;delete require.cache[require.resolve('../core/fresh-install-runtime')];}
}
module.exports={run};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
