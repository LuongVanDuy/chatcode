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
  MAX_TARGETED_EXCERPT_CHARS,
  DOMAIN_FILES,
  hasBricksProjectEvidence
} = require('../core/skill-runtime');
const { searchUiKnowledge } = require('../core/ui-knowledge');
const { compactSkillsForFastPath } = require('../core/agent-runtime');
const { buildTaskCard, EXECUTION_PATHS } = require('../core/task-planner');

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
function assertOrganizationInvariant(text, label) {
  const lower = String(text || '').toLowerCase();
  for (const phrase of ['correct functional owner','functions.php','bootstrap/require/enqueue','small fixes','zero new']) {
    assert.ok(lower.includes(phrase), `${label}: missing organization invariant phrase ${phrase}`);
  }
  assert.ok(lower.includes('bricks') && lower.includes('native'), `${label}: missing native Bricks preference`);
}
function withoutCompactOrganizationInvariant(skill) {
  return {
    ...skill,
    compact_context:String(skill?.compact_context || '')
      .split(/\r?\n/)
      .filter(line => !line.startsWith('Code organization:'))
      .join('\n')
  };
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

const organizationInspect = {
  project:{ id:'p3', name:'organization-fixture' },
  primary_language:'PHP',
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder' }],
  framework_names:['WordPress', 'Bricks Builder'],
  wordpress:{
    isWordPress:true,
    woocommerce:false,
    childThemes:[{ slug:'fixture-child', template:'bricks', root:'wp-content/themes/fixture-child' }]
  },
  relevant_files:[
    { path:'wp-content/themes/fixture-child/functions.php', score:100 },
    { path:'wp-content/themes/fixture-child/assets/css/home.css', score:90 }
  ]
};

assert.equal(manifest.id, 'wordpress-bricks');
assert.equal(manifest.version, 5);
assert.equal(WORDPRESS_BRICKS_SKILL_ID, 'wordpress-bricks');
assert.equal(MAX_SKILL_CONTEXT_CHARS, 12000);
assert.equal(MAX_DOMAINS, 2);
assert.equal(MAX_TARGETED_EXCERPT_CHARS, 1400);
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
assertOrganizationInvariant(entry, 'full SKILL.md');
assertOrganizationInvariant(core, 'core checklist');

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

// Fast Path drops full domain files but must retain compact domain guidance + structured UI matches.
const fastSkill = compactSkillsForFastPath([skill], 6000)[0];
assert.deepEqual(fastSkill.domains, ['ui']);
assert.deepEqual(fastSkill.resources, []);
assert.ok(fastSkill.instructions.includes('Task-domain guidance:'), 'Fast skill lost v5 domain guidance');
assert.ok(fastSkill.instructions.includes('Task domains: ui'), 'Fast skill lost routed UI domain identity');
assert.ok(fastSkill.ui_guidance.length >= 1 && fastSkill.ui_guidance.length <= 3, 'Fast skill lost structured UI guidance');
assert.equal(fastSkill.resource_context.fast_compact, true);
assert.deepEqual(fastSkill.resource_context.selected_domains, ['ui']);
assert.equal(fastSkill.resource_context.ui_guidance_count, fastSkill.ui_guidance.length);
assert.ok(fastSkill.instructions.length <= 6000, `Fast v5 skill exceeded compact budget: ${fastSkill.instructions.length}`);
assertOrganizationInvariant(fastSkill.instructions, 'existing Fast UI payload');

// Organization invariant regression: exercise the real planner, skill loader and Fast compactor.
const ajaxRequest = 'Thêm AJAX tải thêm sản phẩm trang chủ';
const ajaxCard = buildTaskCard({ request:ajaxRequest, inspect:organizationInspect });
assert.equal(ajaxCard.execution.path, EXECUTION_PATHS.FAST, 'T1 AJAX fixture classification changed');
assert.equal(ajaxCard.owner.primary_path, 'wp-content/themes/fixture-child/functions.php', 'T1 owner baseline changed');
assert.equal(ajaxCard.execution.allow_new_source_files, 0, 'T1 Fast new-file gate must remain zero');
const ajaxSkill = loadWordPressBricksSkill(organizationInspect, ajaxRequest, ajaxCard);
assert.equal(ajaxSkill.resource_context.targeted_resource, null, 'T1 must not depend on targeted organization keywords');
assertOrganizationInvariant(ajaxSkill.instructions, 'T1 full skill');
const ajaxFast3600 = compactSkillsForFastPath([ajaxSkill], 3600)[0];
const ajaxFast6000 = compactSkillsForFastPath([ajaxSkill], 6000)[0];
assertOrganizationInvariant(ajaxFast3600.instructions, 'T1/T3 Fast 3600');
assertOrganizationInvariant(ajaxFast6000.instructions, 'T4 Fast 6000');
assert.ok(ajaxFast3600.instructions.length <= 3600, 'T3 Fast 3600 budget exceeded');
assert.ok(ajaxFast6000.instructions.length <= 6000, 'T4 Fast 6000 budget exceeded');
assert.deepEqual(ajaxFast6000.resources, [], 'T4 Fast resources must remain empty');

const sliderRequest = 'Tạo section trang chủ Bricks có slider';
const sliderCard = buildTaskCard({ request:sliderRequest, inspect:organizationInspect });
assert.equal(sliderCard.execution.path, EXECUTION_PATHS.DEEP, 'T2 Bricks section fixture classification changed');
assert.equal(sliderCard.owner.primary_path, 'wp-content/themes/fixture-child/functions.php', 'T2 owner baseline changed');
const sliderSkill = loadWordPressBricksSkill(organizationInspect, sliderRequest, sliderCard);
assert.deepEqual(sliderSkill.domains, ['bricks','ui'], 'T2 domain routing changed');
assert.equal(sliderSkill.resource_context.targeted_resource, null, 'T2 must not force full organization routing');
assert.equal(names(sliderSkill).includes('resources/code-organization.md'), false, 'T2 must not load full organization resource');
assertOrganizationInvariant(sliderSkill.compact_context, 'T2 compact context');
assertOrganizationInvariant(sliderSkill.instructions, 'T6 Deep/full instructions');
assertOrganizationInvariant(sliderSkill.resources.find(item => item.name === CORE_RESOURCE)?.content, 'T6 returned core resource');

const cssRequest = 'Giảm padding product card mobile 4px';
const cssCard = buildTaskCard({ request:cssRequest, inspect:organizationInspect });
assert.equal(cssCard.execution.path, EXECUTION_PATHS.FAST, 'T3 CSS fixture classification changed');
assert.equal(cssCard.owner.primary_path, 'wp-content/themes/fixture-child/assets/css/home.css', 'T3 CSS owner baseline changed');
assert.equal(cssCard.execution.skill_context_limit_chars, 3600, 'T3 micro Fast budget changed');
const cssSkill = loadWordPressBricksSkill(organizationInspect, cssRequest, cssCard);
const cssFast = compactSkillsForFastPath([cssSkill], cssCard.execution.skill_context_limit_chars)[0];
assert.deepEqual(cssSkill.domains, ['ui'], 'T3 CSS domain routing changed');
assertOrganizationInvariant(cssFast.instructions, 'T3 CSS Fast payload');
assert.ok(cssFast.instructions.length <= 3600, 'T3 CSS Fast payload exceeded 3600');

const longRequest = 'Build Bricks taxonomy archive template with native main query, template conditions, responsive mobile tablet desktop container grid card spacing typography buttons hover transitions';
const longCard = buildTaskCard({ request:longRequest, inspect:organizationInspect });
const longSkill = loadWordPressBricksSkill(organizationInspect, longRequest, longCard);
assert.equal(longSkill.resource_context.targeted_resource, 'resources/templates.md', 'T5 targeted template excerpt missing');
assert.ok(names(longSkill).includes('knowledge/ui-search'), 'T5 UI knowledge missing');
assertOrganizationInvariant(longSkill.compact_context, 'T5 loaded long compact context');
const truncationProbe = {
  ...longSkill,
  compact_context:`${longSkill.compact_context}\n${'optional-tail '.repeat(500)}OPTIONAL_TAIL_END`
};
const truncatedFast = compactSkillsForFastPath([truncationProbe], 3600)[0];
assert.equal(truncatedFast.instructions.length, 3600, 'T5 truncation probe must exercise the Fast cap');
assert.equal(truncatedFast.instructions.includes('OPTIONAL_TAIL_END'), false, 'T5 optional tail should be cut');
assertOrganizationInvariant(truncatedFast.instructions, 'T5 invariant after truncation');

const functionsRequest = 'Sửa điều kiện hook cũ trong functions.php theo đúng file người dùng yêu cầu';
const functionsCard = buildTaskCard({ request:functionsRequest, inspect:organizationInspect });
const functionsSkill = loadWordPressBricksSkill(organizationInspect, functionsRequest, functionsCard);
assert.equal(functionsSkill.resource_context.targeted_resource, 'resources/code-organization.md', 'T7 explicit functions.php must retain targeted excerpt');
assert.match(functionsSkill.instructions, /Small fixes to existing code may stay in place/i, 'T7 must not hard-ban functions.php edits');
assert.match(functionsSkill.instructions, /explicit user scope/i, 'T7 must respect explicit user scope');
assert.match(functionsSkill.compact_context, /Small fixes to existing code may stay in place/i, 'T7 Fast compact rule must allow existing small fixes');

const before3600 = compactSkillsForFastPath([withoutCompactOrganizationInvariant(ajaxSkill)], 3600)[0];
const before6000 = compactSkillsForFastPath([withoutCompactOrganizationInvariant(ajaxSkill)], 6000)[0];

const archiveSkill = loadWordPressBricksSkill(
  bricksInspect,
  'Build taxonomy archive template using native archive main query and correct template conditions',
  { type:'BRICKS_BUILDER', target:'archive taxonomy template' }
);
const templateExcerpt = archiveSkill.resources.find(item => item.name === 'knowledge/templates-excerpt');
assert.ok(templateExcerpt, 'modern Bricks archive task must receive templates excerpt');
assert.ok(templateExcerpt.content.length <= MAX_TARGETED_EXCERPT_CHARS, 'template excerpt must stay compact');
assert.equal(names(archiveSkill).includes('resources/templates.md'), false, 'modern task must not load full legacy templates resource');
assert.equal(archiveSkill.resource_context.targeted_resource, 'resources/templates.md');
assert.match(archiveSkill.compact_context.toLowerCase(), /archive|templateconditions|main query/, 'Fast compact context lost targeted archive knowledge');

const namingSkill = loadWordPressBricksSkill(
  bricksInspect,
  'Đặt tên file CSS và folder child theme ngắn gọn, reuse owner hiện tại, không tạo owner song song',
  { type:'FAST_UI', target:'child theme file naming' }
);
const namingExcerpt = namingSkill.resources.find(item => item.name === 'knowledge/code-organization-excerpt');
assert.ok(namingExcerpt, 'file/folder naming task must receive code organization excerpt');
assert.ok(namingExcerpt.content.length <= MAX_TARGETED_EXCERPT_CHARS, 'code organization excerpt must stay compact');
assert.equal(names(namingSkill).includes('resources/code-organization.md'), false, 'modern task must not load full legacy code organization resource');
assert.equal(namingSkill.resource_context.targeted_resource, 'resources/code-organization.md');

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

console.log(`Organization payload chars: FAST 3600 ${before3600.instructions.length}->${ajaxFast3600.instructions.length}; FAST 6000 ${before6000.instructions.length}->${ajaxFast6000.instructions.length}; resources=${ajaxFast6000.resources.length}; domains=${ajaxSkill.domains.length}`);
console.log('WordPress + Bricks skill v5 PASS: umbrella + <=2 domains + organization invariant + compact targeted excerpts + deterministic UI search + Fast guidance + legacy compatibility');
