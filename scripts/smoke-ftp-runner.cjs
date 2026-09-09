// Uses the real Windows PowerShell/curl runner against an isolated loopback FTP fixture.
if (process.platform !== 'win32') { console.log('FTP runner smoke skipped: Windows PowerShell/curl test.'); process.exit(0); }
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const script = path.resolve(__dirname, '../tools/deploy-ftp.ps1');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-ftp-runner-test-'));
const files = new Map();
const dirs = new Set(['/', '/site']);
const sockets = new Set();
const dataServers = new Set();
let stores = 0, connections = 0, corruptUpload = false, failReadOnce = false, denyLogin = false;
const password = 'fixture:p"ass\\word';
const server = net.createServer(socket => {
  connections++;
  sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  socket.setEncoding('utf8');
  let cwd = '/', buffer = '', queue = Promise.resolve(), dataServer, dataSocket, renameFrom;
  const reply = s => socket.write(s + '\r\n');
  const absolute = p => path.posix.resolve(cwd, p || '.');
  const closeData = () => { if (dataServer) { dataServer.close(); dataServers.delete(dataServer); dataServer = null; } };
  socket.on('close', closeData);
  reply('220 Fixture FTP');
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const i = buffer.indexOf('\n');
      const line = buffer.slice(0,i).replace(/\r$/, ''); buffer=buffer.slice(i+1);
      queue = queue.then(async () => {
        const space=line.indexOf(' '), cmd=(space<0?line:line.slice(0,space)).toUpperCase(), arg=space<0?'':line.slice(space+1);
        if (cmd==='USER') return reply('331 Password');
        if (cmd==='PASS') return reply(!denyLogin && arg===password ? '230 Logged in' : '530 Login rejected');
        if (cmd==='PWD') return reply(`257 "${cwd}"`);
        if (cmd==='SYST') return reply('215 UNIX Type: L8');
        if (cmd==='TYPE' || cmd==='OPTS') return reply('200 OK');
        if (cmd==='CWD') { const p=absolute(arg); if (!dirs.has(p)) return reply('550 Missing directory'); cwd=p; return reply('250 CWD'); }
        if (cmd==='MKD') { const p=absolute(arg); dirs.add(p); return reply(`257 "${p}"`); }
        if (cmd==='SIZE') return reply(files.has(absolute(arg)) ? `213 ${files.get(absolute(arg)).length}` : '550 Missing file');
        if (cmd==='MDTM') return reply('213 20260909000000');
        if (cmd==='EPSV' || cmd==='PASV') {
          closeData();
          dataSocket=new Promise(resolve => { dataServer=net.createServer(s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));resolve(s);}); });
          dataServers.add(dataServer);
          await new Promise(resolve=>dataServer.listen(0,'127.0.0.1',resolve));
          const port=dataServer.address().port;
          return reply(cmd==='EPSV'?`229 Entering Extended Passive Mode (|||${port}|)`:`227 Entering Passive Mode (127,0,0,1,${port>>8},${port&255})`);
        }
        if (cmd==='RETR' || cmd==='NLST' || cmd==='LIST') {
          const body=cmd==='RETR'?files.get(absolute(arg)):Buffer.from('fixture\r\n');
          if (!body) return reply('550 Missing file');
          reply('150 Opening data'); const s=await dataSocket;
          if (cmd==='RETR' && failReadOnce) { failReadOnce=false; s.end(body.subarray(0,Math.max(0,body.length-1))); reply('426 Transfer interrupted'); }
          else { s.end(body); reply('226 Transfer complete'); }
          closeData(); return;
        }
        if (cmd==='STOR') {
          stores++; reply('150 Send data'); const s=await dataSocket;
          const chunks=[]; await new Promise((resolve,reject)=>{s.on('data',b=>chunks.push(b));s.on('end',resolve);s.on('error',reject);});
          files.set(absolute(arg),corruptUpload?Buffer.from('corrupt'):Buffer.concat(chunks));
          s.end(); closeData(); return reply('226 Stored');
        }
        if (cmd==='RNFR') { renameFrom=absolute(arg); return reply(files.has(renameFrom)?'350 Rename destination':'550 Missing source'); }
        if (cmd==='RNTO') { if (!files.has(renameFrom)) return reply('550 Missing source'); files.set(absolute(arg),files.get(renameFrom));files.delete(renameFrom);return reply('250 Renamed'); }
        if (cmd==='DELE') { return reply(files.delete(absolute(arg))?'250 Deleted':'550 Missing file'); }
        if (cmd==='QUIT') { reply('221 Bye'); socket.end(); return; }
        reply('502 Unsupported');
      }).catch(error=>{ socket.destroy(); process.stderr.write(`Fixture error: ${error.message}\n`); });
    }
  });
});
function run(manifest, flags=[]) {
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest));
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-ProjectRoot',root,'-Manifest',path.join(root,'manifest.json'),'-TimeoutSec','5',...flags],{windowsHide:true});
    let output=''; child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Runner fixture exceeded 60s'));},60000);
    child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);try{assert.ok(!output.includes(password),'password leaked');resolve({code,report:JSON.parse(output.slice(output.indexOf('{')))});}catch(e){reject(new Error(`${e.message}: ${output}`));}});
  });
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  fs.mkdirSync(path.join(root,'.vscode'));
  fs.writeFileSync(path.join(root,'.vscode','sftp.json'),JSON.stringify({protocol:'ftp',host:'127.0.0.1',port:server.address().port,username:'fixture',password,remotePath:'/site',secure:false,uploadOnSave:false}));
  fs.writeFileSync(path.join(root,'a.txt'),'new content');
  fs.mkdirSync(path.join(root,'nested'));
  fs.writeFileSync(path.join(root,'nested','ảnh mẫu.txt'),'UTF-8: tiếng Việt');
  for (const manifest of [{files:['a.txt','missing.txt']},{files:['../escape']},{files:['.vscode/sftp.json']},{files:['C:/secret']},{files:['a.txt\nDELE /site/a.txt']}]) {
    const r=await run(manifest);assert.equal(r.code,2);assert.equal(r.report.curl_requests,0);
  }
  assert.equal(connections,0,'preflight errors must not touch FTP');
  const dry=await run({files:['a.txt']},['-DryRun']);assert.equal(dry.code,0,JSON.stringify(dry.report));assert.equal(connections,0);
  files.set('/site/a.txt',Buffer.from('old content'));
  const good=await run({files:['a.txt','nested/ảnh mẫu.txt','a.txt']});
  assert.equal(good.code,0,JSON.stringify(good.report));assert.equal(good.report.files.length,2);assert.equal(stores,2);
  assert.equal(files.get('/site/nested/ảnh mẫu.txt').toString(),'UTF-8: tiếng Việt');
  const same=await run({files:['a.txt','nested/ảnh mẫu.txt']});assert.equal(same.code,0);assert.ok(same.report.files.every(x=>x.status==='unchanged'));assert.equal(stores,2);
  const single=await run(['a.txt']);assert.equal(single.code,0,'single item JSON arrays are supported');
  corruptUpload=true;fs.writeFileSync(path.join(root,'a.txt'),'changed again');
  const corrupt=await run({files:['a.txt','nested/ảnh mẫu.txt']});assert.equal(corrupt.code,2);assert.equal(files.get('/site/a.txt').toString(),'new content','corrupt staging must never replace live file');assert.deepEqual(corrupt.report.not_attempted,['nested/ảnh mẫu.txt']);
  corruptUpload=false;failReadOnce=true;
  const retry=await run({files:['a.txt']});assert.equal(retry.code,0);assert.equal(retry.report.files[0].attempts,2);
  denyLogin=true;const denied=await run({files:['a.txt']});assert.equal(denied.code,2);assert.equal(denied.report.files[0].attempts,1);denyLogin=false;
  const probe=await run({files:[]},['-Probe']);assert.equal(probe.code,0);
  assert.ok([...files.keys()].every(p=>!p.includes('chatcode-upload-')&&!p.includes('chatcode-ftp-probe-')),'temporary remote files must be cleaned');
  console.log('FTP runner PASS: preflight, UTF-8/password escaping, nested paths, atomic hash verification, unchanged/retry, auth failure, probe cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  for(const s of sockets)s.destroy();for(const s of dataServers)s.close();server.close();
  const checked=path.resolve(root),parent=path.resolve(os.tmpdir())+path.sep;
  assert.ok(checked.startsWith(parent)&&path.basename(checked).startsWith('chatcode-ftp-runner-test-'));
  fs.rmSync(checked,{recursive:true,force:true});
});
