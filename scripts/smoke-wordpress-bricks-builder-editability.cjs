const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chooseResources, loadWordPressBricksSkill, MAX_SKILL_CONTEXT_CHARS } = require('../core/skill-runtime');

const root = path.join(__dirname, '..');
const skillRoot = path.join(root, 'CHATCODE-GPT', 'skills', 'wordpress-bricks');
const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'manifest.json'), 'utf8'));
const builderText = fs.readFileSync(path.join(skillRoot, 'resources', 'builder-editability.md'), 'utf8').toLowerCase();
const organizationText = fs.readFileSync(path.join(skillRoot, 'resources', 'code-organization.md'), 'utf8').toLowerCase();

assert.ok(builderText.includes('native first, custom element second, shortcode wrapper last'));
assert.ok(builderText.includes('a custom element is incomplete if changing its ordinary content still requires editing php'));
assert.ok(builderText.includes('source: automatic | manual'));
assert.ok(builderText.includes('repeatable content pattern'));
assert.ok(builderText.includes('shortcode-to-element migration'));
assert.ok(builderText.includes('shared product-item renderer'));
assert.ok(organizationText.includes('page css: group page-owned sections instead of file-per-section sprawl'));
assert.ok(organizationText.includes('assets/css/home.css'));

function route(request, inspect) { return chooseResources(manifest, request, inspect); }
function expectOneDomain(request, domain, inspect) {
  const selected = route(request, inspect);
  assert.deepEqual(selected, ['resources/core-checklist.md', domain]);
  assert.equal(selected.includes('resources/snippets.md'), false);
  assert.equal(selected.includes('resources/patterns.md'), false);
}

// Legacy chooseResources stays stable for compatibility.
assert.deepEqual(route('Change one phone number in a Bricks project'), ['resources/core-checklist.md']);
expectOneDomain('Create a reusable custom Bricks Element with Builder controls and scoped AJAX behavior', 'resources/builder-editability.md');
expectOneDomain('Refactor Featured Products into a custom Bricks Element with Automatic or Manual source and manual product multi-select', 'resources/builder-editability.md');
expectOneDomain('Make product group tabs configurable in Builder with taxonomy selector, terms and repeater controls', 'resources/builder-editability.md');
expectOneDomain('Make About Tabs editable with repeater then migrate current Builder data safely', 'resources/migrations.md');
expectOneDomain('Merge home-section CSS files into assets/css/home.css and remove duplicate enqueues', 'resources/code-organization.md');

const nonWooInspect = {
  framework_names:['WordPress', 'Bricks Builder'],
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder' }],
  wordpress:{ isWordPress:true, woocommerce:false }
};
const nonWooCatalog = route('Tạo CPT sản phẩm catalog không WooCommerce và không có giá', nonWooInspect);
assert.equal(nonWooCatalog.includes('resources/woocommerce.md'), false);

const bricksInspect = {
  project:{ id:'builder-fixture', name:'builder-fixture' },
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder', version:'2.3.6' }, { name:'WooCommerce' }],
  framework_names:['WordPress', 'Bricks Builder', 'WooCommerce'],
  wordpress:{
    isWordPress:true,
    woocommerce:true,
    parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks', version:'2.3.6' }],
    childThemes:[{ slug:'builder-fixture-child', template:'bricks' }]
  },
  relevant_files:[{ path:'wp-content/themes/builder-fixture-child/elements/home-featured-products.php' }]
};

// Modern prepare_task path loads one domain plus bounded synthetic spec knowledge, not another deep domain pack.
const loaded = loadWordPressBricksSkill(bricksInspect, 'Create a custom Bricks Element with Builder controls, repeater and manual product selection');
assert.ok(loaded);
assert.deepEqual(loaded.domains, ['bricks']);
assert.deepEqual(loaded.resources.map(item => item.name), ['resources/core-checklist.md', 'domains/bricks.md', 'knowledge/bricks-spec']);
assert.equal(loaded.bricks_spec.status, 'exact');
assert.ok(loaded.bricks_guidance.length <= 3);
assert.ok(loaded.resource_context.used_chars <= MAX_SKILL_CONTEXT_CHARS);
assert.ok(loaded.instructions.length + loaded.resources.reduce((sum,item) => sum + item.content.length, 0) <= 16000);

console.log('WordPress + Bricks Builder editability PASS: legacy compatibility + v5 domain + bounded Bricks spec knowledge');
