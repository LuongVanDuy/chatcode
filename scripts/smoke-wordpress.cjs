const assert = require('assert/strict');
const { createBrainService } = require('../core/brain');

const files = [
  'index.php','wp-blog-header.php','wp-load.php','wp-settings.php','wp-config.php',
  'wp-content/themes/flatsome/style.css',
  'wp-content/themes/flatsome-child/style.css',
  'wp-content/themes/flatsome-child/functions.php',
  'wp-content/themes/flatsome-child/includes/init.php',
  'wp-content/themes/flatsome-child/includes/enqueue.php',
  'wp-content/themes/flatsome-child/includes/class-checkout.php',
  'wp-content/themes/flatsome-child/woocommerce/checkout/form-billing.php',
  'wp-content/themes/flatsome-child/assets/js/main.js',
  'wp-content/themes/flatsome-child/assets/css/main.css',
  'wp-content/themes/bricks/style.css',
  'wp-content/themes/bricks-child/style.css',
  'wp-content/themes/bricks-child/functions.php',
  'wp-content/themes/bricks-child/inc/setup/home.php',
  'wp-content/themes/bricks-child/inc/templates/home.php',
  'wp-content/themes/bricks-child/elements/hero.php',
  'wp-content/themes/bricks-child/assets/css/home.css',
  'wp-content/themes/bricks-child/assets/js/home.js',
  'wp-content/plugins/woocommerce/woocommerce.php',
  'wp-content/plugins/acme-custom/acme-custom.php',
  'wp-content/plugins/duyanhwebpro/duyanhwebpro.php',
  'wp-content/plugins/duyanhwebpro/modules/multilingual/class-multilingual.php',
  'vendor/noise/readme.md'
];

const contents = {
  'index.php': `<?php require __DIR__ . '/wp-blog-header.php';`,
  'wp-blog-header.php': `<?php require_once __DIR__ . '/wp-load.php';`,
  'wp-load.php': `<?php require_once ABSPATH . 'wp-settings.php';`,
  'wp-settings.php': `<?php do_action('init');`,
  'wp-config.php': `<?php define('DB_NAME', 'blocked-in-real-project');`,
  'wp-content/themes/flatsome/style.css': `/*\nTheme Name: Flatsome\n*/`,
  'wp-content/themes/flatsome-child/style.css': `/*\nTheme Name: KidGrow Child\nTemplate: flatsome\n*/`,
  'wp-content/themes/flatsome-child/functions.php': `<?php\nrequire_once get_stylesheet_directory() . '/includes/init.php';\nadd_action('after_setup_theme', 'kidgrow_setup');\nfunction kidgrow_setup() {}\n`,
  'wp-content/themes/flatsome-child/includes/init.php': `<?php\nrequire_once __DIR__ . '/enqueue.php';\nrequire_once __DIR__ . '/class-checkout.php';\n`,
  'wp-content/themes/flatsome-child/includes/enqueue.php': `<?php\nadd_action('wp_enqueue_scripts', 'kidgrow_assets');\nfunction kidgrow_assets() {\n  wp_enqueue_script('kidgrow-main', get_stylesheet_directory_uri() . '/assets/js/main.js', [], '1.0', true);\n  wp_enqueue_style('kidgrow-main', get_stylesheet_directory_uri() . '/assets/css/main.css');\n  wp_localize_script('kidgrow-main', 'KidGrowConfig', ['ajax' => admin_url('admin-ajax.php')]);\n}\nadd_action('wp_ajax_save_address', 'save_address');\nadd_action('wp_ajax_nopriv_save_address', 'save_address');\nregister_rest_route('kidgrow/v1', '/address', ['methods' => 'POST']);\nfunction save_address() {}\n`,
  'wp-content/themes/flatsome-child/includes/class-checkout.php': `<?php\nclass KidGrow_Checkout {\n  public function boot() { add_filter('woocommerce_checkout_fields', [$this, 'fields']); }\n  public function fields($fields) { return $fields; }\n}\n`,
  'wp-content/themes/flatsome-child/woocommerce/checkout/form-billing.php': `<div class="checkout-address" id="billing-address">Address</div>`,
  'wp-content/themes/flatsome-child/assets/js/main.js': `const box = document.querySelector('.checkout-address');\nconst billing = document.getElementById('billing-address');\nconsole.log(KidGrowConfig.ajax, box, billing);`,
  'wp-content/themes/flatsome-child/assets/css/main.css': `.checkout-address { display: grid; }\n#billing-address { gap: 8px; }`,
  'wp-content/themes/bricks/style.css': `/*\nTheme Name: Bricks\nVersion: 2.3.6\n*/`,
  'wp-content/themes/bricks-child/style.css': `/*\nTheme Name: Bricks Child\nTemplate: bricks\nVersion: 1.0.0\n*/`,
  'wp-content/themes/bricks-child/functions.php': `<?php\nrequire_once get_stylesheet_directory() . '/inc/setup/home.php';\nrequire_once get_stylesheet_directory() . '/elements/hero.php';\nfunction bricks_child_home_setup() {}\n`,
  'wp-content/themes/bricks-child/inc/setup/home.php': `<?php\nrequire_once get_stylesheet_directory() . '/inc/templates/home.php';\nfunction bricks_home_setup() {}\n`,
  'wp-content/themes/bricks-child/inc/templates/home.php': `<?php function bricks_home_template() { return 'home'; }`,
  'wp-content/themes/bricks-child/elements/hero.php': `<?php class Bricks_Home_Hero_Element { public function set_controls() {} }`,
  'wp-content/themes/bricks-child/assets/css/home.css': `.bricks-home-hero { display:grid; }`,
  'wp-content/themes/bricks-child/assets/js/home.js': `document.querySelector('.bricks-home-hero');`,
  'wp-content/plugins/woocommerce/woocommerce.php': `<?php function woocommerce_bootstrap() {}`,
  'wp-content/plugins/acme-custom/acme-custom.php': `<?php add_action('init', 'acme_init'); function acme_init() {}`,
  'wp-content/plugins/duyanhwebpro/duyanhwebpro.php': `<?php\n/*\nPlugin Name: DuyAnhWebPro\nVersion: 9.9.9\n*/\n`,
  'wp-content/plugins/duyanhwebpro/modules/multilingual/class-multilingual.php': `<?php class Bricks_Multilingual_Element { public function home_element_translation() {} }`,
  'vendor/noise/readme.md': '# Vendor noise'
};

const store = { getProject(ref) { if (ref !== 'wp') throw new Error('not found'); return { id:'wp', name:'wordpress-demo', root:'C:/wp' }; } };
const projects = {
  status() { return { id:'wp', fileCount:files.length, updatedAt:'2026-08-26T20:00:00.000Z', dirty:false }; },
  toolApi: {
    async listFiles() { return files; },
    async readFile(_ref, rel) { return { path:rel, content:contents[rel] || '' }; }
  }
};

(async () => {
  const brain = createBrainService(store, projects);
  const overview = await brain.projectBrain('wp');
  assert.ok(overview.frameworks.some(x => x.name === 'WordPress'), 'WordPress not detected');
  assert.ok(overview.frameworks.some(x => x.name === 'WooCommerce'), 'WooCommerce not detected');
  assert.ok(overview.frameworks.some(x => /Flatsome|KidGrow Child/i.test(x.name)), 'child theme not detected');
  assert.ok(overview.frameworks.some(x => /Bricks Builder/i.test(x.name)), 'Bricks framework not detected from local metadata');
  assert.equal(overview.wordpress.bricks_version, '2.3.6', 'actual Bricks version must come from local theme metadata');
  assert.equal(overview.primary_language, 'PHP');
  assert.ok(overview.entrypoints.includes('index.php'), 'index.php entrypoint missing');
  assert.ok(overview.entrypoints.includes('wp-content/themes/flatsome-child/functions.php'), 'child functions.php entrypoint missing');
  assert.ok(overview.entrypoints.includes('wp-content/themes/bricks-child/functions.php'), 'Bricks child functions.php entrypoint missing');
  assert.ok(overview.stats.wordpressHooks >= 4, 'WordPress hooks not indexed');
  assert.ok(overview.stats.crossLanguageEdges >= 3, 'cross-language relations missing');

  const methods = await brain.findSymbols('wp', 'fields', 'method');
  assert.ok(methods.some(x => x.owner === 'KidGrow_Checkout'), 'PHP method owner missing');

  const functionsRelated = await brain.relatedFiles('wp', 'wp-content/themes/flatsome-child/functions.php');
  assert.ok(functionsRelated.some(x => x.path.endsWith('/includes/init.php')), 'functions.php -> includes/init.php missing');
  const enqueueRelated = await brain.relatedFiles('wp', 'wp-content/themes/flatsome-child/includes/enqueue.php');
  assert.ok(enqueueRelated.some(x => x.path.endsWith('/assets/js/main.js')), 'PHP enqueue -> JS missing');
  assert.ok(enqueueRelated.some(x => x.path.endsWith('/assets/css/main.css')), 'PHP enqueue -> CSS missing');

  const templateRelated = await brain.relatedFiles('wp', 'wp-content/themes/flatsome-child/woocommerce/checkout/form-billing.php');
  assert.ok(templateRelated.some(x => x.path.endsWith('/assets/js/main.js')), 'PHP markup -> JS selector relation missing');
  assert.ok(templateRelated.some(x => x.path.endsWith('/assets/css/main.css')), 'PHP markup -> CSS selector relation missing');

  const bootstrap = await brain.projectContext('wp', 'bootstrap request flow khởi tạo', 10);
  const top = bootstrap.files.slice(0, 6).map(x => x.path);
  assert.ok(top.includes('wp-content/themes/flatsome-child/functions.php') || top.includes('wp-content/themes/bricks-child/functions.php'), `child functions not prioritized: ${top.join(', ')}`);
  assert.ok(top.some(x => /includes\/init\.php$/.test(x) || /inc\/setup\/home\.php$/.test(x)), `child setup/init not prioritized: ${top.join(', ')}`);
  assert.equal(top.some(x => ['index.php','wp-blog-header.php','wp-load.php','wp-settings.php'].includes(x)), false, `WordPress core bootstrap must remain metadata-only by default: ${top.join(', ')}`);
  assert.ok(top.some(x => x.startsWith('wp-content/themes/') || x.startsWith('wp-content/plugins/acme-custom/')), `project-owned bootstrap context missing: ${top.join(', ')}`);
  assert.ok(!top.some(x => x.startsWith('vendor/')), 'vendor incorrectly prioritized');

  const checkout = await brain.projectContext('wp', 'fix checkout address billing shipping', 8);
  assert.ok(checkout.files.slice(0, 5).some(x => x.path.includes('flatsome-child')), 'child theme not prioritized for checkout');

  // Acceptance C: direct project_context for a clear Bricks child-theme/home/custom-elements task
  // must rank actual child-theme owners above a semantically weak unrelated plugin.
  const bricksContext = await brain.projectContext('wp', 'Bricks child theme home setup custom elements', 6);
  const bricksTop = bricksContext.files.slice(0, 6).map(x => x.path);
  assert.ok(bricksTop.length >= 3, `Bricks context unexpectedly thin: ${bricksTop.join(', ')}`);
  assert.ok(bricksTop.slice(0, 3).every(file => file.startsWith('wp-content/themes/bricks-child/')), `Bricks child owners must lead project_context: ${bricksTop.join(', ')}`);
  assert.ok(bricksTop.some(file => file === 'wp-content/themes/bricks-child/functions.php'), `Bricks child functions.php missing: ${bricksTop.join(', ')}`);
  assert.ok(bricksTop.some(file => /\/inc\/(?:setup|templates)\/home\.php$/.test(file) || /\/elements\//.test(file)), `Bricks home setup/custom element owner missing: ${bricksTop.join(', ')}`);
  const unrelatedIndex = bricksTop.findIndex(file => /duyanhwebpro\/modules\/multilingual/.test(file));
  const lastChildIndex = bricksTop.map((file,index) => file.startsWith('wp-content/themes/bricks-child/') ? index : -1).filter(index => index >= 0).pop();
  assert.ok(unrelatedIndex === -1 || unrelatedIndex > lastChildIndex, `unrelated multilingual plugin outranked Bricks child owners: ${bricksTop.join(', ')}`);

  brain.shutdown();
  console.log(`WordPress Brain smoke passed: ${overview.stats.symbols} symbols, ${overview.stats.wordpressHooks} hooks, Bricks ${overview.wordpress.bricks_version}, child-theme context prioritized`);
})().catch(error => { console.error(error); process.exit(1); });