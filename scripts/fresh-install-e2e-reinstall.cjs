'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const {spawn, execFileSync} = require('child_process');
const {buildReinstallBootstrap} = require('../core/fresh-install-reinstall');
const {buildFreshInstallBootstrap} = require('../core/fresh-install-bootstrap');
const {httpJson, installWithReconciliation} = require('../core/fresh-install-http');
const delay = ms => new Promise(r => setTimeout(r, ms));
const safeStorage = {isEncryptionAvailable:()=>true, encryptString:s=>Buffer.from(s), decryptString:b=>b.toString()};
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function stop(p) {if (!p || p.exitCode !== null || p.signalCode) return; const ended = new Promise(r=>p.once('exit',r)); p.kill(); await ended;}
async function port() {const s=net.createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p;}

function runUnit() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cc-reinstall-unit-'));
  try {
    const library=path.join(root,'library.php'); fs.writeFileSync(library,'<?php\n'+buildReinstallBootstrap());
    const test=String.raw`<?php
require $argv[1];
define('CC_INSTALL_ID',str_repeat('b',32));
function cc_transfer_root() {return __DIR__.'/private';}
function cc_fail($m,$s=500,$c='',$e=array()) {throw new Exception($c);}
function cc_prepare_remote_root($d) {throw new Exception('Unexpected wipe');}
function check($b,$m) {if (!$b) throw new Exception($m);}
$secret="s'quote\\slash+percent%5&double\"";
foreach (array("'",'"') as $quote) {
  $encode=function($s) use($quote) {return $quote==='"' ? '"'.addcslashes($s,"\\\"$").'"' : "'".str_replace(array('\\',"'"),array('\\\\',"\\'"),$s)."'";};
  $source="<?php\n";
  foreach (array('DB_NAME'=>'tester_one','DB_USER'=>'tester_one','DB_PASSWORD'=>$secret,'DB_HOST'=>'localhost') as $k=>$v) $source.='define('.$encode($k).','.$encode($v).");\n";
  $source.='$table_prefix = '.$encode('wp_').';';
  file_put_contents(__DIR__.'/config.php',$source);
  $c=cc_reinstall_config(__DIR__.'/config.php');
  check($c['password']===$secret && $c['name']==='tester_one' && $c['prefix']==='wp_','static literal roundtrip');
}
file_put_contents(__DIR__.'/config.php',"<?php define('DB_NAME',getenv('DB_NAME')); ");
try {cc_reinstall_config(__DIR__.'/config.php');throw new Exception('dynamic config accepted');} catch(Exception $e) {check($e->getMessage()==='REINSTALL_CONFIG_UNSUPPORTED','dynamic fail');}
check(cc_reinstall_publish(array())===false,'no-plan resume must not publish/wipe');
class Rows {public $rows; function __construct($r){$this->rows=$r;} function fetch_row(){return array_shift($this->rows);}}
class FakeDB {
  public $queries=array();
  function query($q) {
    $this->queries[]=$q;
    if ($q==='SHOW FULL TABLES') return new Rows(array(array('wp_options','BASE TABLE'),array('wp_posts','BASE TABLE'),array('wp_plugin_data','BASE TABLE'),array('wp_neighbor_options','BASE TABLE'),array('wp_neighbor_posts','BASE TABLE'),array('outside_keep','BASE TABLE')));
    if (strpos($q,'FROM '.chr(96).'wp_options')!==false) return new Rows(array(array('https://example.test')));
    if (strpos($q,'FROM '.chr(96).'wp_neighbor_options')!==false) return new Rows(array(array('https://neighbor.test')));
    return true;
  }
}
$db=new FakeDB();$c=array('name'=>'tester_one','user'=>'tester_one','password'=>$secret,'host'=>'localhost','prefix'=>'wp_');
$tables=cc_reinstall_tables($db,$c,array('siteUrl'=>'https://example.test/','tablePrefix'=>'wp_new_'));
check(array_column($tables,'name')===array('wp_options','wp_posts','wp_plugin_data'),'snapshot must exclude nested foreign prefix');
cc_reinstall_save_plan(array('install_id'=>CC_INSTALL_ID,'candidate'=>$c,'new_prefix'=>'wp_new_','state'=>'preparing','tables'=>$tables));
cc_reinstall_retire_tables($db);cc_reinstall_retire_tables($db);
foreach($db->queries as $q) if(strpos($q,'DROP ')===0) {check(strpos($q,'wp_new_')===false && strpos($q,'neighbor')===false && strpos($q,'outside_keep')===false,'scoped exact table drop');}
check(substr(file_get_contents(cc_reinstall_plan_file()),0,strlen("<?php exit; ?>\n"))==="<?php exit; ?>\n",'recovery file must not expose credentials as JSON');
echo "PASS static config literals, dynamic-config stop, private plan, exact old-table snapshot, foreign-prefix preservation, idempotent retirement\n";
`;
    fs.writeFileSync(path.join(root,'unit.php'),test);
    console.log(execFileSync('php',[path.join(root,'unit.php'),library],{encoding:'utf8'}).trim());
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}

async function runLive(site, coreZip) {
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'cc-one-db-'));
  const {createFreshInstallService}=require('../core/fresh-install-runtime');
  const {createFreshInstallVault}=require('../core/fresh-install-vault');
  const app={getPath:()=>work},service=createFreshInstallService({app,safeStorage});
  const ftpPassword=process.env.PANEL_PASSWORD || 'Fixture!password';
  const meta=JSON.parse(fs.readFileSync(path.join(site,'fixture-meta.json')));
  const pluginBytes=fs.readFileSync(path.join(site,'.chatcode-plugin-e2e.zip'));
  const sitePort=await port(),siteUrl=`http://127.0.0.1:${sitePort}`;
  let server,proxy;
  const audit=()=>fs.existsSync(process.env.PANEL_AUDIT_FILE||'')?fs.readFileSync(process.env.PANEL_AUDIT_FILE,'utf8').trim().split('\n').filter(Boolean):[];
  const php=(code,...args)=>execFileSync('php',['-r',code,...args],{encoding:'utf8',env:{...process.env,CC_WP_PASSWORD:ftpPassword}}).trim();
  const info=()=>JSON.parse(php("require $argv[1]; global $table_prefix; echo json_encode(array('name'=>DB_NAME,'user'=>DB_USER,'prefix'=>$table_prefix));",path.join(site,'wp-load.php')));
  const sql=(query)=>php("require $argv[1]; global $wpdb; $r=$wpdb->query($argv[2]); if ($r===false) {fwrite(STDERR,$wpdb->last_error);exit(1);} echo $r;",path.join(site,'wp-load.php'),query);
  const value=(query)=>php("require $argv[1]; global $wpdb; echo $wpdb->get_var($argv[2]);",path.join(site,'wp-load.php'),query);
  function fixture(prefix, first=false) {
    const task=service.create({domain:'example.test',username:'tester',password:ftpPassword,clearRemote:true,theme:{id:'wordpress-default'}});
    const secrets=createFreshInstallVault(app,safeStorage).get(task.id);
    const plugin={entry:'duyanhwebpro/duyanhwebpro.php',fallback_version:'1.9.4',manifest_url:'',fallback_package:'.chatcode-plugin-e2e.zip',fallback_sha256:meta.plugin_sha256};
    fs.writeFileSync(path.join(site,'.chatcode-plugin-e2e.zip'),pluginBytes);
    const remoteCore='.chatcode-wordpress-reinstall.zip'; fs.copyFileSync(coreZip,path.join(site,remoteCore));
    const bridge=path.join(site,task.bootstrap.name);
    fs.writeFileSync(bridge,buildFreshInstallBootstrap({token:secrets.bootstrapToken,installId:task.manifest.install_id,bridgeName:task.bootstrap.name}));
    const payload={action:'install',panelUser:'tester',panelPassword:ftpPassword,
      dbName:first?'tester_one':task.manifest.database.name,dbUser:first?'tester_one':task.manifest.database.user,
      dbPassword:first?'Fixture-Database!':secrets.databasePassword,dbHost:'127.0.0.1',tablePrefix:prefix,
      adminUser:first?'legacyadmin':task.manifest.admin.username,adminPassword:secrets.adminPassword,
      adminEmail:'admin@example.test',siteTitle:'Single database reinstall',siteUrl,clearRemote:true,
      corePackage:remoteCore,theme:{id:'wordpress-default'},plugin};
    return {task,secrets,payload,bridge,url:`${siteUrl}/${task.bootstrap.name}`,request:(p,t)=>httpJson(`${siteUrl}/${task.bootstrap.name}`,secrets.bootstrapToken,p,t)};
  }
  async function verifyAndCleanup(f) {
    await f.request({action:'verify',plugin:f.payload.plugin},30000);
    assert.equal(fs.readFileSync(path.join(site,'.chatcode-install-id'),'utf8'),f.task.manifest.install_id);
    const cleaned=await f.request({action:'cleanup',plugin:f.payload.plugin,corePackage:f.payload.corePackage},30000);
    assert.equal(cleaned.markerRemoved,true);
    assert.ok(!fs.existsSync(path.join(site,'.chatcode-install-id')));
    assert.ok(!fs.existsSync(path.join(site,'.chatcode-upload-'+f.task.manifest.install_id.slice(0,12))));
    assert.ok(!fs.existsSync(f.bridge));
  }
  async function login() {
    const page=await fetch(siteUrl+'/wp-login.php'); const cookies=page.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '); await page.text();
    const res=await fetch(siteUrl+'/wp-login.php',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',cookie:cookies},body:new URLSearchParams({log:'duyanhweb',pwd:ftpPassword,'wp-submit':'Log In',testcookie:'1',redirect_to:siteUrl+'/wp-admin/'})});
    assert.equal(res.status,302,'real wp-login must accept the provided FTP password');
    const session=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    assert.match(session,/wordpress_logged_in_/);
    const admin=await fetch(siteUrl+'/wp-admin/',{redirect:'manual',headers:{cookie:session}});
    assert.equal(admin.status,200,'authenticated wp-admin must load');
    await admin.text();
  }
  try {
    server=spawn('php',['-S',`127.0.0.1:${sitePort}`,'-t',site],{stdio:'ignore'});
    for(let n=0;;n++){try{await fetch(siteUrl);break;}catch(e){if(n>70)throw e;await delay(25);}}
    const first=fixture('wp_',true);const firstResult=await first.request(first.payload,120000);
    assert.equal(firstResult.database.name,'tester_one');assert.equal(firstResult.databaseMode,'created');
    await verifyAndCleanup(first); assert.equal(audit().length,1,'exactly one initial CREATE');
    const original=info();
    sql("CREATE TABLE wp_plugin_data (id INT PRIMARY KEY, value VARCHAR(50));");sql("INSERT INTO wp_plugin_data VALUES(1,'old-site-data')");
    sql("CREATE TABLE outside_keep (id INT PRIMARY KEY, value VARCHAR(50))");sql("INSERT INTO outside_keep VALUES(1,'untouched')");
    sql("CREATE TABLE wp_neighbor_options (option_name VARCHAR(64),option_value TEXT)");sql("INSERT INTO wp_neighbor_options VALUES('siteurl','https://neighbor.test')");
    sql("CREATE TABLE wp_neighbor_posts (id INT)");sql("INSERT INTO wp_neighbor_posts VALUES(99)");
    const before=sha(path.join(site,'wp-config.php'));
    const second=fixture('wp_replaced_');
    await assert.rejects(second.request({...second.payload,clearRemote:false},30000),e=>e.code==='SITE_NOT_EMPTY');
    assert.equal(sha(path.join(site,'wp-config.php')),before);
    // Fail before new WordPress is ready: the old config/tables must still work.
    await assert.rejects(second.request({...second.payload,plugin:{...second.payload.plugin,fallback_package:''}},120000),e=>e.code==='PLUGIN_DOWNLOAD_FAILED');
    assert.equal(sha(path.join(site,'wp-config.php')),before);
    assert.equal(value('SELECT value FROM wp_plugin_data WHERE id=1'),'old-site-data');
    assert.equal(audit().length,1,'failed replacement must not ask panel for another DB');
    console.log('PASS real one-DB host: initial install, explicit overwrite consent, plugin failure leaves old site intact');
    // Throw away the successful HTTP reply after the PHP operation really commits.
    let installPosts=0;
    proxy=http.createServer(async(req,res)=>{
      try {let body='';for await(const chunk of req)body+=chunk;const p=JSON.parse(body);
        const answer=await fetch(second.url,{method:'POST',headers:{'content-type':'application/json','x-chatcode-token':second.secrets.bootstrapToken},body});const text=await answer.text();
        if(p.action==='install'&&answer.ok){installPosts++;res.destroy();return;}
        res.writeHead(answer.status,{'content-type':'application/json'});res.end(text);
      }catch(e){res.destroy();}
    });
    await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
    const recovered=await installWithReconciliation({request:(p,t)=>httpJson(`http://127.0.0.1:${proxy.address().port}`,second.secrets.bootstrapToken,p,t),installPayload:second.payload,verifyPayload:{plugin:second.payload.plugin},siteUrl,intervalMs:10,attempts:3,budgetMs:30000});
    assert.equal(recovered.recoveredAfterDisconnect,true);assert.equal(installPosts,1);
    const current=info();assert.equal(current.name,original.name);assert.equal(current.user,original.user);assert.equal(current.prefix,'wp_replaced_');
    assert.equal(value("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('wp_options','wp_posts','wp_users','wp_plugin_data')"),'0');
    assert.equal(value('SELECT value FROM outside_keep WHERE id=1'),'untouched');
    assert.equal(value('SELECT id FROM wp_neighbor_posts'),'99');
    assert.equal(value("SELECT COUNT(*) FROM wp_replaced_users WHERE user_login='legacyadmin'"),'0');
    await login();
    assert.equal((await second.request(second.payload,30000)).alreadyInstalled,true);
    await verifyAndCleanup(second);assert.equal(audit().length,1);
    console.log('PASS real reinstall: same DB/user, old tables/users removed, foreign data kept, dropped reply recovered, duyanhweb wp-admin login, zero extra CREATE');
    const third=fixture('wp_last_');
    // Inject a one-shot publish failure in the test bootstrap only. The new DB
    // already exists, and retry must finish moving files without rebuilding it.
    const failFile=path.join(work,'publish-once');fs.writeFileSync(failFile,'1');
    const literal=failFile.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const needle="    if (!@rename($src,$dst)) throw new Exception('Không publish được '";
    let phpSource=fs.readFileSync(third.bridge,'utf8');
    assert.ok(phpSource.includes(needle));
    phpSource=phpSource.replace(needle,"    if ($name==='wp-config.php' && is_file('"+literal+"')) { unlink('"+literal+"'); throw new Exception('Fixture interrupted publish'); }\n"+needle);
    fs.writeFileSync(third.bridge,phpSource);
    await assert.rejects(third.request(third.payload,120000),e=>e.code==='INSTALL_FAILED' && e.message.includes('Fixture interrupted publish'));
    execFileSync('mariadb',['-h','127.0.0.1','-P','3306','-uroot','-p'+(process.env.MYSQL_ROOT_PASSWORD||'rootpass'),'tester_one','-e',"CREATE TABLE wp_last_canary (id INT); INSERT INTO wp_last_canary VALUES(777);"],{stdio:'pipe'});
    const thirdResult=await third.request(third.payload,120000);
    assert.equal(value('SELECT id FROM wp_last_canary'),'777','resume preserves newly installed tables');
    assert.equal(thirdResult.databaseMode,'reused');assert.equal(thirdResult.database.name,original.name);
    assert.equal(value('SELECT value FROM outside_keep WHERE id=1'),'untouched');assert.equal(value('SELECT id FROM wp_neighbor_posts'),'99');
    await login();await verifyAndCleanup(third);assert.equal(audit().length,1);
    console.log('PASS interrupted publication resumes without rebuilding new tables; second reinstall uses one DB and cleans all marker/recovery files');
  } finally {if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}await stop(server);fs.rmSync(work,{recursive:true,force:true});}
}
module.exports={runUnit,runLive};
if(require.main===module)(async()=>{runUnit();if(process.argv.includes('--live')){const n=process.argv.indexOf('--live');await runLive(process.argv[n+1],process.argv[n+2]);}})().catch(e=>{console.error(e);process.exitCode=1;});
