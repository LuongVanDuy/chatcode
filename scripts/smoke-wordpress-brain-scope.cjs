const assert = require('assert/strict');
const { createBrainService } = require('../core/brain');

(async () => {
  const coreFiles = Array.from({ length:420 }, (_, i) => `wp-includes/core/class-core-${i}.php`);
  const files = [
    'index.php',
    'wp-settings.php',
    ...coreFiles,
    'wp-content/themes/bricks/style.css',
    'wp-content/themes/bricks/functions.php',
    'wp-content/themes/bricks/includes/elements/container.php',
    'wp-content/themes/project-child/style.css',
    'wp-content/themes/project-child/functions.php',
    'wp-content/themes/project-child/inc/header.php',
    'wp-content/themes/project-child/assets/js/site.js',
    'wp-content/plugins/woocommerce/woocommerce.php',
    'wp-content/plugins/woocommerce/includes/class-wc-cart.php',
    'wp-content/plugins/project-tools/project-tools.php',
    'wp-content/plugins/project-tools/inc/bootstrap.php',
    'wp-content/plugins/project-tools/vendor/vendor-lib.php',
    'wp-content/uploads/2026/09/image.php',
    'wp-content/cache/page-cache.php',
    'wp-content/index.php',
    'package.json',
    'composer.json'
  ];

  const content = new Map([
    ['wp-content/themes/bricks/style.css', '/*\nTheme Name: Bricks\n*/\n'],
    ['wp-content/themes/project-child/style.css', '/*\nTheme Name: Project Child\nTemplate: bricks\n*/\n.project-header{display:block}\n'],
    ['wp-content/themes/project-child/functions.php', "<?php\nrequire_once __DIR__ . '/inc/header.php';\nadd_action('wp_enqueue_scripts', 'project_assets');\nfunction project_assets() {}\n"],
    ['wp-content/themes/project-child/inc/header.php', "<?php\nfunction project_header() { return 'header'; }\n"],
    ['wp-content/themes/project-child/assets/js/site.js', "document.querySelector('.project-header');\n"],
    ['wp-content/plugins/project-tools/project-tools.php', "<?php\nrequire_once __DIR__ . '/inc/bootstrap.php';\nadd_action('init', 'project_tools_init');\nfunction project_tools_init() {}\n"],
    ['wp-content/plugins/project-tools/inc/bootstrap.php', "<?php\nfunction project_tools_bootstrap() {}\n"],
    ['wp-content/plugins/project-tools/vendor/vendor-lib.php', "<?php function vendor_should_not_be_read() {}\n"],
    ['package.json', JSON.stringify({ name:'wp-fixture' })],
    ['composer.json', JSON.stringify({ name:'fixture/wp' })],
    ['wp-content/index.php', '<?php // silence\n']
  ]);

  const reads = [];
  const store = {
    getProject(ref) {
      if (!['wp', 'WordPress Fixture'].includes(String(ref))) throw new Error(`Unknown project ${ref}`);
      return { id:'wp', name:'WordPress Fixture' };
    }
  };
  const projects = {
    toolApi:{
      listFiles:async () => files.slice(),
      readFile:async (_ref, rel) => {
        reads.push(rel);
        return { path:rel, content:content.get(rel) || `<?php function fixture_${reads.length}() {}\n` };
      }
    },
    status:() => ({ updatedAt:'fixture-index', fileCount:files.length, dirty:false })
  };

  const brain = createBrainService(store, projects);
  const record = await brain.ensure('wp', true);
  const analyzed = record.files.map(item => item.path);

  assert.equal(record.profile.isWordPress, true);
  assert.ok(record.profile.childThemes.some(item => item.root === 'wp-content/themes/project-child'), 'bootstrap style.css must identify the child theme');
  assert.ok(record.profile.customPlugins.some(item => item.root === 'wp-content/plugins/project-tools'), 'project plugin root must remain discoverable from broad metadata');

  assert.equal(record.stats.projectFiles, files.length, 'Brain must retain broad path metadata count');
  assert.equal(record.stats.metadataFiles, files.length);
  assert.equal(record.stats.contentScope, 'wordpress-owned');
  assert.ok(record.stats.metadataOnlyFiles > 400, 'most WordPress files should stay metadata-only');
  assert.ok(record.stats.contentReadFiles < 20, `expected narrow physical reads, got ${record.stats.contentReadFiles}`);
  assert.ok(record.stats.bytesAnalyzed < 1024 * 1024, 'fixture should stay far below the WordPress content budget');

  assert.ok(analyzed.includes('wp-content/themes/project-child/functions.php'));
  assert.ok(analyzed.includes('wp-content/plugins/project-tools/project-tools.php'));
  assert.equal(analyzed.some(file => file.startsWith('wp-includes/')), false, 'WordPress core must not be analyzed by default');
  assert.equal(analyzed.some(file => file.startsWith('wp-content/themes/bricks/') && file !== 'wp-content/themes/bricks/style.css'), false, 'Bricks parent source must stay outside default Brain content scope');
  assert.equal(analyzed.some(file => file.startsWith('wp-content/plugins/woocommerce/')), false, 'Woo core must stay outside default Brain content scope');
  assert.equal(analyzed.some(file => /\/vendor\//.test(file)), false, 'vendor content must stay outside default Brain content scope');
  assert.equal(analyzed.some(file => file.startsWith('wp-content/uploads/')), false, 'uploads must stay outside default Brain content scope');

  assert.equal(reads.includes('wp-settings.php'), false, 'Brain must not content-read WordPress bootstrap core by default');
  assert.equal(reads.includes('wp-content/themes/bricks/functions.php'), false, 'Brain must not content-read Bricks parent source by default');
  assert.equal(reads.includes('wp-content/plugins/woocommerce/includes/class-wc-cart.php'), false, 'Brain must not content-read Woo core by default');
  assert.equal(reads.includes('wp-content/plugins/project-tools/vendor/vendor-lib.php'), false, 'Brain must not content-read nested vendor source');
  assert.ok(reads.includes('wp-content/themes/bricks/style.css'), 'small theme style bootstrap metadata may be read to identify child/parent relationships');

  brain.shutdown();
  console.log(`WordPress Brain scope smoke test: PASS (${files.length} metadata files, ${record.stats.contentReadFiles} physical content reads)`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
