const assert = require('assert/strict');
const { createFastExecutionApi } = require('../core/fast-execution');
const { createScopedInspect } = require('../core/retrieval-scope');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const store = { getProject:ref => ({ id:String(ref || 'p1'), name:'Demo', permissions:{ read:true } }) };

  let activeReads = 0;
  let maxActiveReads = 0;
  let readCalls = 0;
  let gitCalls = 0;
  let writes = 0;
  const api = createFastExecutionApi({
    readFile:async (_ref, rel) => {
      readCalls++;
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await sleep(12);
      activeReads--;
      return { path:rel, content:`content:${rel}:${readCalls}` };
    },
    readFiles:async () => { throw new Error('sequential base readFiles must be bypassed'); },
    gitStatus:async () => {
      gitCalls++;
      await sleep(16);
      return { ok:true, stdout:`git-${gitCalls}`, stderr:'' };
    },
    writeFile:async () => ({ ok:true, count:++writes }),
    inspectProject:async () => ({ ok:true, telemetry:{ total_ms:1 } }),
    prepareTask:async () => ({ ok:true, telemetry:{ total_ms:2 } })
  }, store);

  const batch = await api.readFiles('p1', ['a.php','b.php','c.php']);
  assert.equal(maxActiveReads, 3, 'read_files should fan out independent local reads');
  assert.deepEqual(batch.map(item => item.path), ['a.php','b.php','c.php'], 'parallel read order must remain deterministic');

  readCalls = 0;
  const sameRead = await Promise.all([
    api.readFile('p1', 'same.php'),
    api.readFile('p1', 'same.php')
  ]);
  assert.equal(readCalls, 1, 'duplicate in-flight reads should share one filesystem read');
  assert.equal(sameRead[0].content, sameRead[1].content);

  const sameGit = await Promise.all([api.gitStatus('p1'), api.gitStatus('p1')]);
  assert.equal(gitCalls, 1, 'concurrent Work/Inspect git status should share one process');
  assert.equal(sameGit[0].stdout, sameGit[1].stdout);
  await api.writeFile('p1', 'changed.php', 'x');
  await api.gitStatus('p1');
  assert.equal(gitCalls, 2, 'a mutation must invalidate the short git-status reuse window');

  const stats = api.__fastExecutionStats();
  assert.ok(stats.git_status_coalesced >= 1);
  assert.ok(stats.read_file_coalesced >= 1);
  assert.ok(stats.parallel_read_batches >= 1);

  let projectBrainCalls = 0;
  let gitInFlight = false;
  let readObservedGitOverlap = false;
  const ownerPath = 'wp-content/themes/demo-child/functions.php';
  const profile = {
    isWordPress:true,
    childThemes:[{ slug:'demo-child', template:'bricks', root:'wp-content/themes/demo-child' }],
    parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }],
    customPlugins:[]
  };
  const inspectApi = {
    projectContext:async () => {
      await sleep(3);
      return {
        frameworks:[{ name:'WordPress' }, { name:'Bricks' }],
        framework_names:['WordPress','Bricks'],
        primary_language:'PHP',
        entrypoints:[ownerPath],
        wordpress:profile,
        files:[{ path:ownerPath, language:'PHP', symbols:[{ name:'demo_owner', kind:'function', line:1 }], score:10 }],
        relations:[]
      };
    },
    projectBrain:async () => {
      projectBrainCalls++;
      return { frameworks:[], framework_names:[], primary_language:'PHP', entrypoints:[], wordpress:profile, topSymbols:[] };
    },
    gitStatus:async () => {
      gitInFlight = true;
      await sleep(18);
      gitInFlight = false;
      return { ok:false, stderr:'not a git repository' };
    },
    readFile:async (_ref, rel) => {
      if (gitInFlight) readObservedGitOverlap = true;
      await sleep(4);
      return { path:rel, content:'<?php function demo_owner() {}' };
    }
  };
  const inspectStore = { getProject:() => ({ id:'p1', name:'Demo', permissions:{ read:true } }) };
  const inspected = await createScopedInspect(inspectApi, inspectStore)('p1', 'Fix child theme functions owner', 3);
  assert.equal(projectBrainCalls, 0, 'current Project Brain context metadata should avoid a redundant projectBrain summary call');
  assert.equal(inspected.telemetry.brain_overview_source, 'project-context');
  assert.equal(inspected.telemetry.overlapped_git, true);
  assert.equal(readObservedGitOverlap, true, 'git status should execute underneath content reads instead of after them');
  assert.ok(inspected.top_symbols.some(item => item.name === 'demo_owner'));
  assert.ok(inspected.relevant_files.some(item => item.path === ownerPath));

  const fallbackApi = {
    projectContext:async () => ({ files:[], relations:[] }),
    projectBrain:async () => {
      projectBrainCalls++;
      return { frameworks:[], framework_names:[], primary_language:'JavaScript', entrypoints:[], wordpress:{ isWordPress:false }, topSymbols:[] };
    },
    gitStatus:async () => ({ ok:false, stderr:'not a git repository' }),
    readFile:async () => ({ content:'' })
  };
  const fallback = await createScopedInspect(fallbackApi, inspectStore)('p1', 'legacy context', 3);
  assert.equal(fallback.telemetry.brain_overview_source, 'project-brain-fallback');
  assert.equal(projectBrainCalls, 1, 'legacy context shape must retain the projectBrain compatibility fallback');

  console.log('Fast Execution PASS: coalesced Git/read I/O + parallel read batches + context metadata reuse + overlapped inspect I/O.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
