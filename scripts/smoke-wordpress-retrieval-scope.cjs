const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { planWordPressRetrieval, classifyWordPressPath } = require('../core/wordpress-retrieval');
const { createScopedInspect, readRelevantFiles } = require('../core/retrieval-scope');
const { createAgentRuntime, verificationHints } = require('../core/agent-runtime');
const { chooseResources } = require('../core/skill-runtime');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'CHATCODE-GPT', 'skills', 'wordpress-bricks', 'manifest.json'), 'utf8'));
const explicitRetrieval = chooseResources(manifest, 'Inspect this WordPress project with scope-first retrieval: search Project Brain before read and do not fetch wp-admin or wp-includes unless required');
assert.ok(explicitRetrieval.includes('resources/retrieval-scope.md'));
const ordinaryHeader = chooseResources(manifest, 'Fix the mobile header spacing');
assert.equal(ordinaryHeader.includes('resources/retrieval-scope.md'), false, 'Detailed retrieval resource should not load for every normal task');

const profile = {
  isWordPress:true,
  childThemes:[{ slug:'project-child', template:'bricks', root:'wp-content/themes/project-child' }],
  parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }],
  customPlugins:[{ slug:'project-tools', root:'wp-content/plugins/project-tools' }]
};

const candidates = [
  { path:'wp-includes/class-wp-query.php', score:100 },
  { path:'wp-content/themes/bricks/includes/elements/container.php', score:99 },
  { path:'wp-content/plugins/woocommerce/includes/class-wc-cart.php', score:98 },
  { path:'wp-content/themes/project-child/inc/header.php', score:90 },
  { path:'wp-content/plugins/project-tools/project-tools.php', score:88 },
  { path:'package.json', score:80 },
  { path:'wp-content/uploads/debug.txt', score:70 }
];

assert.equal(classifyWordPressPath('wp-content/themes/project-child/functions.php', profile), 'child-theme');
assert.equal(classifyWordPressPath('wp-content/themes/bricks/functions.php', profile), 'parent-theme');
assert.equal(classifyWordPressPath('wp-content/plugins/woocommerce/woocommerce.php', profile), 'woocommerce-core');
assert.equal(classifyWordPressPath('wp-includes/plugin.php', profile), 'wordpress-core');

const normal = planWordPressRetrieval(candidates, profile, 'Fix the mobile header', 8);
assert.equal(normal.scope.strategy, 'wordpress-scope-first');
assert.equal(normal.scope.content_limit, 6);
assert.deepEqual(normal.files.map(item => item.path), [
  'wp-content/themes/project-child/inc/header.php',
  'wp-content/plugins/project-tools/project-tools.php'
]);
assert.deepEqual(normal.scope.expanded_to, []);
assert.equal(normal.files.some(item => /wp-includes|themes\/bricks|plugins\/woocommerce|package\.json/.test(item.path)), false);

const checkout = planWordPressRetrieval(candidates, profile, 'Fix WooCommerce checkout styling in the child theme', 6);
assert.equal(checkout.files.some(item => item.path.includes('plugins/woocommerce/')), false, 'Normal Woo task must not auto-read Woo core');
assert.equal(checkout.files.some(item => item.path.includes('themes/project-child/')), true);

const bricksReference = planWordPressRetrieval(candidates, profile, 'Verify the native Bricks control API in the Bricks parent theme', 6);
assert.equal(bricksReference.files.some(item => item.path.includes('themes/bricks/')), true);
assert.ok(bricksReference.scope.expanded_to.includes('parent-theme'));
assert.equal(bricksReference.files.some(item => item.path.startsWith('wp-includes/')), false);

const wpCoreReference = planWordPressRetrieval(candidates, profile, 'Inspect wp-includes WordPress core hook implementation', 6);
assert.equal(wpCoreReference.files.some(item => item.path.startsWith('wp-includes/')), true);
assert.ok(wpCoreReference.scope.expanded_to.includes('wordpress-core'));

const parentOnly = planWordPressRetrieval([
  { path:'wp-content/themes/bricks/includes/elements/text.php', score:10 },
  { path:'wp-includes/plugin.php', score:9 }
], profile, 'Continue investigating this behavior', 6);
assert.deepEqual(parentOnly.files.map(item => item.path), ['wp-content/themes/bricks/includes/elements/text.php']);
assert.ok(parentOnly.scope.expanded_to.includes('parent-theme:no-scoped-candidate'));

const nonWp = planWordPressRetrieval([{ path:'src/a.js' }, { path:'src/b.js' }, { path:'src/c.js' }], { isWordPress:false }, 'fix', 2);
assert.deepEqual(nonWp.files.map(item => item.path), ['src/a.js', 'src/b.js']);
assert.equal(nonWp.scope.strategy, 'project-ranked');

(async () => {
  let activeReads = 0;
  let maxActiveReads = 0;
  const concurrent = await readRelevantFiles({
    readFile:async (_ref, rel) => {
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeReads--;
      return { content:`parallel:${rel}` };
    }
  }, 'p1', [{ path:'a.php' }, { path:'b.php' }, { path:'c.php' }]);
  assert.equal(maxActiveReads, 3, 'scoped context files should be read concurrently');
  assert.deepEqual(concurrent.map(item => item.path), ['a.php','b.php','c.php'], 'concurrent reads must preserve ranked order');

  const readPaths = [];
  const contextLimits = [];
  let searchCalls = 0;
  const fakeApi = {
    projectContext:async (_ref, _query, limit) => { contextLimits.push(limit); return { files:candidates, relations:[] }; },
    projectBrain:async () => ({
      frameworks:[{ name:'WordPress' }, { name:'Bricks' }],
      framework_names:['WordPress', 'Bricks'],
      primary_language:'PHP',
      entrypoints:[], wordpress:profile, topSymbols:[]
    }),
    search:async (_ref, query) => {
      searchCalls++;
      if (/bricks/i.test(query)) return [{ path:'wp-content/themes/bricks/includes/elements/container.php', score:120 }];
      if (/wp-includes/i.test(query)) return [{ path:'wp-includes/class-wp-query.php', score:120 }];
      return [];
    },
    readFile:async (_ref, rel) => { readPaths.push(rel); return { content:`content:${rel}` }; },
    gitStatus:async () => ({ ok:false, stderr:'not a git repository' })
  };
  const store = { getProject:() => ({ id:'p1', name:'fixture', permissions:{ read:true } }) };
  const inspect = createScopedInspect(fakeApi, store);
  const inspected = await inspect('p1', 'Fix the mobile header', 8);
  assert.equal(contextLimits[0], 8);
  assert.deepEqual(readPaths, [
    'wp-content/themes/project-child/inc/header.php',
    'wp-content/plugins/project-tools/project-tools.php'
  ], 'inspectProject must not content-read broad/core candidates');
  assert.equal(searchCalls, 0, 'ordinary WordPress inspect must not run a broad fallback search');
  assert.equal(inspected.relevant_files.length, 2);
  assert.equal(inspected.retrieval_scope.strategy, 'wordpress-scope-first');
  assert.equal(inspected.retrieval_scope.explicit_expansion_search, false);
  assert.ok(inspected.retrieval_scope.omitted_count >= 5);

  readPaths.length = 0;
  const micro = await inspect('p1', 'Giảm spacing product card trên mobile 8px', 3);
  assert.equal(contextLimits[1], 3, 'micro inspect budget must reach Project Brain retrieval unchanged');
  assert.ok(micro.relevant_files.length <= 3, 'micro inspect must not content-read above its three-file budget');
  assert.ok(readPaths.length <= 3);

  readPaths.length = 0;
  const explicitParent = await inspect('p1', 'Verify the native Bricks control API in the Bricks parent theme', 8);
  assert.equal(searchCalls, 1, 'explicit Bricks parent evidence should unlock one broad search pass');
  assert.equal(explicitParent.retrieval_scope.explicit_expansion_search, true);
  assert.ok(explicitParent.retrieval_scope.explicit_expansion_flags.includes('bricksParent'));
  assert.ok(explicitParent.relevant_files.some(item => item.path.includes('wp-content/themes/bricks/')), 'explicit expansion must be able to read the parent reference');

  const hintReads = [];
  const hints = await verificationHints({
    readFile:async (_ref, rel) => { hintReads.push(rel); return { content:'{}' }; }
  }, 'p1', inspected);
  assert.equal(hintReads.includes('package.json'), false, 'Ordinary WordPress task must not probe root package.json for verification hints');
  assert.ok(hints.some(item => item.kind === 'changed-file-syntax'));

  const agentReads = [];
  const agentInspect = {
    ...inspected,
    project:{ id:'p1', name:'fixture' },
    wordpress:profile,
    frameworks:[{ name:'WordPress' }, { name:'Bricks' }],
    framework_names:['WordPress', 'Bricks']
  };
  const prepared = await createAgentRuntime({
    startWork:async () => ({ work_session_id:'work-1', project_id:'p1', workspace_mode:'trusted', baseline:{} }),
    inspectProject:async () => agentInspect,
    readFile:async (_ref, rel) => { agentReads.push(rel); return { content:'{}' }; }
  }).prepareTask('p1', 'Fix the mobile header', 8);
  assert.equal(agentReads.includes('package.json'), false);
  assert.equal(prepared.context.retrieval_scope.strategy, 'wordpress-scope-first');
  assert.ok(prepared.context.relevant_files.length <= 6);
  assert.ok(prepared.agent_contract.guidance.some(line => /retrieval_scope/.test(line)));

  console.log('WordPress scope-first retrieval smoke test: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
