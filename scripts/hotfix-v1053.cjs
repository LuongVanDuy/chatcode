const fs = require('node:fs');

function patch(file, find, replace, label) {
  let text = fs.readFileSync(file, 'utf8');
  const count = text.split(find).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match in ${file}, got ${count}`);
  text = text.replace(find, replace);
  fs.writeFileSync(file, text, 'utf8');
}

patch(
  'core/bricks-skill-enforcer.js',
  "function terminalStatus(value) { return /^(?:completed|finished|rolled_back|cancelled|canceled|failed|deploy_failed)$/i.test(String(value || '')); }",
  "function terminalStatus(value) { return /^(?:completed|finished|rolled_back|cancelled|canceled|failed)$/i.test(String(value || '')); }",
  'keep Bricks receipt alive across deploy_failed'
);

const regression = `\n\n  // FTP-only failure is retryable on the same prepared Bricks task. The receipt\n  // must survive deploy_failed and be cleared only after the retry completes.\n  let retryFinishCalls = 0;\n  const retryApi = {\n    async inspectProject(){ return { ...bricksContext, skills:[skill] }; },\n    async prepareTask(){ return {\n      ok:true, status:'ready', task_id:'task-retry', work_session_id:'task-retry', execution_path:'DEEP', context:bricksContext,\n      project_profile:{ facts:{ bricks_version:'2.3.13' } }, skills:[skill], agent_contract:{ guidance:[] }\n    }; },\n    async completeTask(){ return { ok:false, status:'deploy_failed', task_id:'task-retry', work_session_id:'task-retry', ftp_deploy:{ ok:false, status:'failed' } }; },\n    async workStatus(){ return { status:'completed', project_id:'p1', project:'fixture', changed_files:['home.css'] }; },\n    async startWork(){ return { work_session_id:'task-retry' }; },\n    async applyPatch(){ return { ok:true }; },\n    async applyAndVerify(){ return { ok:true }; },\n    async writeFile(){ return { ok:true }; },\n    async deleteFile(){ return { ok:true }; },\n    async renameFile(){ return { ok:true }; },\n    async runTask(){ return { ok:true }; },\n    async exec(){ return { status:'completed', exit_code:0 }; },\n    async finishWork(){ retryFinishCalls++; return { ok:true, status:'completed', work_session_id:'task-retry' }; },\n    async rollbackWork(){ return { status:'rolled_back' }; }\n  };\n  const retryEnforced = createBricksSkillEnforcerApi(retryApi, store);\n  await retryEnforced.prepareTask('p1','Deploy retry receipt regression',8,{});\n  const deployFailed = await retryEnforced.completeTask('task-retry','patch',[]);\n  assert.equal(deployFailed.status,'deploy_failed');\n  assert.ok(retryEnforced.bricksSkillReceipt('task-retry'),'deploy_failed must retain the prepared Bricks receipt');\n  const deployRetried = await retryEnforced.finishWork('task-retry');\n  assert.equal(deployRetried.status,'completed');\n  assert.equal(retryFinishCalls,1,'finish_work must retry on the same prepared task');\n  assert.equal(retryEnforced.bricksSkillReceipt('task-retry'),null,'completed retry must clear the receipt');`;

patch(
  'scripts/smoke-wordpress-bricks-v6.cjs',
  "  assert.equal(completed.skill_receipt.contract_version,6);",
  "  assert.equal(completed.skill_receipt.contract_version,6);" + regression,
  'add deploy retry receipt regression'
);

patch(
  'package.json',
  '  "version": "1.0.52",',
  '  "version": "1.0.53",',
  'bump version'
);

console.log('v1.0.53 Bricks deploy-receipt hotfix applied.');
