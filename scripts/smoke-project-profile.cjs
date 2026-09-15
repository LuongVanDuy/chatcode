const assert = require('assert/strict');
const {
  normalizeDecisions,
  normalizeProjectProfile,
  deriveProjectFacts,
  refreshProjectProfile,
  saveProjectDecisions,
  projectProfileContext
} = require('../core/project-profile');

function makeStore(project) {
  let state = { projects:[project] };
  let writes = 0;
  return {
    read:() => JSON.parse(JSON.stringify(state)),
    write(next) { state = JSON.parse(JSON.stringify(next)); writes++; },
    getProject(ref) {
      const found = state.projects.find(item => item.id === ref || item.name === ref);
      if (!found) throw new Error('missing project');
      return JSON.parse(JSON.stringify(found));
    },
    snapshot:() => JSON.parse(JSON.stringify(state)),
    writes:() => writes
  };
}

const legacy = [
  { key:'global-css-owner', value:'assets/css/main.css', updatedAt:'2026-01-01T00:00:00.000Z' },
  { key:'reuse-product-card', value:'Use the existing shared product renderer.', updatedAt:'2026-01-02T00:00:00.000Z' }
];
const migrated = normalizeProjectProfile({}, legacy);
assert.equal(migrated.decisions.length, 2, 'legacy projectRules must migrate into projectProfile.decisions');
assert.equal(migrated.decisions.find(item => item.key === 'global-css-owner').value, 'assets/css/main.css');

const normalized = normalizeDecisions([
  { key:'layout-rule', value:'old' },
  { key:'layout-rule', value:'new' },
  { key:'api-token', value:'do-not-store' },
  { key:'private-url', value:'https://example.invalid' }
]);
assert.deepEqual(normalized.map(item => [item.key,item.value]), [['layout-rule','new']], 'decisions must overwrite by key and reject secrets/URLs');

const cptInspect = {
  primary_language:'PHP',
  framework_names:['WordPress','Bricks'],
  frameworks:[{ name:'WordPress' }, { name:'Bricks' }],
  wordpress:{
    isWordPress:true,
    woocommerce:false,
    childThemes:[{ slug:'eupharma-child', name:'EU Pharma Child', template:'bricks', version:'9.9.9', root:'wp-content/themes/eupharma-child' }],
    parentThemes:[{ slug:'bricks', name:'Bricks', version:'2.3.13', root:'wp-content/themes/bricks' }]
  },
  relevant_files:[
    { path:'wp-content/themes/eupharma-child/functions.php', content:"<?php register_post_type('eup_product', []); function eup_product_card() {}" },
    { path:'wp-content/themes/eupharma-child/assets/css/main.css', content:':root{--primary:#123;}' }
  ],
  top_symbols:[{ name:'eup_product_card', kind:'function' }]
};
const derived = deriveProjectFacts(cptInspect, {}, { root:'D:/Sites/eupharma' });
assert.equal(derived.facts.cms, 'wordpress');
assert.equal(derived.facts.builder, 'bricks');
assert.equal(derived.facts.bricks_version, '2.3.13', 'parent Bricks version must win over child theme version');
assert.equal(derived.facts.commerce, 'custom_cpt');
assert.equal(derived.facts.product_model, 'eup_product');
assert.equal(derived.facts.child_theme, 'eupharma-child');
assert.equal(derived.facts.parent_theme, 'bricks');
assert.equal(derived.facts.global_css_owner, 'wp-content/themes/eupharma-child/assets/css/main.css');
assert.equal(derived.facts.shared_product_renderer, 'eup_product_card');
assert.equal(derived.facts.source, 'local');
assert.equal(Object.prototype.hasOwnProperty.call(derived.facts, 'database'), false, 'unknown DB availability must not be guessed');
assert.equal(Object.prototype.hasOwnProperty.call(derived.facts, 'production_deploy'), false, 'unknown deploy state must not be guessed');
assert.equal(Object.prototype.hasOwnProperty.call(derived.facts, 'php_runtime'), false, 'unknown runtime path must not be guessed');

const wooInspect = {
  ...cptInspect,
  wordpress:{ ...cptInspect.wordpress, woocommerce:true },
  relevant_files:[{ path:'wp-content/themes/eupharma-child/functions.php', content:'<?php // Woo project' }],
  top_symbols:[]
};
const wooDerived = deriveProjectFacts(wooInspect, derived.facts, { root:'D:/Sites/eupharma' });
assert.equal(wooDerived.facts.commerce, 'woocommerce', 'fresh Woo evidence must supersede stale CPT commerce fact');
assert.equal(wooDerived.facts.product_model, 'wc_product');

const mixedInspect = {
  ...cptInspect,
  wordpress:{ ...cptInspect.wordpress, woocommerce:true },
  relevant_files:[
    { path:'wp-content/themes/eupharma-child/inc/content-types/products.php', content:"<?php register_post_type('eup_product', []);" },
    { path:'wp-content/plugins/woocommerce/woocommerce.php', content:'<?php // Woo active' }
  ],
  top_symbols:[]
};
const mixedNoDecision = deriveProjectFacts(mixedInspect, { builder:'bricks' }, { root:'D:/Sites/eupharma' });
assert.equal(mixedNoDecision.facts.commerce, 'woocommerce');
assert.equal(mixedNoDecision.facts.product_model, 'mixed_unresolved', 'Woo + product-like CPT must not be guessed as wc_product');

const mixedDecision = deriveProjectFacts(
  mixedInspect,
  { builder:'bricks', product_model:'wc_product' },
  { root:'D:/Sites/eupharma' },
  [{ key:'primary-product-model', value:'Catalogue uses CPT eup_product, not WooCommerce product.' }]
);
assert.equal(mixedDecision.facts.commerce, 'woocommerce');
assert.equal(mixedDecision.facts.product_model, 'eup_product', 'durable product-model decision must beat weak Woo inference');

const store = makeStore({ id:'p1', name:'Profile Fixture', root:'D:/Sites/eupharma', projectRules:legacy });
const first = refreshProjectProfile(store, 'p1', cptInspect);
assert.equal(first.facts.product_model, 'eup_product');
assert.equal(first.decisions.length, 2);
assert.equal(store.writes(), 1, 'first detected facts should persist once');
refreshProjectProfile(store, 'p1', cptInspect);
assert.equal(store.writes(), 1, 'unchanged inspection must not rewrite profile on every task');

const saved = saveProjectDecisions(store, 'p1', [
  { key:'reuse-product-card', value:'Always call eup_product_card().' },
  { key:'checkout-policy', value:'Keep checkout labels compact.' },
  { key:'password', value:'never-store-me' }
]);
assert.equal(saved.decisions.filter(item => item.key === 'reuse-product-card').length, 1, 'decision key must overwrite rather than append');
assert.equal(saved.decisions.find(item => item.key === 'reuse-product-card').value, 'Always call eup_product_card().');
assert.equal(saved.decisions.some(item => item.key === 'password'), false);
const persisted = store.snapshot().projects[0];
assert.deepEqual(persisted.projectRules, persisted.projectProfile.decisions, 'legacy projectRules alias must mirror profile decisions');

const uiContext = projectProfileContext(saved, 'Fix product card spacing on homepage', 'FAST_UI', ['reuse-product-card']);
assert.equal(uiContext.facts.builder, 'bricks');
assert.equal(uiContext.facts.product_model, 'eup_product');
assert.equal(uiContext.facts.global_css_owner, 'wp-content/themes/eupharma-child/assets/css/main.css');
assert.equal(uiContext.facts.shared_product_renderer, 'eup_product_card');
assert.deepEqual(uiContext.decisions.map(item => item.key), ['reuse-product-card']);
assert.equal(Object.prototype.hasOwnProperty.call(uiContext.facts, 'production_deploy'), false);
assert.ok(JSON.stringify(uiContext).length < 3000, 'task profile context should stay compact');

console.log('Project Profile smoke test: PASS (shared Bricks version detector + mixed Woo/CPT + durable decisions + relevant-only context)');
