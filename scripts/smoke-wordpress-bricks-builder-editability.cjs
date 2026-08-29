const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  chooseResources,
  loadWordPressBricksSkill,
  MAX_SKILL_CONTEXT_CHARS
} = require('../core/skill-runtime');

const root = path.join(__dirname, '..');
const skillRoot = path.join(root, 'CHATCODE-GPT', 'skills', 'wordpress-bricks');
const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'manifest.json'), 'utf8'));
const builderFile = path.join(skillRoot, 'resources', 'builder-editability.md');
const organizationFile = path.join(skillRoot, 'resources', 'code-organization.md');
const builderText = fs.readFileSync(builderFile, 'utf8').toLowerCase();
const organizationText = fs.readFileSync(organizationFile, 'utf8').toLowerCase();

function includesAll(list, expected) {
  for (const item of expected) assert.ok(list.includes(item), `missing routed resource: ${item}`);
}

assert.ok(manifest.resources.includes('resources/builder-editability.md'));
assert.ok(fs.existsSync(builderFile));

assert.ok(builderText.includes('native first, custom element second, shortcode wrapper last'));
assert.ok(builderText.includes('a custom element is incomplete if changing its ordinary content still requires editing php'));
assert.ok(builderText.includes('source: automatic | manual'));
assert.ok(builderText.includes('repeatable content pattern'));
assert.ok(builderText.includes('shortcode-to-element migration'));
assert.ok(builderText.includes('shared product-item renderer'));

assert.ok(organizationText.includes('page css: group page-owned sections instead of file-per-section sprawl'));
assert.ok(organizationText.includes('assets/css/home.css'));
assert.ok(organizationText.includes('do not create `home-section-2.css`'));
assert.ok(organizationText.includes('javascript does **not** have to mirror css file grouping'));

const ordinary = chooseResources(manifest, 'Change one phone number in a Bricks project');
assert.deepEqual(ordinary, ['resources/core-checklist.md']);

const custom = chooseResources(manifest, 'Create a reusable custom Bricks Element with Builder controls and scoped AJAX behavior');
includesAll(custom, [
  'resources/core-checklist.md',
  'resources/builder-editability.md',
  'resources/snippets.md',
  'resources/patterns.md'
]);

const featured = chooseResources(
  manifest,
  'Refactor Featured Products into a custom Bricks Element with Automatic or Manual source and manual multi-select products using the shared product card'
);
includesAll(featured, [
  'resources/core-checklist.md',
  'resources/builder-editability.md',
  'resources/templates.md',
  'resources/woocommerce.md'
]);

const groups = chooseResources(
  manifest,
  'Make the product group tabs configurable in Builder: choose product taxonomy and select terms; AJAX must reuse shared product renderer'
);
includesAll(groups, [
  'resources/core-checklist.md',
  'resources/builder-editability.md',
  'resources/templates.md',
  'resources/woocommerce.md'
]);

const tabs = chooseResources(
  manifest,
  'Make About Tabs editable with a repeater for tab title, rich text content, image and link, then migrate current tab content into Builder settings'
);
includesAll(tabs, [
  'resources/core-checklist.md',
  'resources/builder-editability.md',
  'resources/migrations.md'
]);

const pageCss = chooseResources(
  manifest,
  'Merge home-section-3.css and home-section-4.css into assets/css/home.css and remove their separate enqueues while keeping independent feature JS split'
);
includesAll(pageCss, [
  'resources/core-checklist.md',
  'resources/code-organization.md',
  'resources/design-system.md'
]);
assert.equal(pageCss.includes('resources/builder-editability.md'), false);

const bricksInspect = {
  project:{ id:'builder-fixture', name:'builder-fixture' },
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder' }, { name:'WooCommerce' }],
  framework_names:['WordPress', 'Bricks Builder', 'WooCommerce'],
  wordpress:{
    isWordPress:true,
    parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }],
    childThemes:[{ slug:'builder-fixture-child', template:'bricks' }]
  },
  relevant_files:[{ path:'wp-content/themes/builder-fixture-child/elements/home-featured-products.php' }]
};

const loaded = loadWordPressBricksSkill(
  bricksInspect,
  'Create a custom Bricks Element with Builder controls, repeater, manual product selection, taxonomy terms, migration, AJAX and frontend CSS'
);
assert.ok(loaded);
const names = loaded.resources.map(item => item.name);
assert.ok(names.includes('resources/builder-editability.md'));
assert.equal(loaded.resource_context.omitted_support_resources.includes('resources/builder-editability.md'), false);
assert.ok(loaded.resource_context.used_chars <= MAX_SKILL_CONTEXT_CHARS || loaded.resource_context.exceeded_by_required_rules);

console.log('WordPress + Bricks Builder editability PASS: configurable controls + page asset ownership + progressive routing');
