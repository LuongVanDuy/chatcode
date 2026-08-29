const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { planWordPressRetrieval, classifyWordPressPath } = require('../core/wordpress-retrieval');
const { createScopedInspect } = require('../core/retrieval-scope');
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
  const readPaths = [];
  const fakeApi = {
    projectContext:async () => ({ files:candidates, relations:[] }),
    projectBrain:async () => ({
      frameworks:[{ name:'WordPress' }, { name:'Bricks' }],
      framework_names:['WordPress', 'Bricks'],
      primary_language:'PHP',
      entrypoints:[], wordpress:profile, topSymbols:[]
    }),
    readFile:async (_ref, rel) => { readPaths.push(rel); return { content:`content:${rel}` }; },
    gitStatus:async () => ({ ok:false, stderr:'not a git repository' })
  };
  const store = { getProject:() => ({ id:'p1', name:'fixture', permissions:{ read:true } }) };
  const inspected = await createScopedInspect(fakeApi, store)('p1', 'Fix the mobile header', 8);
  assert.deepEqual(readPaths, [
    'wp-content/themes/project-child/inc/header.php',
    'wp-content/plugins/project-tools/project-tools.php'
  ], 'inspectProject must not content-read broad/core candidates');
  assert.equal(inspected.relevant_files.length, 2);
  assert.equal(inspected.retrieval_scope.strategy, 'wordpress-scope-first');
  assert.ok(inspected.retrieval_scope.omitted_count >= 5);

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
