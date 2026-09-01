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
    { path:'wp-content/themes/fixture-child/assets/css/home.css', score:100, symbols:[] },
    { path:'wp-content/themes/fixture-child/assets/css/main.css', score:98, symbols:[] },
    { path:'wp-content/themes/fixture-child/assets/css/header-footer.css', score:96, symbols:[] },
    { path:'wp-content/themes/fixture-child/assets/css/products.css', score:94, symbols:[] },
    { path:'wp-content/themes/fixture-child/inc/product/card.php', score:92, symbols:[{ name:'eup_product_card', kind:'function', line:10 }] },
    { path:'wp-content/themes/fixture-child/elements/featured-products.php', score:90, symbols:[{ name:'Featured_Products_Element', kind:'class', line:5 }] },
    { path:'wp-content/themes/fixture-child/inc/templates/header.php', score:88, symbols:[] },
    { path:'wp-content/themes/fixture-child/inc/templates/footer.php', score:86, symbols:[] },
    { path:'wp-content/themes/fixture-child/inc/product/post-type.php', score:84, symbols:[] }
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

console.log('Owner Resolver smoke test: PASS (primary preference + evidence-backed companion owner set + Fast scope gate)');
