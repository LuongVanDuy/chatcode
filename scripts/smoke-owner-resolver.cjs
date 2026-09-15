const assert = require('assert/strict');
const { ownershipMap, OWNER_STATUS } = require('../core/owner-resolver');
const { buildTaskCard, validatePatchAgainstTaskCard, EXECUTION_PATHS } = require('../core/task-planner');

const inspect = {
  project:{ id:'owner-fixture', name:'Owner Fixture' },
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder' }],
  framework_names:['WordPress','Bricks Builder'],
  primary_language:'PHP',
  wordpress:{
    isWordPress:true,
    woocommerce:false,
    childThemes:[{ slug:'fixture-child', template:'bricks', root:'wp-content/themes/fixture-child' }],
    parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }]
  },
  relevant_files:[
    { path:'wp-content/plugins/duyanhwebpro/modules/multilingual/class-multilingual.php', score:200, content:'<?php class Bricks_Multilingual_Element {}', symbols:[{ name:'Bricks_Multilingual_Element', kind:'class', line:5 }] },
    { path:'wp-content/themes/fixture-child/assets/css/home.css', score:100, content:'.home-hero{max-width:1200px}', symbols:[] },
    { path:'wp-content/themes/fixture-child/assets/css/main.css', score:98, content:':root{--container:1200px}', symbols:[] },
    { path:'wp-content/themes/fixture-child/assets/css/header-footer.css', score:96, content:'.site-header{display:flex}', symbols:[] },
    { path:'wp-content/themes/fixture-child/assets/css/products.css', score:94, content:'.product-card{display:grid;gap:16px}', symbols:[] },
    { path:'wp-content/themes/fixture-child/inc/product/card.php', score:92, content:"<?php function eup_product_card(){ echo '<article class=\"product-card\"></article>'; }", symbols:[{ name:'eup_product_card', kind:'function', line:10 }] },
    { path:'wp-content/themes/fixture-child/elements/featured-products.php', score:90, content:'<?php class Featured_Products_Element {}', symbols:[{ name:'Featured_Products_Element', kind:'class', line:5 }] },
    { path:'wp-content/themes/fixture-child/inc/templates/header.php', score:88, content:'<?php // header template', symbols:[] },
    { path:'wp-content/themes/fixture-child/inc/templates/footer.php', score:86, content:'<?php // footer template', symbols:[] },
    { path:'wp-content/themes/fixture-child/inc/product/post-type.php', score:84, content:"<?php register_post_type('eup_product', []);", symbols:[] }
  ],
  top_symbols:[
    { name:'eup_product_card', kind:'function', path:'wp-content/themes/fixture-child/inc/product/card.php', line:10 }
  ],
  relevant_relations:[],
  git:null
};

const profile = {
  version:1,
  facts:{
    cms:'wordpress',
    builder:'bricks',
    commerce:'custom_cpt',
    product_model:'eup_product',
    child_theme_root:'wp-content/themes/fixture-child',
    global_css_owner:'wp-content/themes/fixture-child/assets/css/main.css',
    shared_product_renderer:'eup_product_card'
  },
  decisions:[]
};

const globalOwner = ownershipMap({ request:'Đổi font toàn site', inspect, projectProfile:profile });
assert.equal(globalOwner.primary.kind, 'global_css');
assert.equal(globalOwner.primary.status, OWNER_STATUS.CONFIRMED);
assert.deepEqual(globalOwner.enforce_paths, ['wp-content/themes/fixture-child/assets/css/main.css']);

const homeOwner = ownershipMap({ request:'Sửa width container trang chủ', inspect, projectProfile:profile });
assert.equal(homeOwner.primary.kind, 'homepage_css');
assert.equal(homeOwner.primary.status, OWNER_STATUS.DETECTED);
assert.ok(homeOwner.primary.path.endsWith('/assets/css/home.css'));
assert.ok(homeOwner.entries.some(item => item.kind === 'global_css'));
assert.deepEqual(new Set(homeOwner.enforce_paths), new Set([
  'wp-content/themes/fixture-child/assets/css/home.css',
  'wp-content/themes/fixture-child/assets/css/main.css'
]));
assert.equal(homeOwner.owner_set_mode, 'any-evidence-backed-owner');

const productOwner = ownershipMap({ request:'Dùng chung product card hiện tại ở trang chủ', inspect, projectProfile:profile });
assert.equal(productOwner.primary.kind, 'product_renderer');
assert.equal(productOwner.primary.status, OWNER_STATUS.CONFIRMED);
assert.equal(productOwner.primary.symbol, 'eup_product_card');
assert.ok(productOwner.primary.path.endsWith('/inc/product/card.php'));

const productStyleOwner = ownershipMap({ request:'Sửa spacing CSS của product card', inspect, projectProfile:profile });
assert.equal(productStyleOwner.primary.kind, 'product_css');
assert.ok(productStyleOwner.primary.path.endsWith('/assets/css/products.css'));
assert.ok(productStyleOwner.entries.some(item => item.kind === 'product_renderer'));
assert.equal(productStyleOwner.primary.source, 'project-relation', 'renderer-selector relation should strengthen CSS ownership');

const headerStyle = ownershipMap({ request:'Sửa spacing header trên mobile', inspect, projectProfile:profile });
assert.equal(headerStyle.primary.kind, 'header_css');
assert.ok(headerStyle.primary.path.endsWith('/assets/css/header-footer.css'));
assert.ok(headerStyle.entries.some(item => item.kind === 'global_css'));
assert.equal(headerStyle.entries.some(item => item.kind === 'header_template'), false, 'header template must not be an allowed owner for a Fast styling task');

const headerTemplate = ownershipMap({ request:'Sửa Bricks Header template hiện tại', inspect, projectProfile:profile });
assert.equal(headerTemplate.primary.kind, 'header_template');
assert.ok(headerTemplate.primary.path.endsWith('/inc/templates/header.php'));

const builderComponent = ownershipMap({ request:'Thêm Builder controls cho Featured Products', inspect, projectProfile:profile });
assert.equal(builderComponent.primary.kind, 'builder_component');
assert.ok(builderComponent.primary.path.endsWith('/elements/featured-products.php'));

const dataOwner = ownershipMap({ request:'Sửa đăng ký CPT sản phẩm hiện tại', inspect, projectProfile:profile });
assert.equal(dataOwner.primary.kind, 'data_model');
assert.ok(dataOwner.primary.path.endsWith('/inc/product/post-type.php'));

const explicitPath = 'wp-content/themes/bricks-child/.chatcode-v15-smoke.txt';
const explicitRequest = `Tạo đúng file \`${explicitPath}\`, ghi một dòng data tạm rồi rollback thay đổi file.`;
const explicitOwner = ownershipMap({ request:explicitRequest, inspect, projectProfile:profile, taskType:'FAST_UI' });
assert.equal(explicitOwner.primary.kind, 'explicit_path');
assert.equal(explicitOwner.primary.path, explicitPath);
assert.equal(explicitOwner.primary.status, OWNER_STATUS.CONFIRMED);
assert.equal(explicitOwner.primary.confidence, 1);
assert.equal(explicitOwner.requires_owner_read, false);
assert.equal(explicitOwner.owner_set_mode, 'explicit-user-path');
assert.equal(explicitOwner.entries.some(item => /duyanhwebpro/.test(item.path || '')), false, 'explicit new file must not inherit unrelated plugin owner');

const canonicalRelative = ownershipMap({ request:'Sửa `assets/css/products.css` cho product card', inspect, projectProfile:profile, taskType:'FAST_UI' });
assert.equal(canonicalRelative.primary.kind, 'explicit_path');
assert.equal(canonicalRelative.primary.path, 'wp-content/themes/fixture-child/assets/css/products.css', 'relative user path must canonicalize to unique current project path');
assert.equal(canonicalRelative.primary.status, OWNER_STATUS.CONFIRMED);

const explicitCard = buildTaskCard({ request:explicitRequest, inspect, projectProfile:profile, projectRules:[] });
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
assert.equal(homeCard.version, 3);
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
assert.equal(unrelatedCheck.ok, false, 'Home task must still reject unrelated ownership');
assert.ok(unrelatedCheck.violations.some(item => /bypasses resolved homepage_css/i.test(item)));

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

console.log('Owner Resolver smoke test: PASS (canonical paths + responsibility graph > semantic ranking + Fast scope gate)');
