const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWordPressBricksSkill, skillsForTask, chooseResources, CORE_RESOURCE } = require('../core/skill-runtime');
const { createAgentRuntime } = require('../core/agent-runtime');

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
  return { files, text:files.map(file => fs.readFileSync(file, 'utf8')).join('\n') };
}

function requireText(lower, values) {
  for (const required of values) {
    assert.equal(lower.includes(String(required).toLowerCase()), true, `missing required skill contract: ${required}`);
  }
}

function has(resources, name) {
  return resources.includes(name);
}

(async () => {
  const entryFile = path.join(skillRoot, 'SKILL.md');
  const manifestFile = path.join(skillRoot, 'manifest.json');
  const casesFile = path.join(skillRoot, 'tests', 'acceptance-cases.json');

  assert.equal(fs.existsSync(entryFile), true, 'SKILL.md missing');
  assert.equal(fs.existsSync(manifestFile), true, 'manifest missing');
  assert.equal(fs.existsSync(casesFile), true, 'acceptance cases missing');

  const collected = collectText(skillRoot);
  const lower = collected.text.toLowerCase();
  const entry = fs.readFileSync(entryFile, 'utf8');
  const entryLower = entry.toLowerCase();

  assert.ok(entry.length < 9000, `SKILL.md is too large for progressive loading: ${entry.length} chars`);
  assert.match(entryLower, /progressive resource loading/, 'SKILL.md must explain progressive resource loading');
  assert.match(entryLower, /do not load every resource/, 'SKILL.md must forbid loading every resource just in case');

  for (const forbidden of ['tongkhokhoathongminh.com', 'tongkhokhoathongminh', 'tkk-', 'd:\\duyanhweb']) {
    assert.equal(lower.includes(forbidden), false, `skill must not depend on reference-project value: ${forbidden}`);
  }

  const nativePos = entryLower.indexOf('bricks native element/control/template');
  const dynamicPos = entryLower.indexOf('bricks dynamic data / query loop');
  const wpPos = entryLower.indexOf('wordpress or woocommerce public api/hook');
  const customPos = entryLower.indexOf('custom bricks element');
  assert.ok(nativePos >= 0 && nativePos < dynamicPos && dynamicPos < wpPos && wpPos < customPos, 'Bricks-native priority order is wrong');

  // Detailed knowledge stays in routed resources; it no longer needs to be duplicated in SKILL.md.
  requireText(lower, [
    'section/container/block', 'nav-menu/search', 'post-title/post-content/post-navigation/related-posts',
    'woocommerce-products', 'woocommerce-checkout-customer-details', 'woocommerce-checkout-order-review', 'woocommerce-checkout-thankyou',
    'BRICKS_DB_TEMPLATE_SLUG', 'BRICKS_DB_TEMPLATE_TYPE', 'BRICKS_DB_PAGE_CONTENT', 'BRICKS_DB_TEMPLATE_SETTINGS',
    'six-character alphanumeric', 'compare-and-set', 'clean_post_cache($post_id)', '\\Bricks\\Assets_Files::generate_post_css_file',
    'add_option()', 'race-prone', 'stable semantic identity', 'move proven duplicates to trash', 'live wordpress database state',
    'frontend design system', 'global source of truth', 'one shell system across the site', 'component css consumes tokens', 'avoid override chains',
    'register_nav_menus()', 'is_archive_main_query=true', 'product_type', 'product_visibility', 'wc_get_page_id()', 'classic shortcode',
    'extends `\\Bricks\\Element`', 'filemtime()', 'minmax(0, 1fr)', 'aspect-ratio', 'page_on_front', 'wc_get_attribute_taxonomies()',
    'WordPress core', 'Bricks parent theme', 'WooCommerce core'
  ]);

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.id, 'wordpress-bricks');
  assert.equal(manifest.version, 2, 'WordPress + Bricks skill manifest must be v2');
  for (const resource of [
    'resources/core-checklist.md', 'resources/patterns.md', 'resources/code-organization.md',
    'resources/design-system.md', 'resources/data-seeding.md', 'resources/templates.md',
    'resources/woocommerce.md', 'resources/migrations.md', 'resources/snippets.md', 'resources/validation.md'
  ]) {
    assert.ok(manifest.resources.includes(resource), `manifest missing resource: ${resource}`);
    assert.equal(fs.existsSync(path.join(skillRoot, resource)), true, `resource file missing: ${resource}`);
  }
  assert.equal(CORE_RESOURCE, 'resources/core-checklist.md');

  const tiny = chooseResources(manifest, 'Change one Bricks text label');
  assert.deepEqual(tiny, ['resources/core-checklist.md'], 'tiny task should load only compact core checklist');

  const cssTask = chooseResources(manifest, 'Fix responsive CSS padding and typography on the frontend');
  assert.ok(has(cssTask, 'resources/core-checklist.md'));
  assert.ok(has(cssTask, 'resources/code-organization.md'));
  assert.ok(has(cssTask, 'resources/design-system.md'));
  assert.ok(has(cssTask, 'resources/snippets.md'));
  assert.equal(has(cssTask, 'resources/data-seeding.md'), false, 'CSS task must not load data-seeding');
  assert.equal(has(cssTask, 'resources/migrations.md'), false, 'CSS task must not load migrations');
  assert.equal(has(cssTask, 'resources/validation.md'), false, 'ordinary CSS task must not load full validation');

  const seedTask = chooseResources(manifest, 'Create a Bricks Archive template and seed sample CPT posts safely without duplicates');
  assert.ok(has(seedTask, 'resources/data-seeding.md'));
  assert.ok(has(seedTask, 'resources/templates.md'));
  assert.ok(has(seedTask, 'resources/migrations.md'));
  assert.equal(has(seedTask, 'resources/design-system.md'), false, 'data seed task must not load design system unless UI is requested');
  assert.equal(has(seedTask, 'resources/validation.md'), false, 'focused seed task must not load full validation');

  const auditTask = chooseResources(manifest, 'Quét lại toàn bộ frontend CSS và validate toàn bộ hệ thống');
  assert.ok(has(auditTask, 'resources/validation.md'), 'broad audit must load full validation');
  assert.ok(has(auditTask, 'resources/design-system.md'));

  const bricksInspect = {
    project:{ id:'p1', name:'fixture' },
    primary_language:'PHP',
    frameworks:[{ name:'WordPress' }, { name:'WooCommerce' }],
    framework_names:['WordPress', 'WooCommerce'],
    wordpress:{
      isWordPress:true,
      parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }],
      childThemes:[{ slug:'fixture-child', template:'bricks' }]
    },
    relevant_files:[{ path:'wp-content/themes/fixture-child/functions.php' }],
    relevant_relations:[], top_symbols:[], entrypoints:[], git:{ clean:true }
  };

  const migrationSkill = loadWordPressBricksSkill(bricksInspect, 'Migrate one Bricks element ID and regenerate CSS file cache');
  assert.ok(migrationSkill, 'Bricks skill must activate from project evidence');
  assert.equal(migrationSkill.version, 2);
  const migrationNames = migrationSkill.resources.map(item => item.name);
  assert.ok(has(migrationNames, 'resources/core-checklist.md'));
  assert.ok(has(migrationNames, 'resources/migrations.md'));
  assert.ok(has(migrationNames, 'resources/snippets.md'));
  assert.equal(has(migrationNames, 'resources/design-system.md'), false);
  assert.equal(has(migrationNames, 'resources/data-seeding.md'), false);
  assert.equal(has(migrationNames, 'resources/validation.md'), false);

  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  assert.ok(Array.isArray(cases) && cases.length >= 17, 'acceptance task cases are incomplete');
  for (const testCase of cases) {
    const selected = chooseResources(manifest, testCase.request);
    for (const expected of testCase.resources) {
      assert.ok(selected.includes(expected), `${testCase.name}: resource not routed: ${expected}`);
    }
  }

  const plainWpInspect = {
    project:{ id:'p2', name:'plain-wp' },
    framework_names:['WordPress'],
    frameworks:[{ name:'WordPress' }],
    wordpress:{ isWordPress:true, parentThemes:[{ slug:'twentytwentysix' }] },
    relevant_files:[]
  };
  assert.equal(skillsForTask(plainWpInspect, 'Fix a PHP helper').length, 0, 'Bricks skill must not activate for unrelated WordPress project');

  const fakeApi = {
    startWork: async () => ({ work_session_id:'work-1', project_id:'p1', workspace_mode:'trusted', baseline:{} }),
    inspectProject: async () => bricksInspect,
    readFile: async () => { throw new Error('no package.json in fixture'); }
  };
  const prepared = await createAgentRuntime(fakeApi).prepareTask('p1', 'Build a real Bricks Woo checkout template with native order review');
  assert.equal(prepared.skills.length, 1, 'prepare_task must attach one Bricks skill');
  assert.equal(prepared.skills[0].id, 'wordpress-bricks');
  assert.equal(prepared.skills[0].version, 2);
  const preparedNames = prepared.skills[0].resources.map(item => item.name);
  assert.ok(has(preparedNames, 'resources/core-checklist.md'));
  assert.ok(has(preparedNames, 'resources/woocommerce.md'));
  assert.ok(has(preparedNames, 'resources/templates.md'));
  assert.ok(has(preparedNames, 'resources/patterns.md'));
  assert.equal(has(preparedNames, 'resources/design-system.md'), false);
  assert.equal(has(preparedNames, 'resources/data-seeding.md'), false);
  assert.equal(has(preparedNames, 'resources/validation.md'), false);
  assert.match(prepared.agent_contract.guidance[0], /skills/i, 'agent contract must make attached skills mandatory');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('CHATCODE-GPT/**/*'), 'installer package must include CHATCODE-GPT skills');
  assert.equal(pkg.scripts['test:wordpress-bricks-skill'], 'node scripts/smoke-wordpress-bricks-skill.cjs');

  console.log(`WordPress + Bricks skill v2 PASS: compact entry + progressive routing, ${collected.files.length} skill files, ${cases.length} acceptance routes`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
