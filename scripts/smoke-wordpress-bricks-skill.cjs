const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  loadWordPressBricksSkill,
  skillsForTask,
  chooseResources,
  CORE_RESOURCE,
  WORDPRESS_BRICKS_SKILL_ID,
  MAX_SKILL_CONTEXT_CHARS,
  hasBricksProjectEvidence
} = require('../core/skill-runtime');

const root = path.join(__dirname, '..');
const skillRoot = path.join(root, 'CHATCODE-GPT', 'skills', 'wordpress-bricks');
const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'manifest.json'), 'utf8'));
const entry = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const core = fs.readFileSync(path.join(skillRoot, 'resources', 'core-checklist.md'), 'utf8');
const mediaIcons = fs.readFileSync(path.join(skillRoot, 'resources', 'media-icons.md'), 'utf8');

function names(skill) { return (skill?.resources || []).map(item => item.name); }
function expectRoute(request, expected, inspect) {
  const selected = chooseResources(manifest, request, inspect);
  assert.equal(selected[0], CORE_RESOURCE, `${request}: core must be first`);
  assert.ok(selected.length <= 2, `${request}: ordinary task loaded too many resources: ${selected.join(', ')}`);
  if (expected) assert.equal(selected[1], expected, `${request}: wrong primary resource`);
  else assert.equal(selected.length, 1, `${request}: should be core-only`);
  assert.equal(selected.includes('resources/snippets.md'), false, 'snippets must not auto-load');
  assert.equal(selected.includes('resources/patterns.md'), false, 'patterns must not auto-load');
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
assert.equal(manifest.version, 4);
assert.equal(WORDPRESS_BRICKS_SKILL_ID, 'wordpress-bricks');
assert.equal(MAX_SKILL_CONTEXT_CHARS, 10000);
assert.ok(entry.length <= 6000, `SKILL.md too large: ${entry.length}`);
assert.ok(core.length < 5000, `core checklist too large: ${core.length}`);
assert.ok(manifest.resources.includes('resources/media-icons.md'));
assert.ok(fs.existsSync(path.join(skillRoot, 'resources', 'media-icons.md')));

const entryLower = entry.toLowerCase();
for (const phrase of [
  'prefix policy',
  'private methods',
  'allow_reuse=false',
  'functional icons should use bricks icon',
  'one-time setup must have an end state',
  'at most one task-domain resource',
  'snippets.md` and `patterns.md` are examples only'
]) assert.ok(entryLower.includes(phrase), `missing slim contract: ${phrase}`);

const combined = `${entry}\n${core}\n${mediaIcons}`.toLowerCase();
for (const phrase of [
  'slot -> reference component/selector -> source url -> attachment id -> allow_reuse',
  'default `allow_reuse = false`',
  'duplicate attachment ids',
  'bricks icon element',
  'large svg/data uri',
  'normal frontend `init`/`wp` requests'
]) assert.ok(combined.includes(phrase), `missing deterministic discipline: ${phrase}`);

expectRoute('Đổi số điện thoại trong footer text', null, bricksInspect);
expectRoute('Fix responsive CSS padding on product card mobile', 'resources/design-system.md', bricksInspect);
expectRoute('Refactor prefix namespace and child-theme file ownership', 'resources/code-organization.md', bricksInspect);
expectRoute('Tạo custom Bricks element có controls và repeater', 'resources/builder-editability.md', bricksInspect);
expectRoute('Lấy đúng ảnh từ website mẫu, upload media và dùng icon Bricks', 'resources/media-icons.md', bricksInspect);
expectRoute('Migrate Builder data và sửa element ID có rollback', 'resources/migrations.md', bricksInspect);
expectRoute('Seed sample CPT posts without duplicates', 'resources/data-seeding.md', nonWooInspect);
expectRoute('Sửa Header Bricks template condition', 'resources/templates.md', bricksInspect);
expectRoute('Fix WooCommerce checkout order review', 'resources/woocommerce.md', bricksInspect);
expectRoute('Đọc Bricks parent source và wp-includes để xác minh API', 'resources/retrieval-scope.md', bricksInspect);

const productCss = chooseResources(manifest, 'Sửa padding product card trên mobile', bricksInspect);
assert.deepEqual(productCss, [CORE_RESOURCE, 'resources/design-system.md']);
const nonWooProduct = chooseResources(manifest, 'Tạo post type sản phẩm catalog không WooCommerce', nonWooInspect);
assert.equal(nonWooProduct.includes('resources/woocommerce.md'), false);

assert.equal(hasBricksProjectEvidence(bricksInspect).active, true);
const skill = loadWordPressBricksSkill(bricksInspect, 'Sửa padding product card trên mobile');
assert.ok(skill && skill.mandatory);
assert.equal(skill.version, 4);
assert.deepEqual(names(skill), [CORE_RESOURCE, 'resources/design-system.md']);
assert.ok(skill.resource_context.used_chars <= MAX_SKILL_CONTEXT_CHARS);
const totalContext = skill.instructions.length + skill.resources.reduce((sum,item) => sum + item.content.length, 0);
assert.ok(totalContext <= 16000, `skill payload too large: ${totalContext}`);

const mediaSkill = loadWordPressBricksSkill(bricksInspect, 'Lấy ảnh từ mẫu cho 10 brand và icon location');
assert.deepEqual(names(mediaSkill), [CORE_RESOURCE, 'resources/media-icons.md']);
assert.ok(mediaSkill.resource_context.used_chars <= 10000);

const plainWpInspect = {
  project:{ id:'p2', name:'plain-wp' },
  frameworks:[{ name:'WordPress' }], framework_names:['WordPress'],
  wordpress:{ isWordPress:true, parentThemes:[{ slug:'twentytwentysix' }] }, relevant_files:[]
};
assert.equal(hasBricksProjectEvidence(plainWpInspect).active, false);
assert.equal(skillsForTask(plainWpInspect, 'Please use Bricks').length, 0, 'prompt wording alone must not fake Bricks evidence');

for (const forbidden of ['tongkhokhoathongminh.com', 'd:\\duyanhweb\\ftp\\boncauinax.vn']) {
  assert.equal(`${entry}\n${core}\n${mediaIcons}`.toLowerCase().includes(forbidden), false, `project-specific path leaked into generic skill: ${forbidden}`);
}

console.log('WordPress + Bricks skill v4 PASS: core + one domain; <=16k payload; prefix/media/icon/migration discipline');
