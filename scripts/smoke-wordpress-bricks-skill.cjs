const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  loadWordPressBricksSkill,
  skillsForTask,
  chooseResources,
  routeSkillDomains,
  CORE_RESOURCE,
  WORDPRESS_BRICKS_SKILL_ID,
  MAX_SKILL_CONTEXT_CHARS,
  MAX_DOMAINS,
  DOMAIN_FILES,
  hasBricksProjectEvidence
} = require('../core/skill-runtime');
const { searchUiKnowledge } = require('../core/ui-knowledge');

const root = path.join(__dirname, '..');
const skillRoot = path.join(root, 'CHATCODE-GPT', 'skills', 'wordpress-bricks');
const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'manifest.json'), 'utf8'));
const entry = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const core = fs.readFileSync(path.join(skillRoot, 'resources', 'core-checklist.md'), 'utf8');

function names(skill) { return (skill?.resources || []).map(item => item.name); }
function expectLegacyRoute(request, expected, inspect) {
  const selected = chooseResources(manifest, request, inspect);
  assert.equal(selected[0], CORE_RESOURCE, `${request}: core must be first`);
  assert.ok(selected.length <= 2, `${request}: legacy route loaded too many resources`);
  if (expected) assert.equal(selected[1], expected, `${request}: wrong legacy primary resource`);
  assert.equal(selected.includes('resources/snippets.md'), false);
  assert.equal(selected.includes('resources/patterns.md'), false);
}
function expectDomains(request, expected, inspect, taskCard = null) {
  const selected = routeSkillDomains(request, inspect, taskCard);
  assert.deepEqual(selected, expected, `${request}: wrong v5 domains`);
  assert.ok(selected.length <= MAX_DOMAINS, `${request}: too many domains`);
}

const bricksInspect = {
  project:{ id:'p1', name:'fixture' },
  primary_language:'PHP',
  frameworks:[{ name:'WordPress' }, { name:'WooCommerce' }, { name:'Bricks Builder' }],
  framework_names:['WordPress', 'WooCommerce', 'Bricks Builder'],
  wordpress:{
    isWordPress:true,
    woocommerce:true,
    parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }],
    childThemes:[{ slug:'fixture-child', template:'bricks', root:'wp-content/themes/fixture-child' }]
  },
  relevant_files:[
    { path:'wp-content/themes/fixture-child/functions.php' },
    { path:'wp-content/themes/fixture-child/assets/css/main.css' },
    { path:'wp-content/themes/fixture-child/assets/css/product.css' }
  ]
};

const nonWooInspect = {
  ...bricksInspect,
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder' }],
  framework_names:['WordPress', 'Bricks Builder'],
  wordpress:{ ...bricksInspect.wordpress, woocommerce:false }
};

assert.equal(manifest.id, 'wordpress-bricks');
assert.equal(manifest.version, 5);
assert.equal(WORDPRESS_BRICKS_SKILL_ID, 'wordpress-bricks');
assert.equal(MAX_SKILL_CONTEXT_CHARS, 12000);
assert.equal(MAX_DOMAINS, 2);
assert.ok(entry.length <= 4200, `v5 entry too large: ${entry.length}`);
assert.ok(core.length < 5000, `core checklist too large: ${core.length}`);
assert.deepEqual(Object.keys(manifest.domains).sort(), Object.keys(DOMAIN_FILES).sort());
for (const relative of Object.values(DOMAIN_FILES)) assert.ok(fs.existsSync(path.join(skillRoot, relative)), `missing domain pack ${relative}`);
assert.ok(fs.existsSync(path.join(skillRoot, manifest.data.ui_guidelines)));

const entryLower = entry.toLowerCase();
for (const phrase of [
  'umbrella contract',
  'domain packs',
  'at most **two** domain packs',
  'searchable ui knowledge',
  'generic words such as `product` do not automatically activate woocommerce',
  'normal container/grid/image/icon/text/button/slider/query composition is not a custom-element gap'
]) assert.ok(entryLower.includes(phrase), `missing v5 architecture contract: ${phrase}`);

// Legacy compatibility remains stable while prepare_task moves to v5 domains.
expectLegacyRoute('Fix responsive CSS padding on product card mobile', 'resources/design-system.md', bricksInspect);
expectLegacyRoute('Tạo custom Bricks element có controls và repeater', 'resources/builder-editability.md', bricksInspect);
expectLegacyRoute('Lấy đúng ảnh từ website mẫu, upload media và dùng icon Bricks', 'resources/media-icons.md', bricksInspect);
expectLegacyRoute('Migrate Builder data và sửa element ID có rollback', 'resources/migrations.md', bricksInspect);
expectLegacyRoute('Fix WooCommerce checkout order review', 'resources/woocommerce.md', bricksInspect);

expectDomains('Sửa padding product card trên mobile', ['ui'], bricksInspect);
expectDomains('Tạo custom Bricks element có controls và repeater', ['bricks'], bricksInspect, { type:'BRICKS_BUILDER' });
expectDomains('Lấy ảnh từ website mẫu cho brand và icon location', ['media'], bricksInspect);
expectDomains('Lấy ảnh mẫu và chỉnh responsive card cho mobile', ['media','ui'], bricksInspect);
expectDomains('Migrate Builder data và sửa element ID có rollback', ['data','bricks'], bricksInspect, { type:'DATA' });
expectDomains('Seed sample CPT posts without duplicates', ['data'], nonWooInspect, { type:'DATA' });
expectDomains('Fix WooCommerce checkout order review', ['woocommerce'], bricksInspect);
expectDomains('Fix WooCommerce checkout responsive layout', ['woocommerce','ui'], bricksInspect);
expectDomains('Refactor PHP hooks and nonce handling', ['wordpress'], bricksInspect);

const productCssDomains = routeSkillDomains('Sửa padding product card trên mobile', bricksInspect);
assert.equal(productCssDomains.includes('woocommerce'), false, 'generic product UI must not activate Woo domain');
const nonWooDomains = routeSkillDomains('Tạo post type sản phẩm catalog không WooCommerce', nonWooInspect);
assert.equal(nonWooDomains.includes('woocommerce'), false, 'non-Woo CPT must not activate Woo domain');

const uiResults = searchUiKnowledge('Sửa container width và spacing section homepage responsive mobile', bricksInspect, 3);
assert.ok(uiResults.length >= 1 && uiResults.length <= 3, 'UI search must return 1-3 matches');
assert.ok(uiResults.some(item => /container|section|responsive/.test(`${item.id} ${item.title}`.toLowerCase())), 'UI search did not retrieve a relevant layout rule');

assert.equal(hasBricksProjectEvidence(bricksInspect).active, true);
const skill = loadWordPressBricksSkill(bricksInspect, 'Sửa padding product card trên mobile');
assert.ok(skill && skill.mandatory);
assert.equal(skill.version, 5);
assert.deepEqual(skill.domains, ['ui']);
assert.ok(names(skill).includes(CORE_RESOURCE));
assert.ok(names(skill).includes('domains/ui.md'));
assert.ok(names(skill).includes('knowledge/ui-search'));
assert.ok(skill.ui_guidance.length >= 1 && skill.ui_guidance.length <= 3);
assert.ok(skill.resource_context.used_chars <= MAX_SKILL_CONTEXT_CHARS);
const totalContext = skill.instructions.length + skill.resources.reduce((sum,item) => sum + item.content.length, 0);
assert.ok(totalContext <= 16500, `skill payload too large: ${totalContext}`);

const mediaSkill = loadWordPressBricksSkill(bricksInspect, 'Lấy ảnh từ mẫu cho 10 brand và icon location');
assert.deepEqual(mediaSkill.domains, ['media']);
assert.deepEqual(names(mediaSkill), [CORE_RESOURCE, 'domains/media.md']);

const plainWpInspect = {
  project:{ id:'p2', name:'plain-wp' },
  frameworks:[{ name:'WordPress' }], framework_names:['WordPress'],
  wordpress:{ isWordPress:true, parentThemes:[{ slug:'twentytwentysix' }] }, relevant_files:[]
};
assert.equal(hasBricksProjectEvidence(plainWpInspect).active, false);
assert.equal(skillsForTask(plainWpInspect, 'Please use Bricks').length, 0, 'prompt wording alone must not fake Bricks evidence');

for (const forbidden of ['tongkhokhoathongminh.com', 'd:\\duyanhweb\\ftp\\boncauinax.vn']) {
  assert.equal(`${entry}\n${core}`.toLowerCase().includes(forbidden), false, `project-specific path leaked into generic skill: ${forbidden}`);
}

console.log('WordPress + Bricks skill v5 PASS: umbrella + <=2 domains + deterministic UI search + legacy compatibility');
