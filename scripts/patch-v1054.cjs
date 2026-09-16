const fs = require('node:fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, text) { fs.writeFileSync(file, text, 'utf8'); }
function replaceOnce(file, find, replace, label) {
  const text = read(file);
  const count = text.split(find).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match in ${file}, got ${count}`);
  write(file, text.replace(find, replace));
}
function replaceBetween(file, start, end, replacement, label) {
  const text = read(file);
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`${label}: markers not found in ${file}`);
  if (text.indexOf(start, a + start.length) >= 0 && text.indexOf(start, a + start.length) < b) throw new Error(`${label}: duplicate start marker in ${file}`);
  write(file, text.slice(0, a) + replacement + text.slice(b));
}

// Work Session: verification/final snapshot can be prepared while the session stays active.
replaceOnce(
  'core/work-runtime.js',
  "      commands:[], operations:[], recoveryIds:[],\n      baseline:{ git, brain:brain ? { frameworks:brain.framework_names || [], primary_language:brain.primary_language || '', entrypoints:(brain.entrypoints || []).slice(0,20), stats:brain.stats || null } : null }",
  "      commands:[], operations:[], recoveryIds:[], preparedFinal:null,\n      baseline:{ git, brain:brain ? { frameworks:brain.framework_names || [], primary_language:brain.primary_language || '', entrypoints:(brain.entrypoints || []).slice(0,20), stats:brain.stats || null } : null }",
  'add prepared final cache'
);
replaceOnce(
  'core/work-runtime.js',
  "    s.updatedAt = new Date().toISOString();\n    s.changedFiles.add(plan.path);",
  "    s.updatedAt = new Date().toISOString();\n    s.preparedFinal = null;\n    s.changedFiles.add(plan.path);",
  'invalidate prepared final after patch'
);

const finishWork = `  async function finishWork(id, verifyCommands = [], options = {}) {\n    const s = get(id), p = projectForSession(s);\n    if (options.cancel) {\n      // Closing work is distinct from restoring files or deploying them.\n      if (s.status !== 'active') return publicSession(s);\n      s.status = 'cancelled';\n      s.preparedFinal = null;\n      s.updatedAt = s.finishedAt = new Date().toISOString();\n      const jobs = typeof api.listTerminalJobs === 'function' ? await api.listTerminalJobs(p.id) : [];\n      const stopped = await Promise.allSettled(jobs.filter(job => job.work_session_id === id && ['running','stopping'].includes(job.status)).map(job => api.jobStop(job.job_id)));\n      return { ...publicSession(s), ok:true, files_preserved:true, stopped_jobs:stopped.filter(r => r.status === 'fulfilled').map(r => r.value.job_id) };\n    }\n\n    if (options.commitPrepared) {\n      if (s.status !== 'active') return status(id);\n      const prepared = s.preparedFinal;\n      if (!prepared?.verification_passed) {\n        return { ...publicSession(s), ok:false, verification:prepared?.verification || [], verification_passed:false, reason:'finalization_not_prepared' };\n      }\n      const finalized = { verification:prepared.verification, brain:prepared.brain, final:prepared.final };\n      s.status = 'completed';\n      s.preparedFinal = null;\n      s.updatedAt = s.finishedAt = new Date().toISOString();\n      return { ...publicSession(s), ok:true, verification:finalized.verification, verification_passed:true, brain:finalized.brain, final:finalized.final };\n    }\n\n    if (s.status !== 'active') return status(id);\n    if (options.deferCompletion && s.preparedFinal?.verification_passed) {\n      const prepared = s.preparedFinal;\n      return { ...publicSession(s), ok:true, verification:prepared.verification, verification_passed:true, brain:prepared.brain, final:prepared.final, deploy_pending:true, finalization_prepared:true };\n    }\n\n    const verification = [];\n    for (const command of (Array.isArray(verifyCommands) ? verifyCommands : []).map(String).filter(Boolean).slice(0,6)) {\n      let r;\n      if ((p.workspaceMode || 'safe') === 'trusted' && typeof api.exec === 'function') r = await api.exec(p.id, command, { background:false, timeout_ms:120000, work_session_id:s.id });\n      else r = await api.runTask(p.id, command);\n      const ok = r?.status ? r.status === 'completed' && r.exit_code === 0 : !!r?.ok;\n      verification.push({ command, ok, status:r?.status || (r?.ok ? 'completed' : 'failed'), exit_code:r?.exit_code ?? r?.code ?? null, stdout:String(r?.stdout || '').slice(-16000), stderr:String(r?.stderr || '').slice(-16000) });\n      if (!r?.status) recordCommand(s.id, p.id, command, r);\n    }\n    if (s.status !== 'active') return { ...publicSession(s), ok:false, verification, verification_passed:false };\n    const reused = options?.reuseFinal || null;\n    const brainStart = Date.now();\n    let brainResult = reused?.brain || null;\n    if (!reused) {\n      await projects.reindex(p.id);\n      const brain = typeof api.rebuildBrain === 'function' ? await api.rebuildBrain(p.id) : null;\n      brainResult = { refreshed:true, refresh_ms:Date.now() - brainStart, updated_at:brain?.updatedAt || null, stats:brain?.stats || null };\n    }\n    if (s.status !== 'active') return { ...publicSession(s), ok:false, verification, verification_passed:false };\n    const passed = verification.every(x => x.ok);\n    const final = { git:reused?.git || await gitSnapshot(p.id) };\n    s.updatedAt = new Date().toISOString();\n    if (!passed) {\n      s.preparedFinal = null;\n      return { ...publicSession(s), ok:false, verification, verification_passed:false, brain:brainResult, final };\n    }\n    if (options.deferCompletion) {\n      s.preparedFinal = { verification, verification_passed:true, brain:brainResult, final };\n      return { ...publicSession(s), ok:true, verification, verification_passed:true, brain:brainResult, final, deploy_pending:true, finalization_prepared:true };\n    }\n    s.status = 'completed';\n    s.finishedAt = s.updatedAt;\n    return { ...publicSession(s), ok:true, verification, verification_passed:true, brain:brainResult, final };\n  }\n\n`;
replaceBetween('core/work-runtime.js', '  async function finishWork(id, verifyCommands = [], options = {}) {', '  async function rollbackWork(id) {', finishWork, 'replace finishWork with two-phase finalization');

// FTP owns deploy before the Work Session commits completed.
const ftpFinish = `  if (typeof api.finishWork === 'function') {\n    const originalFinishWork = api.finishWork.bind(api);\n    api.finishWork = async (workSessionId, ...args) => {\n      const options = args[1] || {};\n      if (options?.cancel) return originalFinishWork(workSessionId, ...args);\n      if (finishing.has(workSessionId)) return finishing.get(workSessionId);\n      const run = async () => {\n        let before = null;\n        try { if (typeof api.workStatus === 'function') before = await api.workStatus(workSessionId); } catch {}\n        const previous = finishedDeploys.get(workSessionId);\n        if (before?.status === 'completed' && previous?.ftp_deploy?.ok) return previous;\n\n        const prepared = await originalFinishWork(workSessionId, args[0] || [], { ...options, deferCompletion:true });\n        if (prepared?.status !== 'active' || prepared?.ok === false || prepared?.verification_passed === false) return prepared;\n        const projectRef = prepared?.project_id || prepared?.project || before?.project_id || before?.project || '';\n        const changedFiles = prepared?.changed_files || before?.changed_files || [];\n        if (!projectRef) return prepared;\n\n        const ftp = await deployChangedFiles(api, store, projectRef, changedFiles, workSessionId);\n        if (shouldAttachFtpResult(ftp) && ftp?.ok !== true) {\n          const failed = completionWithDeployStatus({ ...prepared, ftp_deploy:ftp });\n          finishedDeploys.set(workSessionId, failed);\n          while (finishedDeploys.size > 200) finishedDeploys.delete(finishedDeploys.keys().next().value);\n          return failed;\n        }\n\n        const committed = await originalFinishWork(workSessionId, [], { ...options, commitPrepared:true });\n        if (committed?.status !== 'completed') return committed;\n        const completed = shouldAttachFtpResult(ftp) ? { ...committed, ftp_deploy:ftp } : committed;\n        finishedDeploys.set(workSessionId, completed);\n        while (finishedDeploys.size > 200) finishedDeploys.delete(finishedDeploys.keys().next().value);\n        return completed;\n      };\n      const pending = run();\n      finishing.set(workSessionId, pending);\n      try { return await pending; } finally { finishing.delete(workSessionId); }\n    };\n  }\n\n`;
replaceBetween('core/ftp-deploy.js', "  if (typeof api.finishWork === 'function') {", "  if (typeof api.applyAndVerify === 'function') {", ftpFinish, 'deploy before commit');

// deploy_failed is resumable: keep the project/session holder.
replaceOnce(
  'core/project-scope.js',
  "const WORK_FINAL_RE = /^(?:completed|finished|rolled_back|failed|deploy_failed|cancelled|canceled)$/i;",
  "const WORK_FINAL_RE = /^(?:completed|finished|rolled_back|failed|cancelled|canceled)$/i;",
  'keep project scope on deploy_failed'
);

// Agent must not forget task context/decisions while deploy is resumable.
const oldAgent = `    if (finished.status !== 'completed' && finished.status !== 'deploy_failed') {\n      return { ok:false, status:finished.status, task_id:id, work_session_id:id, verification, verification_passed:false, session:finished };\n    }\n    const savedProfile = saveProjectRules(store, projectId, rememberProjectRules);`;
const newAgent = `    if (finished.status === 'deploy_failed') {\n      return {\n        ok:false, status:'deploy_failed', task_id:id, work_session_id:id,\n        execution_path:taskCard?.execution?.path || null, task_card:taskCard, scope_check:scopeCheck,\n        verification, verification_passed:true,\n        changed_files:finished.changed_files || applied.changed_files || [],\n        recovery_points:finished.recovery_points || applied.recovery_points || [],\n        git:finished.final?.git || applied.git || null, brain:finished.brain || applied.brain || null,\n        ftp_deploy:finished.ftp_deploy || null, session:finished,\n        next_action:finished.next_action || 'Code đã verify. Giữ nguyên task/session và retry finish_work để deploy lại; không áp patch lại.',\n        agent_contract:{ preferred_calls:2, completed_in_call:2, result:'deploy_failed' },\n        telemetry:{ total_ms:nowMs() - started, patch_ms:patchMs, verify_ms:verifyMs, finalize_ms:finalizeMs, brain_refresh_ms:Number(finished?.brain?.refresh_ms || applied?.brain?.refresh_ms)||0, git_ms:0 }\n      };\n    }\n    if (finished.status !== 'completed') {\n      return { ok:false, status:finished.status, task_id:id, work_session_id:id, verification, verification_passed:false, session:finished };\n    }\n    const savedProfile = saveProjectRules(store, projectId, rememberProjectRules);`;
replaceOnce('core/agent-runtime.js', oldAgent, newAgent, 'preserve agent task on deploy_failed');

// Update FTP lifecycle smoke mocks and assertions for active-until-deploy semantics.
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "const path = require('path');",
  "const path = require('path');\nconst { createWorkRuntime } = require('../core/work-runtime');",
  'import work runtime smoke'
);
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "    finishWork:async () => ({ project_id:'p1', project:'Fixture', status:'completed', changed_files:['inc/test.php'] }),",
  "    finishWork:async (_id,_commands,options={}) => options.commitPrepared\n      ? ({ project_id:'p1', project:'Fixture', status:'completed', changed_files:['inc/test.php'] })\n      : ({ project_id:'p1', project:'Fixture', status:'active', changed_files:['inc/test.php'], ok:true, verification_passed:true, deploy_pending:true }),",
  'basic wrapper deferred finalization mock'
);
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "  let retryCalls = 0;\n  let finishCalls = 0;\n  let workState = 'active';",
  "  let retryCalls = 0;\n  let finishCalls = 0;\n  let verificationCalls = 0;\n  let commitCalls = 0;\n  let preparedRetry = false;\n  let workState = 'active';",
  'retry counters'
);
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "    finishWork:async () => { finishCalls++; workState='completed'; return { project_id:'p1', status:'completed', changed_files:['a.php','b.php'] }; },",
  "    finishWork:async (_id,_commands,options={}) => {\n      finishCalls++;\n      if (options.commitPrepared) { commitCalls++; workState='completed'; return { project_id:'p1', status:'completed', changed_files:['a.php','b.php'] }; }\n      assert.equal(options.deferCompletion,true);\n      if (!preparedRetry) { verificationCalls++; preparedRetry=true; }\n      return { project_id:'p1', status:'active', changed_files:['a.php','b.php'], ok:true, verification_passed:true, deploy_pending:true };\n    },",
  'retry deferred finalization mock'
);
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "      retryCalls++;\n      const payload = payloadFromCommand(cmd);",
  "      retryCalls++;\n      assert.equal(workState, 'active', 'FTP staging must run while Work Session is active');\n      const payload = payloadFromCommand(cmd);",
  'assert active during staging'
);
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "  assert.equal(retryApi.projectScope('p1').locked, false, 'failed FTP must not retain completed work holder');",
  "  assert.equal(workState, 'active', 'failed FTP must leave the Work Session resumable');\n  assert.equal(retryApi.projectScope('p1').locked, true, 'failed FTP must retain the active work holder');",
  'scope remains locked on deploy fail'
);
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "  assert.equal(finishCalls, 2, 'cached success must not re-run finish verification');",
  "  assert.equal(verificationCalls, 1, 'deploy retry must reuse prepared verification');\n  assert.equal(commitCalls, 1, 'session must commit exactly once after deploy success');\n  assert.equal(finishCalls, 3, 'two prepare calls plus one commit are expected; verification itself stays cached');",
  'retry finalization assertions'
);
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "    finishWork:async () => { conflictState='completed'; return { project_id:'p1', status:'completed', changed_files:['a.php','b.php'] }; },",
  "    finishWork:async (_id,_commands,options={}) => {\n      if (options.commitPrepared) { conflictState='completed'; return { project_id:'p1', status:'completed', changed_files:['a.php','b.php'] }; }\n      return { project_id:'p1', status:'active', changed_files:['a.php','b.php'], ok:true, verification_passed:true, deploy_pending:true };\n    },",
  'conflict deferred finalization mock'
);
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "    finishWork:async () => ({ project_id:'p1', status:'completed', changed_files:['a.php'] }),",
  "    finishWork:async (_id,_commands,options={}) => options.commitPrepared\n      ? ({ project_id:'p1', status:'completed', changed_files:['a.php'] })\n      : ({ project_id:'p1', status:'active', changed_files:['a.php'], ok:true, verification_passed:true, deploy_pending:true }),",
  'concurrent deferred finalization mock'
);

const lifecycleSmoke = `\n  // F6: WorkRuntime itself keeps the session active after final preparation and commits only after deploy.\n  const lifecycleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcode-work-finalize-'));\n  let lifecycleBrainRefreshes = 0;\n  const lifecycleProject = { id:'life', name:'Lifecycle', root:lifecycleRoot, workspaceMode:'trusted' };\n  const lifecycleStore = { getProject:ref => { if (['life','Lifecycle'].includes(String(ref))) return lifecycleProject; throw new Error('missing'); } };\n  const lifecycleProjects = { reindex:async () => ({ ok:true }) };\n  const lifecycleBase = {\n    gitStatus:async () => ({ ok:false, stdout:'', stderr:'not-a-repo' }),\n    gitDiff:async () => ({ ok:false, stdout:'', stderr:'not-a-repo' }),\n    rebuildBrain:async () => { lifecycleBrainRefreshes++; return { updatedAt:new Date().toISOString(), stats:{} }; },\n    listTerminalJobs:async () => []\n  };\n  const lifecycleRuntime = createWorkRuntime(lifecycleProjects, lifecycleStore, null, lifecycleBase);\n  const lifecycleSession = await lifecycleRuntime.startWork('life','two-phase deploy finalization',{ compactBaseline:true });\n  const preparedFinal = await lifecycleRuntime.finishWork(lifecycleSession.work_session_id, [], { deferCompletion:true });\n  assert.equal(preparedFinal.status, 'active');\n  assert.equal(preparedFinal.deploy_pending, true);\n  assert.equal((await lifecycleRuntime.status(lifecycleSession.work_session_id)).status, 'active');\n  const cachedPrepared = await lifecycleRuntime.finishWork(lifecycleSession.work_session_id, [], { deferCompletion:true });\n  assert.equal(cachedPrepared.status, 'active');\n  assert.equal(lifecycleBrainRefreshes, 1, 'retry must not rebuild/reverify prepared finalization');\n  const committedFinal = await lifecycleRuntime.finishWork(lifecycleSession.work_session_id, [], { commitPrepared:true });\n  assert.equal(committedFinal.status, 'completed');\n  assert.equal((await lifecycleRuntime.status(lifecycleSession.work_session_id)).status, 'completed');\n  fs.rmSync(lifecycleRoot, { recursive:true, force:true });\n`;
replaceOnce(
  'scripts/smoke-ftp-deploy.cjs',
  "  const legacy = await wrappedApi.applyAndVerify('p1', [{ op:'write', path:'legacy.php', content:'<?php' }, { op:'delete', path:'gone.php' }], []);",
  lifecycleSmoke + "\n  const legacy = await wrappedApi.applyAndVerify('p1', [{ op:'write', path:'legacy.php', content:'<?php' }, { op:'delete', path:'gone.php' }], []);",
  'add real WorkRuntime two-phase regression'
);

replaceOnce('package.json', '  "version": "1.0.53",', '  "version": "1.0.54",', 'bump v1.0.54');

console.log('v1.0.54 deploy finalization patch applied.');
