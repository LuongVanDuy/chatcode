const assert = require('assert/strict');
const { ownershipMap, OWNER_STATUS } = require('../core/owner-resolver');
const { buildTaskCard, validatePatchAgainstTaskCard, EXECUTION_PATHS, GUARD_SEVERITY } = require('../core/task-planner');

const inspect = {
  project:{ id:'p1', name:'fixture' },
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder' }],
  framework_names:['WordPress','Bricks Builder'],
  wordpress:{
    isWordPress:true,
    childThemes:[{ slug:'fixture-child', template:'bricks', root:'wp-content/themes/fixture-child' }],
    parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }]
  },
  relevant_files:[
    { path:'wp-content/themes/fixture-child/assets/css/main.css', score:100, content:':root{}', symbols:[] },
    { path:'wp-content/themes/fixture-child/assets/css/home.css', score:98, content:'.home{}', symbols:[] },
    { path:'wp-content/themes/fixture-child/assets/css/products.css', score:95, content:'.product{}', symbols:[] },
    { path:'wp-content/themes/fixture-child/elements/featured-products.php', score:92, content:'<?php', symbols:[{type:'class',name:'Featured_Products'}] },
    { path:'wp-content/themes/fixture-child/inc/product/post-type.php', score:90, content:'<?php', symbols:[{type:'function',name:'register_catalog'}] },
    { path:'wp-content/themes/fixture-child/functions.php', score:85, content:'<?php', symbols:[] }
  ],
  top_symbols:[],
  relevant_relations:[]
};
const profile = {
  version:1,
  facts:{
    cms:'wordpress', builder:'bricks', child_theme_root:'wp-content/themes/fixture-child',
    global_css_owner:'wp-content/themes/fixture-child/assets/css/main.css',
    shared_product_renderer:'Featured_Products'
  },
  decisions:[]
};

const globalOwner = ownershipMap({ request:'Đổi font toàn site', inspect, projectProfile:profile });
assert.equal(globalOwner.primary.kind, 'global_css');
assert.equal(globalOwner.primary.status, OWNER_STATUS.CONFIRMED);
assert.deepEqual(globalOwner.enforce_paths, ['wp-content/themes/fixture-child/assets/css/main.css']);

const homeOwner = ownershipMap({ request:'Sửa width container trang chủ', inspect, projectProfile:profile });
assert.equal(homeOwner.primary.kind, 'homepage_css');
assert.ok([OWNER_STATUS.DETECTED,OWNER_STATUS.CONFIRMED].includes(homeOwner.primary.status));
assert.ok(homeOwner.primary.path.endsWith('/assets/css/home.css'));
assert.ok(homeOwner.entries.some(item => item.kind === 'global_css'));
assert.deepEqual(new Set(homeOwner.enforce_paths), new Set([
  'wp-content/themes/fixture-child/assets/css/home.css',
  'wp-content/themes/fixture-child/assets/css/main.css'
]));

const productOwner = ownershipMap({ request:'Sửa layout product card', inspect, projectProfile:profile });
assert.equal(productOwner.primary.kind, 'product_renderer');
assert.equal(productOwner.primary.status, OWNER_STATUS.CONFIRMED);
assert.equal(productOwner.primary.symbol, 'Featured_Products');

const explicitPath = 'wp-content/themes/fixture-child/assets/css/special.css';
const explicitInspect = { ...inspect, relevant_files:[...inspect.relevant_files,{path:explicitPath,score:20,content:'.special{}',symbols:[]}] };
const explicitRequest = `Sửa file ${explicitPath} cho đúng layout`;
const explicit = ownershipMap({ request:explicitRequest, inspect:explicitInspect, projectProfile:profile });
assert.equal(explicit.primary.kind, 'explicit_path');
assert.equal(explicit.primary.status, OWNER_STATUS.CONFIRMED);
assert.equal(explicit.primary.path, explicitPath);
assert.equal(explicit.owner_set_mode, 'explicit-user-path');

const canonicalRequest = 'Sửa file assets/css/special.css cho đúng layout';
const canonical = ownershipMap({ request:canonicalRequest, inspect:explicitInspect, projectProfile:profile });
assert.equal(canonical.primary.kind,'explicit_path');
assert.equal(canonical.primary.status,OWNER_STATUS.CONFIRMED);
assert.equal(canonical.primary.path,explicitPath,'unique relative suffix must canonicalize to actual project path');

const unresolvedRelative = ownershipMap({ request:'Sửa file assets/css/missing.css cho đúng layout', inspect:explicitInspect, projectProfile:profile });
assert.equal(unresolvedRelative.primary.kind,'explicit_path');
assert.equal(unresolvedRelative.primary.status,OWNER_STATUS.CANDIDATE,'unresolved relative pseudo-path must not be treated as confirmed owner');
assert.equal(unresolvedRelative.requires_owner_read,true);

const explicitCard = buildTaskCard({ request:explicitRequest, inspect:explicitInspect, projectProfile:profile, projectRules:[] });
assert.equal(explicitCard.execution.path, EXECUTION_PATHS.FAST);
assert.equal(explicitCard.owner.kind, 'explicit_path');
assert.equal(explicitCard.owner.primary_path, explicitPath);
assert.deepEqual(explicitCard.owner.candidates, []);
assert.deepEqual(explicitCard.owner.enforce_paths, [explicitPath]);
assert.equal(explicitCard.owner.requires_read, false);
assert.equal(explicitCard.expected_files[0], explicitPath);

const explicitPatch = [
  '--- /dev/null',
  `+++ b/${explicitPath}`,
  '@@ -0,0 +1 @@',
  '+chatcode-v15-smoke',
  ''
].join('\n');
assert.equal(validatePatchAgainstTaskCard(explicitCard, explicitPatch).ok, true, 'explicit-path file creation must pass Fast scope gate');

const homeCard = buildTaskCard({ request:'Sửa width container trang chủ', inspect, projectProfile:profile, projectRules:[] });
assert.equal(homeCard.version, 4);
assert.equal(homeCard.execution.path, EXECUTION_PATHS.FAST);
assert.equal(homeCard.owner.kind, 'homepage_css');
assert.deepEqual(new Set(homeCard.owner.enforce_paths), new Set([
  'wp-content/themes/fixture-child/assets/css/home.css',
  'wp-content/themes/fixture-child/assets/css/main.css'
]));
assert.ok(homeCard.ownership_map.length <= 8);
assert.equal(homeCard.expected_files[0], 'wp-content/themes/fixture-child/assets/css/home.css');

const globalOnlyPatch = [
  '--- a/wp-content/themes/fixture-child/assets/css/main.css',
  '+++ b/wp-content/themes/fixture-child/assets/css/main.css',
  '@@ -1 +1 @@',
  '-:root{}',
  '+:root{--container:1200px}',
  ''
].join('\n');
assert.equal(validatePatchAgainstTaskCard(homeCard, globalOnlyPatch).ok, true, 'Home task may resolve to the global owner when the root cause is a shared token');

const homeOnlyPatch = [
  '--- a/wp-content/themes/fixture-child/assets/css/home.css',
  '+++ b/wp-content/themes/fixture-child/assets/css/home.css',
  '@@ -1 +1 @@',
  '-.home{}',
  '+.home{max-width:1200px}',
  ''
].join('\n');
assert.equal(validatePatchAgainstTaskCard(homeCard, homeOnlyPatch).ok, true);

const bothOwnersPatch = [
  '--- a/wp-content/themes/fixture-child/assets/css/main.css',
  '+++ b/wp-content/themes/fixture-child/assets/css/main.css',
  '@@ -1 +1 @@',
  '-:root{}',
  '+:root{--container:1200px}',
  '--- a/wp-content/themes/fixture-child/assets/css/home.css',
  '+++ b/wp-content/themes/fixture-child/assets/css/home.css',
  '@@ -1 +1 @@',
  '-.home{}',
  '+.home{padding:24px}',
  ''
].join('\n');
assert.equal(validatePatchAgainstTaskCard(homeCard, bothOwnersPatch).ok, true);

const unrelatedPatch = [
  '--- a/wp-content/themes/fixture-child/assets/css/products.css',
  '+++ b/wp-content/themes/fixture-child/assets/css/products.css',
  '@@ -1 +1 @@',
  '-.product{}',
  '+.product{max-width:1200px}',
  ''
].join('\n');
const unrelatedCheck = validatePatchAgainstTaskCard(homeCard, unrelatedPatch);
assert.equal(unrelatedCheck.ok, true, 'Owner mismatch is recoverable and should request targeted evidence rather than hard-block the entire task');
assert.equal(unrelatedCheck.severity, GUARD_SEVERITY.SOFT);
assert.equal(unrelatedCheck.requires_targeted_read, true);
assert.ok(unrelatedCheck.soft_guards.some(item => /bypass|owner|ranked/i.test(item)));

const relationInspect = {
  ...inspect,
  relevant_files:[
    { path:'wp-content/plugins/seo-suite/src/catalogue-product-analysis.php', score:500, content:'<?php // huge product SEO module', symbols:[] },
    { path:'wp-content/plugins/multilingual-suite/src/product-translation.php', score:450, content:'<?php // huge translation module', symbols:[] },
    {
      path:'wp-content/themes/fixture-child/functions.php', score:80, symbols:[],
      content:"<?php if ( is_page( 'san-pham' ) ) { wp_enqueue_style( 'catalogue-layout', get_stylesheet_directory_uri() . '/assets/css/catalogue-layout.css' ); }"
    },
    {
      path:'wp-content/themes/fixture-child/inc/catalogue/render.php', score:75, symbols:[],
      content:"<?php echo '<article class=\"catalogue-card product-card\"></article>';"
    },
    {
      path:'wp-content/themes/fixture-child/assets/css/catalogue-layout.css', score:40, symbols:[],
      content:'.catalogue-card.product-card{display:grid;gap:16px}'
    }
  ],
  top_symbols:[],
  relevant_relations:[]
};
const relationProfile = { version:1, facts:{ cms:'wordpress', builder:'bricks', child_theme_root:'wp-content/themes/fixture-child' }, decisions:[] };
const responsibilityOwner = ownershipMap({
  request:'Increase spacing between product cards on catalogue page.',
  inspect:relationInspect,
  projectProfile:relationProfile,
  fallbackCandidates:relationInspect.relevant_files,
  taskType:'FAST_UI'
});
assert.equal(responsibilityOwner.primary.kind,'product_css');
assert.equal(responsibilityOwner.primary.path,'wp-content/themes/fixture-child/assets/css/catalogue-layout.css');
assert.equal(responsibilityOwner.primary.status,OWNER_STATUS.CONFIRMED);
assert.ok(responsibilityOwner.primary.confidence >= 0.98);
assert.equal(responsibilityOwner.primary.source,'project-relation');
assert.equal(/plugins\//.test(responsibilityOwner.primary.path),false,'large generic plugin must not beat direct stylesheet responsibility');

console.log('Owner Resolver smoke test: PASS (canonical paths + responsibility graph + soft targeted-read ownership guard)');
