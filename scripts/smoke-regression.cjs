const assert = require('assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { createStore } = require('../core/store');
const { normalizeError } = require('../core/errors');
const { createSupportService, installChildProcessAudit } = require('../core/support');

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatcode-regression-'));
  const projectRoot = path.join(dir, 'laragon', 'www', 'project'); await fsp.mkdir(projectRoot, { recursive:true });
  const fakePhp = path.join(dir, 'laragon', 'bin', 'php', 'php-8.4.4', 'php.exe');
  await fsp.mkdir(path.dirname(fakePhp), { recursive:true });
  await fsp.writeFile(fakePhp, 'fixture', 'utf8');
  const app = { getPath: () => dir };

  // Production installs this hook before core/projects captures child_process.execFile.
  // Do the same in regression so npm.cmd/.bat behavior matches the packaged app.
  installChildProcessAudit(createSupportService(app));
  const { createProjectService, containsShellMeta, resolvePhpExe } = require('../core/projects');
  assert.equal(resolvePhpExe(projectRoot), fakePhp, 'Laragon PHP should be discovered from a project under laragon/www');

  const store = createStore(app, 47820); const state = store.ensure();
  state.projects = [{ id:'p1', name:'demo', root:projectRoot, permissions:{ write:true, manageFiles:true, tasks:true, gitWrite:true }, safety:{ write:'allow', rename:'allow', delete:'allow', task:'allow', gitStage:'allow', gitCommit:'allow' } }]; store.write(state);

  const unicodeName = 'tệp-đẹp.tmp';
  const unicodeText = '\uFEFFXin chào thế giới\r\nDòng 2 ✓\r\n';
  await fsp.writeFile(path.join(projectRoot, unicodeName), Buffer.from(unicodeText, 'utf8'));
  await fsp.writeFile(path.join(projectRoot, 'empty.tmp'), Buffer.alloc(0));
  await fsp.writeFile(path.join(projectRoot, 'binary.tmp'), Buffer.from([0,1,2,3,4,5]));
  await fsp.writeFile(path.join(projectRoot, '.env'), 'SECRET=1', 'utf8');
  await fsp.writeFile(path.join(dir, 'outside.txt'), 'outside', 'utf8');

  const projects = createProjectService(store); await projects.reindex('p1');
  const readUnicode = await projects.toolApi.readFile('p1', unicodeName);
  assert.equal(readUnicode.content, unicodeText, 'UTF-8 BOM/CRLF/Unicode changed');
  assert.equal((await projects.toolApi.readFile('p1', 'empty.tmp')).content, '', 'empty .tmp should be text');

  await assert.rejects(() => projects.toolApi.readFile('p1', 'binary.tmp'), error => normalizeError(error).code === 'UNSUPPORTED_BINARY');
  await assert.rejects(() => projects.toolApi.readFile('p1', '../outside.txt'), error => normalizeError(error).code === 'PATH_OUTSIDE_PROJECT');
  await assert.rejects(() => projects.toolApi.readFile('p1', '.env'), error => normalizeError(error).code === 'SENSITIVE_PATH_BLOCKED');
  await assert.rejects(() => projects.toolApi.writeFile('p1', '.env', 'NOPE=1'), error => normalizeError(error).code === 'SENSITIVE_PATH_BLOCKED');

  const batch = await projects.toolApi.readFiles('p1', [unicodeName, '.env', 'empty.tmp']);
  assert.equal(batch[0].content, unicodeText);
  assert.equal(batch[1].error.code, 'SENSITIVE_PATH_BLOCKED');
  assert.equal(batch[2].content, '');

  for (const command of ['node -e "1" && npm test','node -e "1" || npm test','node -e "1" | findstr 1','node -e "1" ; npm test','node -e "1" > out.txt','node -e "1" < in.txt']) assert.equal(containsShellMeta(command), true, `shell meta not detected: ${command}`);
  assert.equal(containsShellMeta(`node -e "console.log('a && b | c; d > e')"`), false, 'quoted JS content should not count as shell chaining');
  await assert.rejects(() => projects.toolApi.runTask('p1', 'node -e "1" && npm test'), error => normalizeError(error).code === 'TASK_NOT_ALLOWED');

  const node = await projects.toolApi.runTask('p1', `node -e "console.log('CHATCODE_TASK_OK')"`);
  assert.equal(node.ok, true); assert.match(node.stdout, /CHATCODE_TASK_OK/);
  if (process.platform === 'win32') {
    const npm = await projects.toolApi.runTask('p1', 'npm --version'); assert.equal(npm.ok, true, npm.stderr);
    const npmCmd = await projects.toolApi.runTask('p1', 'npm.cmd --version'); assert.equal(npmCmd.ok, true, npmCmd.stderr);
  }

  await projects.toolApi.writeFile('p1', 'created.txt', 'needle-unique-123');
  const search = await projects.toolApi.search('p1', 'needle-unique-123');
  assert.ok(search.some(x => x.path === 'created.txt'), 'create -> search failed');

  projects.shutdown(); await fsp.rm(dir, { recursive:true, force:true });
  console.log('Regression smoke passed: Unicode/BOM/CRLF/tmp sniff/path/env/batch/task shell/Node/npm checks OK');
})().catch(error => { console.error(error); process.exit(1); });
