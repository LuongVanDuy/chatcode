'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const { buildInstallProfileBootstrap, CHILD_SHA256 } = require('../core/fresh-install-profile');
const { buildFreshInstallBootstrap } = require('../core/fresh-install-bootstrap');
const { readZipEntries, readZipEntry } = require('../core/fresh-install-packages');
const { createFreshInstallService } = require('../core/fresh-install-runtime');
const { createFreshInstallVault } = require('../core/fresh-install-vault');
const { httpJson } = require('../core/fresh-install-http');
const bundle = path.resolve(__dirname, '../core/packages/bricks-child.zip');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(r => setTimeout(r, ms));
const storage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() };

function runUnit() {
  const bytes = fs.readFileSync(bundle);
  assert.equal(hash(bytes), CHILD_SHA256);
  const source = buildInstallProfileBootstrap();
  const encoded = source.match(/base64_decode\('([^']+)',true\)/)[1];
  assert.deepEqual(Buffer.from(encoded, 'base64'), bytes);
  const files = readZipEntries(bundle).filter(p => !p.endsWith('/')).sort();
  assert.deepEqual(files, ['bricks-child/elements/title.php','bricks-child/functions.php','bricks-child/screenshot.png','bricks-child/style.css']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-profile-unit-'));
  try {
    fs.writeFileSync(path.join(root, 'profile.php'), '<?php\n' + source);
    fs.mkdirSync(path.join(root,'wp-admin/includes'), {recursive:true});
    fs.writeFileSync(path.join(root,'wp-admin/includes/translation-install.php'),'<?php');
    const unit = String.raw`<?php
require $argv[1];
define('ABSPATH',__DIR__.'/');
function cc_fail($m,$s,$c){throw new Exception($c);}
function cc_remove_tree($file){if(is_dir($file)&&!is_link($file)){foreach(scandir($file) as $n)if($n!=='.'&&$n!=='..')cc_remove_tree($file.'/'.$n);rmdir($file);}else{unlink($file);}}
function wp_download_language_pack($locale){return false;}
mkdir(__DIR__.'/stage');mkdir(__DIR__.'/stage/themes');mkdir(__DIR__.'/stage/plugins');mkdir(__DIR__.'/live');
file_put_contents(__DIR__.'/live/keep','old site');
foreach(array('bricks','bricks-child','twentytwentyfive','twentytwentysix') as $n){mkdir(__DIR__.'/stage/themes/'.$n);file_put_contents(__DIR__.'/stage/themes/'.$n.'/style.css','fixture');}
foreach(array('akismet','duyanhwebpro') as $n){mkdir(__DIR__.'/stage/plugins/'.$n);file_put_contents(__DIR__.'/stage/plugins/'.$n.'/plugin.php','fixture');}
file_put_contents(__DIR__.'/stage/plugins/hello.php','fixture');
cc_profile_prune_directory(__DIR__.'/stage/themes',array('bricks','bricks-child'));
cc_profile_prune_directory(__DIR__.'/stage/plugins',array('duyanhwebpro'));
if(array_values(array_diff(scandir(__DIR__.'/stage/themes'),array('.','..')))!==array('bricks','bricks-child'))throw new Exception('theme inventory');
if(array_values(array_diff(scandir(__DIR__.'/stage/plugins'),array('.','..')))!==array('duyanhwebpro'))throw new Exception('plugin inventory');
try{cc_profile_prepare_language();throw new Exception('missing language accepted');}catch(Exception $e){if($e->getMessage()!=='LANGUAGE_DOWNLOAD_FAILED')throw $e;}
if(file_get_contents(__DIR__.'/live/keep')!=='old site')throw new Exception('live tree changed');
echo "PASS stage-only pruning and explicit translation-download failure\n";
`;
    fs.writeFileSync(path.join(root,'test.php'), unit);
    console.log(execFileSync('php',[path.join(root,'test.php'),path.join(root,'profile.php')],{encoding:'utf8'}).trim());
    const service = createFreshInstallService({app:{getPath:()=>root},safeStorage:storage});
    const task=service.create({domain:'example.test',username:'tester',password:'fixture',theme:{id:'wordpress-default'}});
    assert.equal(task.manifest.wordpress.locale,'vi');
    assert.equal(task.manifest.profile_version,1);
    assert.equal(service.credentials(task.id).username,'duyanhweb');
    console.log('PASS exact supplied child ZIP bytes and file inventory; Vietnamese task profile');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
}

async function runLive(site,core) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cc-profile-live-'));
  const app={getPath:()=>root},service=createFreshInstallService({app,safeStorage:storage});
  const themeZip=path.join(site,'.chatcode-theme-e2e.zip'),pluginZip=path.join(site,'.chatcode-plugin-e2e.zip');
  await service.importTheme(themeZip,{id:'bricks',version:'2.4'});
  await service.importPlugin(pluginZip,{id:'duyanhwebpro',version:'1.9.4'});
  const p=net.createServer();await new Promise(r=>p.listen(0,'127.0.0.1',r));const port=p.address().port;await new Promise(r=>p.close(r));
  const siteUrl=`http://127.0.0.1:${port}`,ftpPassword=process.env.PANEL_PASSWORD;
  let server;
  const php=(code)=>execFileSync('php',['-r',code,path.join(site,'wp-load.php')],{encoding:'utf8'});
  const info=()=>JSON.parse(php("define('WP_ADMIN',true);require $argv[1];require_once ABSPATH.'wp-admin/includes/plugin.php';$u=get_user_by('login','duyanhweb');global $table_prefix;echo json_encode(array('database'=>DB_NAME,'dbUser'=>DB_USER,'prefix'=>$table_prefix,'locale'=>get_locale(),'adminLocale'=>get_user_locale($u),'dashboard'=>__('Dashboard'),'themes'=>array_keys(wp_get_themes()),'plugins'=>array_keys(get_plugins()),'elementRegistered'=>class_exists('Element_Custom_Title')));"));
  function taskFixture(){
    const task=service.create({domain:'example.test',username:'tester',password:ftpPassword,clearRemote:true,theme:{id:'bricks',version:'2.4'}});
    const secret=createFreshInstallVault(app,storage).get(task.id),pkg=task.manifest.theme.package,plugin=task.manifest.plugins[0].fallback_package;
    fs.copyFileSync(service.packageService.find('bricks','2.4').path,path.join(site,pkg.remote_name));
    fs.copyFileSync(service.packageService.find('duyanhwebpro','1.9.4').path,path.join(site,plugin.remote_name));
    fs.copyFileSync(core,path.join(site,'.chatcode-core-profile.zip'));
    const bridge=path.join(site,task.bootstrap.name);
    fs.writeFileSync(bridge,buildFreshInstallBootstrap({token:secret.bootstrapToken,installId:task.manifest.install_id,bridgeName:task.bootstrap.name,themePackageName:pkg.remote_name,themeSha256:pkg.sha256,themeSlug:pkg.slug,themeEntry:pkg.expected_entry,themeArchiveLayout:pkg.archive_layout}));
    const payload={action:'install',panelUser:'tester',panelPassword:ftpPassword,dbName:task.manifest.database.name,dbUser:task.manifest.database.user,dbPassword:secret.databasePassword,dbHost:'127.0.0.1',tablePrefix:task.manifest.database.table_prefix,siteTitle:'Profile test',adminUser:'duyanhweb',adminPassword:secret.adminPassword,adminEmail:'admin@example.test',siteUrl,clearRemote:true,corePackage:'.chatcode-core-profile.zip',theme:{id:'bricks',active_theme:'bricks-child',generated_child:'bricks-child'},plugin:{entry:plugin.entry,manifest_url:'',fallback_package:plugin.remote_name,fallback_sha256:plugin.sha256,fallback_version:'1.9.4'}};
    return {task,bridge,payload,call:(data,ms=120000)=>httpJson(`${siteUrl}/${task.bootstrap.name}`,secret.bootstrapToken,data,ms)};
  }
  async function check(f){
    const verified=await f.call({action:'verify',profileVersion:1,adminUser:'duyanhweb',theme:f.payload.theme,plugin:f.payload.plugin});
    assert.equal(verified.locale,'vi');assert.deepEqual(verified.themes,['bricks','bricks-child']);assert.deepEqual(verified.plugins,['duyanhwebpro/duyanhwebpro.php']);
    const state=info();assert.equal(state.locale,'vi');assert.equal(state.adminLocale,'vi');assert.notEqual(state.dashboard,'Dashboard');assert.equal(state.elementRegistered,true);
    for(const entry of readZipEntries(bundle).filter(n=>!n.endsWith('/'))){
      assert.deepEqual(fs.readFileSync(path.join(site,'wp-content/themes',entry)),readZipEntry(bundle,entry),entry+' must match the original upload byte-for-byte');
    }
    const dirs=folder=>fs.readdirSync(path.join(site,'wp-content',folder)).filter(n=>n!=='index.php').sort();
    assert.deepEqual(dirs('themes'),['bricks','bricks-child']);assert.deepEqual(dirs('plugins'),['duyanhwebpro']);
    const page=await fetch(siteUrl+'/wp-login.php');const cookie=page.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');await page.text();
    const login=await fetch(siteUrl+'/wp-login.php',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams({log:'duyanhweb',pwd:ftpPassword,testcookie:'1','wp-submit':'Log In',redirect_to:siteUrl+'/wp-admin/'})});
    assert.equal(login.status,302,'actual WordPress login');
    const session=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
    const admin=await fetch(siteUrl+'/wp-admin/',{headers:{cookie:session}});assert.equal(admin.status,200);
    assert.match(await admin.text(),/<html[^>]*lang="vi"/i,'Vietnamese admin HTML');
    const result=await f.call({action:'cleanup',corePackage:f.payload.corePackage,plugin:f.payload.plugin});assert.equal(result.markerRemoved,true);
    assert.ok(!fs.existsSync(f.bridge));assert.ok(!fs.existsSync(path.join(site,'.chatcode-install-id')));
    return state;
  }
  try{
    server=spawn('php',['-S',`127.0.0.1:${port}`,'-t',site],{stdio:['ignore','ignore','pipe']});
    let log='';server.stderr.on('data',b=>{log+=b;log=log.slice(-5000);});
    for(let n=0;;n++){try{await fetch(siteUrl);break;}catch(e){if(n>70)throw new Error(log||e.message);await delay(25);}}
    const first=taskFixture();await first.call(first.payload,240000);const original=await check(first);
    console.log('PASS real WordPress: supplied child matches every file including screenshot, custom element loads with parent fixture, only two themes/one plugin, Vietnamese catalog and wp-admin login');
    const second=taskFixture();
    const before=hash(fs.readFileSync(path.join(site,'wp-config.php')));
    const originalBootstrap=fs.readFileSync(second.bridge,'utf8');
    fs.writeFileSync(second.bridge,originalBootstrap.replace('  cc_profile_prepare_language();',"  cc_fail('Fixture language download unavailable',502,'LANGUAGE_DOWNLOAD_FAILED');"));
    await assert.rejects(second.call(second.payload,240000),e=>e.code==='LANGUAGE_DOWNLOAD_FAILED');
    assert.equal(hash(fs.readFileSync(path.join(site,'wp-config.php'))),before);
    assert.equal(info().prefix,original.prefix);
    fs.writeFileSync(second.bridge,originalBootstrap);
    const result=await second.call(second.payload,240000);assert.equal(result.databaseMode,'reused');
    const replacement=await check(second);assert.equal(replacement.database,original.database);assert.equal(replacement.dbUser,original.dbUser);assert.notEqual(replacement.prefix,original.prefix);
    const audit=fs.readFileSync(process.env.PANEL_AUDIT_FILE,'utf8').trim().split('\n').filter(Boolean);assert.equal(audit.length,1);
    console.log('PASS failed language preparation leaves old site intact; retry/reinstall keeps one DB and the exact Vietnamese Bricks profile with complete marker cleanup');
  }finally{
    if(server&&server.exitCode===null){const ended=new Promise(r=>server.once('exit',r));server.kill();await ended;}
    fs.rmSync(root,{recursive:true,force:true});
  }
}
module.exports={runUnit,runLive};
if(require.main===module)(async()=>{runUnit();const n=process.argv.indexOf('--live');if(n>=0)await runLive(process.argv[n+1],process.argv[n+2]);})().catch(e=>{console.error(e);process.exitCode=1;});
