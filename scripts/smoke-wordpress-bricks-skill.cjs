const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  loadWordPressBricksSkill,
  skillsForTask,
  chooseResources,
  CORE_RESOURCE,
  WORDPRESS_BRICKS_SKILL_ID,
  hasBricksProjectEvidence
} = require('../core/skill-runtime');
const { createAgentRuntime } = require('../core/agent-runtime');
const { createSkillPolicyApi, SKILL_ENTRY } = require('../core/skill-policy');

const root = path.join(__dirname, '..');
const skillRoot = path.join(root, 'CHATCODE-GPT', 'skills', 'wordpress-bricks');

function collectText(dir) {
  const files = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes:true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:md|json)$/i.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  return { files, text:files.map(file => fs.readFileSync(file, 'utf8')).join('\n').toLowerCase() };
}

function includesAll(text, values) {
  for (const value of values) {
    assert.ok(text.includes(String(value).toLowerCase()), `missing skill contract: ${value}`);
  }
}

function names(items) {
  return items.map(item => item.name);
}

(async () => {
  const entryFile = path.join(skillRoot, 'SKILL.md');
  const manifestFile = path.join(skillRoot, 'manifest.json');
  const casesFile = path.join(skillRoot, 'tests', 'acceptance-cases.json');
  const entry = fs.readFileSync(entryFile, 'utf8');
  const entryLower = entry.toLowerCase();
  const collected = collectText(skillRoot);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

  assert.equal(manifest.id, 'wordpress-bricks');
  assert.equal(manifest.version, 2);
  assert.equal(WORDPRESS_BRICKS_SKILL_ID, 'wordpress-bricks');
  assert.ok(entry.length < 9000, `SKILL.md too large: ${entry.length} chars`);
  assert.ok(entryLower.includes('progressive resource loading'));
  assert.ok(entryLower.includes('do not load every resource'));
  assert.ok(entryLower.includes('this skill is **mandatory**'));
  assert.ok(entryLower.includes('even when the user\'s prompt does not mention bricks'));

  const nativePos = entryLower.indexOf('bricks native element/control/template');
  const dynamicPos = entryLower.indexOf('bricks dynamic data / query loop');
  const wpPos = entryLower.indexOf('wordpress or woocommerce public api/hook');
  const customPos = entryLower.indexOf('custom bricks element');
  assert.ok(nativePos >= 0 && nativePos < dynamicPos && dynamicPos < wpPos && wpPos < customPos, 'native priority order changed');

  for (const forbidden of ['tongkhokhoathongminh.com', 'tongkhokhoathongminh', 'tkk-', 'd:\\duyanhweb']) {
    assert.equal(collected.text.includes(forbidden), false, `reference-project dependency: ${forbidden}`);
  }

  const resources = [
    'resources/core-checklist.md', 'resources/patterns.md', 'resources/code-organization.md',
    'resources/design-system.md', 'resources/data-seeding.md', 'resources/templates.md',
    'resources/woocommerce.md', 'resources/migrations.md', 'resources/snippets.md', 'resources/validation.md'
  ];
  for (const resource of resources) {
    assert.ok(manifest.resources.includes(resource), `manifest missing ${resource}`);
    assert.ok(fs.existsSync(path.join(skillRoot, resource)), `file missing ${resource}`);
  }
  assert.equal(CORE_RESOURCE, 'resources/core-checklist.md');

  includesAll(collected.text, [
    'BRICKS_DB_TEMPLATE_TYPE', 'six-character alphanumeric', 'compare-and-set',
    'clean_post_cache($post_id)', 'generate_post_css_file',
    'add_option()', 'race-prone', 'stable semantic identity', 'move proven duplicates to trash',
    'frontend design system', 'global source of truth', 'one shell system across the site', 'avoid override chains',
    'register_nav_menus(', 'is_archive_main_query=true', 'product_type', 'product_visibility',
    'wc_get_page_id(', 'classic shortcode', 'extends `\\bricks\\element`', 'filemtime(',
    'minmax(0, 1fr)', 'aspect-ratio', 'page_on_front', 'wc_get_attribute_taxonomies()'
  ]);

  assert.deepEqual(
    chooseResources(manifest, 'Change one Bricks text label'),
    ['resources/core-checklist.md']
  );

  const css = chooseResources(manifest, 'Fix responsive CSS padding and typography on the frontend');
  includesAll(css.join('\n'), ['core-checklist.md', 'code-organization.md', 'design-system.md', 'snippets.md']);
  assert.equal(css.includes('resources/data-seeding.md'), false);
  assert.equal(css.includes('resources/migrations.md'), false);
  assert.equal(css.includes('resources/validation.md'), false);

  const seed = chooseResources(manifest, 'Create a Bricks Archive template and seed sample CPT posts safely without duplicates');
  includesAll(seed.join('\n'), ['core-checklist.md', 'data-seeding.md', 'templates.md', 'migrations.md']);
  assert.equal(seed.includes('resources/design-system.md'), false);
  assert.equal(seed.includes('resources/validation.md'), false);

  const audit = chooseResources(manifest, 'Quét lại toàn bộ frontend CSS và validate toàn bộ hệ thống');
  assert.ok(audit.includes('resources/design-system.md'));
  assert.ok(audit.includes('resources/validation.md'));

  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  assert.ok(cases.length >= 17);
  for (const testCase of cases) {
    const selected = chooseResources(manifest, testCase.request);
    for (const expected of testCase.resources) {
      assert.ok(selected.includes(expected), `${testCase.name}: missing routed resource ${expected}`);
    }
  }

  const bricksInspect = {
    project:{ id:'p1', name:'fixture' },
    primary_language:'PHP',
    frameworks:[{ name:'WordPress' }, { name:'WooCommerce' }],
    framework_names:['WordPress', 'WooCommerce'],
    wordpress:{ isWordPress:true, parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }], childThemes:[{ slug:'fixture-child', template:'bricks' }] },
    relevant_files:[{ path:'wp-content/themes/fixture-child/functions.php' }]
  };

  assert.equal(hasBricksProjectEvidence(bricksInspect).active, true);
  const genericSkill = loadWordPressBricksSkill(bricksInspect, 'Đổi số điện thoại trong dự án');
  assert.ok(genericSkill, 'Bricks project must attach skill even for a prompt that does not mention Bricks');
  assert.equal(genericSkill.mandatory, true);
  assert.equal(genericSkill.activation, 'mandatory-wordpress-bricks-project-policy');
  assert.deepEqual(names(genericSkill.resources), ['resources/core-checklist.md']);

  const migrationSkill = loadWordPressBricksSkill(bricksInspect, 'Migrate one Bricks element ID and regenerate CSS file cache');
  assert.ok(migrationSkill);
  const migrationResources = names(migrationSkill.resources);
  includesAll(migrationResources.join('\n'), ['core-checklist.md', 'migrations.md', 'snippets.md']);
  assert.equal(migrationResources.includes('resources/design-system.md'), false);
  assert.equal(migrationResources.includes('resources/data-seeding.md'), false);
  assert.equal(migrationResources.includes('resources/validation.md'), false);

  const plainWpInspect = {
    project:{ id:'p2', name:'plain-wp' }, framework_names:['WordPress'], frameworks:[{ name:'WordPress' }],
    wordpress:{ isWordPress:true, parentThemes:[{ slug:'twentytwentysix' }] }, relevant_files:[]
  };
  assert.equal(hasBricksProjectEvidence(plainWpInspect).active, false);
  assert.equal(skillsForTask(plainWpInspect, 'Please use Bricks to fix a PHP helper').length, 0, 'Prompt text alone must not fake Bricks project evidence');

  const fakeApi = {
    startWork: async () => ({ work_session_id:'work-1', project_id:'p1', workspace_mode:'trusted', baseline:{} }),
    inspectProject: async () => bricksInspect,
    readFile: async () => { throw new Error('no package.json in fixture'); }
  };
  const prepared = await createAgentRuntime(fakeApi).prepareTask('p1', 'Build a real Bricks Woo checkout template with native order review');
  assert.equal(prepared.skills.length, 1);
  assert.equal(prepared.skills[0].mandatory, true);
  const preparedResources = names(prepared.skills[0].resources);
  includesAll(preparedResources.join('\n'), ['core-checklist.md', 'woocommerce.md', 'templates.md', 'patterns.md']);
  assert.equal(preparedResources.includes('resources/data-seeding.md'), false, 'Woo task without create/seed intent should not load data-seeding');
  assert.equal(preparedResources.includes('resources/design-system.md'), false);
  assert.equal(preparedResources.includes('resources/validation.md'), false);
  assert.match(prepared.agent_contract.guidance[0], /skills/i);

  let writes = 0;
  const blockedLegacy = createSkillPolicyApi({
    inspectProject: async () => bricksInspect,
    writeFile: async () => { writes++; return { ok:true }; },
    readFile: async () => ({ path:SKILL_ENTRY, content:entry })
  });
  await assert.rejects(
    () => blockedLegacy.writeFile('p1', 'functions.php', '<?php'),
    error => error?.code === 'SKILL_REQUIRED'
  );
  assert.equal(writes, 0, 'Direct Bricks mutation must be blocked before skill use');
  await blockedLegacy.readFile('CHATCODE-GPT', SKILL_ENTRY);
  await blockedLegacy.writeFile('p1', 'functions.php', '<?php');
  assert.equal(writes, 1, 'Legacy mutation may continue after reading mandatory skill');

  const inspectPolicyApi = createSkillPolicyApi({
    inspectProject: async () => bricksInspect,
    writeFile: async () => ({ ok:true })
  });
  const inspected = await inspectPolicyApi.inspectProject('p1', 'Đổi số điện thoại', 4);
  assert.equal(inspected.skill_policy.mandatory, true);
  assert.equal(inspected.skill_policy.skill_id, 'wordpress-bricks');
  assert.equal(inspected.skills[0].mandatory, true);

  const modernSkill = loadWordPressBricksSkill(bricksInspect, 'Đổi số điện thoại');
  const modernPolicyApi = createSkillPolicyApi({
    inspectProject: async () => bricksInspect,
    prepareTask: async () => ({ task_id:'task-1', work_session_id:'task-1', context:bricksInspect, skills:[modernSkill] }),
    completeTask: async () => ({ ok:true, status:'completed' }),
    workStatus: async () => ({ project_id:'p1', project:'fixture', status:'active' })
  });
  const policyPrepared = await modernPolicyApi.prepareTask('p1', 'Đổi số điện thoại', 4);
  assert.equal(policyPrepared.skill_policy.mandatory, true);
  assert.equal(policyPrepared.skill_policy.attached, true);
  const policyCompleted = await modernPolicyApi.completeTask('task-1', '', []);
  assert.equal(policyCompleted.ok, true);

  const plainPolicyApi = createSkillPolicyApi({
    inspectProject: async () => plainWpInspect,
    writeFile: async () => ({ ok:true })
  });
  assert.equal((await plainPolicyApi.writeFile('p2', 'functions.php', '<?php')).ok, true, 'Non-Bricks WordPress project must not be forced into Bricks skill');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('CHATCODE-GPT/**/*'));

  console.log(`WordPress + Bricks skill v2 PASS: mandatory project policy + compact ChatGPT routing; ${collected.files.length} skill files, ${cases.length} acceptance routes`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
