const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWordPressBricksSkill, skillsForTask, chooseResources } = require('../core/skill-runtime');
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

(async () => {
  const entryFile = path.join(skillRoot, 'SKILL.md');
  const manifestFile = path.join(skillRoot, 'manifest.json');
  const casesFile = path.join(skillRoot, 'tests', 'acceptance-cases.json');

  assert.equal(fs.existsSync(entryFile), true, 'SKILL.md missing');
  assert.equal(fs.existsSync(manifestFile), true, 'manifest missing');
  assert.equal(fs.existsSync(casesFile), true, 'acceptance cases missing');

  const collected = collectText(skillRoot);
  const text = collected.text;
  const lower = text.toLowerCase();
  const entry = fs.readFileSync(entryFile, 'utf8');
  const entryLower = entry.toLowerCase();

  // Independence: the installed skill must not require the former reference project.
  for (const forbidden of ['tongkhokhoathongminh.com', 'tongkhokhoathongminh', 'tkk-', 'd:\\duyanhweb']) {
    assert.equal(lower.includes(forbidden), false, `skill must not depend on reference-project value: ${forbidden}`);
  }

  // Bricks-native priority must be ordered exactly as the v2 contract.
  const nativePos = entryLower.indexOf('bricks native element/control/template');
  const dynamicPos = entryLower.indexOf('bricks dynamic data / query loop');
  const wpPos = entryLower.indexOf('wordpress or woocommerce public api/hook');
  const customPos = entryLower.indexOf('custom bricks element');
  assert.ok(nativePos >= 0 && nativePos < dynamicPos && dynamicPos < wpPos && wpPos < customPos, 'Bricks-native priority order is wrong');

  requireText(lower, [
    // Native elements.
    '`section`', '`container`', '`block`', '`heading`', '`text-basic`', '`text`', '`button`', '`image`',
    '`nav-menu`', '`search`', '`slider`', '`posts`', '`post-title`', '`post-content`', '`post-navigation`', '`related-posts`',
    '`woocommerce-products`', '`woocommerce-products-archive-description`', '`woocommerce-cart-items`', '`woocommerce-cart-coupon`',
    '`woocommerce-cart-collaterals`', '`woocommerce-checkout-customer-details`', '`woocommerce-checkout-order-review`', '`woocommerce-checkout-thankyou`',

    // Bricks data/template storage.
    'id', 'name', 'parent', 'children', 'settings', 'six-character alphanumeric',
    'BRICKS_DB_TEMPLATE_SLUG', 'BRICKS_DB_TEMPLATE_TYPE', 'BRICKS_DB_PAGE_CONTENT', 'BRICKS_DB_HEADER', 'BRICKS_DB_FOOTER', 'BRICKS_DB_TEMPLATE_SETTINGS',
    "templateConditions => [['main' => 'any']]", 'main=postType', "postType=['post']", "postType=['product']",
    'main=archiveType', "archiveType=['term']", 'archiveTermsIncludeChildren=true',
    'wc_archive', 'wc_cart', 'wc_cart_empty', 'wc_form_checkout', 'wc_thankyou',

    // Seed/migration/delete.
    'seed once', 'source of truth', 'targeted migration', 'migration marker', 'compare-and-set',
    'medium_large', 'large', 'deleting an element', 'remove the deleted id', 'backup', 'idempotent',

    // CSS/cache.
    'clean_post_cache($post_id)', "\\Bricks\\Database::get_setting('cssLoading')", '\\Bricks\\Assets_Files::generate_post_css_file',
    '`content`', '`header`', '`footer`',

    // Menus/archive/single/Woo.
    'register_nav_menus()', 'wp_create_nav_menu()', 'wp_update_nav_menu_item()', 'get_nav_menu_locations()',
    'is_archive_main_query=true', 'product_type', 'product_visibility',
    'dataSource=wordpress', 'woocommerce-checkout-thankyou', 'woocommerce-checkout-customer-details', 'woocommerce-checkout-order-review',
    'wc_get_page_id()', 'classic shortcode', 'reversible',

    // Custom element/assets/discovery/responsive.
    'extends `\\Bricks\\Element`', 'filemtime()', 'Bricks Builder',
    'inc/setup/', 'inc/header/', 'inc/home/', 'inc/blog/', 'inc/shop/', 'inc/product/', 'inc/pages/', 'elements/', 'assets/css/', 'assets/js/',
    'minmax(0, 1fr)', 'width:100%', 'aspect-ratio', 'object-fit',
    'page_on_front', 'wc_get_page_permalink()', 'get_page_by_path()', 'get_object_taxonomies()', 'wc_get_attribute_taxonomies()',
    'WordPress core', 'Bricks parent theme', 'WooCommerce core'
  ]);

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.id, 'wordpress-bricks');
  assert.equal(manifest.version, 2, 'WordPress + Bricks skill manifest must be v2');
  for (const resource of [
    'resources/patterns.md', 'resources/templates.md', 'resources/woocommerce.md',
    'resources/migrations.md', 'resources/snippets.md', 'resources/validation.md'
  ]) {
    assert.ok(manifest.resources.includes(resource), `manifest missing resource: ${resource}`);
    assert.equal(fs.existsSync(path.join(skillRoot, resource)), true, `resource file missing: ${resource}`);
  }

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
  assert.ok(migrationSkill.resources.some(item => item.name === 'resources/migrations.md'));
  assert.ok(migrationSkill.resources.some(item => item.name === 'resources/snippets.md'));
  assert.ok(migrationSkill.resources.some(item => item.name === 'resources/validation.md'));

  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  assert.ok(Array.isArray(cases) && cases.length >= 10, 'acceptance task cases are incomplete');
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
  assert.ok(prepared.skills[0].resources.some(item => item.name === 'resources/woocommerce.md'));
  assert.ok(prepared.skills[0].resources.some(item => item.name === 'resources/templates.md'));
  assert.match(prepared.agent_contract.guidance[0], /skills/i, 'agent contract must make attached skills mandatory');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('CHATCODE-GPT/**/*'), 'installer package must include CHATCODE-GPT skills');
  assert.equal(pkg.scripts['test:wordpress-bricks-skill'], 'node scripts/smoke-wordpress-bricks-skill.cjs');

  console.log(`WordPress + Bricks skill v2 PASS: ${collected.files.length} skill files, ${cases.length} acceptance routes, independence + prepare_task activation OK`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
