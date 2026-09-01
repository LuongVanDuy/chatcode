const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { createAgentRuntime } = require('../core/agent-runtime');
const { TASK_TYPES, EXECUTION_PATHS, patchScopeFromUnifiedDiff } = require('../core/task-planner');

const ROOT = 'wp-content/themes/fixture-child';
const p = rel => `${ROOT}/${rel}`;

const catalog = {
  main:{ path:p('assets/css/main.css'), content:':root{--container-width:1200px;--font-family:Inter;}', symbols:[] },
  home:{ path:p('assets/css/home.css'), content:'.home{padding:20px}', symbols:[] },
  productsCss:{ path:p('assets/css/products.css'), content:'.product-card{display:grid}', symbols:[] },
  headerCss:{ path:p('assets/css/header-footer.css'), content:'.site-header{display:flex}', symbols:[] },
  card:{ path:p('inc/product/card.php'), content:'<?php function eup_product_card(){ return ""; }', symbols:[{ name:'eup_product_card', kind:'function', line:1 }] },
  featured:{ path:p('elements/featured-products.php'), content:'<?php class Featured_Products_Element {}', symbols:[{ name:'Featured_Products_Element', kind:'class', line:1 }] },
  tabs:{ path:p('elements/intro-tabs.php'), content:'<?php class Intro_Tabs_Element {}', symbols:[{ name:'Intro_Tabs_Element', kind:'class', line:1 }] },
  nativePage:{ path:p('elements/native-page.php'), content:'<?php class Native_Page_Element {}', symbols:[{ name:'Native_Page_Element', kind:'class', line:1 }] },
  header:{ path:p('inc/templates/header.php'), content:'<?php function render_site_header(){}', symbols:[{ name:'render_site_header', kind:'function', line:1 }] },
  footer:{ path:p('inc/templates/footer.php'), content:'<?php function render_site_footer(){}', symbols:[{ name:'render_site_footer', kind:'function', line:1 }] },
  archive:{ path:p('inc/templates/archive-product.php'), content:'<?php function render_product_archive(){}', symbols:[{ name:'render_product_archive', kind:'function', line:1 }] },
  single:{ path:p('inc/templates/single-product.php'), content:'<?php function render_product_single(){}', symbols:[{ name:'render_product_single', kind:'function', line:1 }] },
  wooSingle:{ path:p('woocommerce/single-product.php'), content:'<?php function render_wc_single(){}', symbols:[{ name:'render_wc_single', kind:'function', line:1 }] },
  postType:{ path:p('inc/product/post-type.php'), content:"<?php register_post_type('eup_product', []);", symbols:[] },
  importer:{ path:p('inc/import/products-import.php'), content:'<?php function import_products_exact_mapping(){}', symbols:[{ name:'import_products_exact_mapping', kind:'function', line:1 }] },
  migration:{ path:p('inc/migrations/normalize-products.php'), content:'<?php function migrate_products_idempotent(){}', symbols:[{ name:'migrate_products_idempotent', kind:'function', line:1 }] }
};

function patchFile(file, before = '/* before */', after = '/* after */') {
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1 +1 @@',
    `-${before}`,
    `+${after}`,
    ''
  ].join('\n');
}

function patchFiles(files) {
  return files.map((file,index) => patchFile(file, `old-${index}`, `new-${index}`)).join('');
}

const scenarios = [
  {
    id:'01-global-font', label:'Đổi font toàn site', request:'Đổi font toàn site sang Inter trong global CSS owner hiện tại',
    files:['main','home','headerCss','productsCss'], patch:patchFile(catalog.main.path),
    expect:{ type:TASK_TYPES.FAST_UI, path:EXECUTION_PATHS.FAST, owner:'global_css' }
  },
  {
    id:'02-home-container-global-root', label:'Sửa width/container một section', request:'Sửa width container trang chủ',
    files:['home','main','headerCss','productsCss'], patch:patchFile(catalog.main.path, ':root{}', ':root{--container-width:1180px}'),
    expect:{ type:TASK_TYPES.FAST_UI, path:EXECUTION_PATHS.FAST, owner:'homepage_css', enforceIncludes:[catalog.home.path,catalog.main.path] }
  },
  {
    id:'03-shared-product-card', label:'Dùng chung product card', request:'Dùng chung product card hiện tại ở trang chủ, không tạo renderer mới',
    files:['card','productsCss','home','main'], patch:'',
    expect:{ type:TASK_TYPES.FAST_UI, path:EXECUTION_PATHS.FAST, owner:'product_renderer' }
  },
  {
    id:'04-native-bricks-page', label:'Tạo page native Bricks', request:'Tạo page native Bricks mới, nội dung phải chỉnh được trong Builder',
    files:['nativePage','main','home','header'], patch:patchFile(catalog.nativePage.path),
    expect:{ type:TASK_TYPES.BRICKS_BUILDER, path:EXECUTION_PATHS.DEEP, owner:'builder_component' }
  },
  {
    id:'05-featured-controls', label:'Thêm controls Featured Products', request:'Thêm Builder controls cho Featured Products để chọn sản phẩm thủ công',
    files:['featured','card','productsCss','main','home','postType'], patch:patchFile(catalog.featured.path),
    expect:{ type:TASK_TYPES.BRICKS_BUILDER, path:EXECUTION_PATHS.DEEP, owner:'builder_component' }
  },
  {
    id:'06-tabs-repeater', label:'Thêm repeater tab giới thiệu', request:'Thêm repeater Builder cho tab giới thiệu gồm title, content và image',
    files:['tabs','main','home','featured','card','productsCss'], patch:patchFile(catalog.tabs.path),
    expect:{ type:TASK_TYPES.BRICKS_BUILDER, path:EXECUTION_PATHS.DEEP, owner:'builder_component' }
  },
  {
    id:'07-header-footer-template', label:'Header/Footer template', request:'Sửa Bricks Header và Footer template hiện tại, giữ dữ liệu Builder',
    files:['header','footer','headerCss','main','home','card'], patch:patchFiles([catalog.header.path,catalog.footer.path]),
    expect:{ type:TASK_TYPES.BRICKS_BUILDER, path:EXECUTION_PATHS.DEEP, owner:'header_template' }
  },
  {
    id:'08-archive-single-template', label:'Archive/Single template', request:'Sửa Bricks Archive và Single template sản phẩm hiện tại',
    files:['archive','single','productsCss','card','main','postType'], patch:patchFiles([catalog.archive.path,catalog.single.path]),
    expect:{ type:TASK_TYPES.BRICKS_BUILDER, path:EXECUTION_PATHS.DEEP, owner:'archive_template' }
  },
  {
    id:'09-nonwoo-cpt', label:'CPT sản phẩm không WooCommerce', request:'Sửa đăng ký CPT sản phẩm catalog không WooCommerce, không có giá',
    files:['postType','card','productsCss','main'], patch:patchFile(catalog.postType.path),
    expect:{ type:TASK_TYPES.DATA, path:EXECUTION_PATHS.FAST, owner:'data_model', commerce:'custom_cpt' }
  },
  {
    id:'10-woo-single-product', label:'WooCommerce Single Product', request:'Sửa Bricks WooCommerce Single Product template hiện tại', woo:true,
    files:['wooSingle','productsCss','main','card','header','footer'], patch:patchFile(catalog.wooSingle.path),
    expect:{ type:TASK_TYPES.BRICKS_BUILDER, path:EXECUTION_PATHS.DEEP, owner:'single_template', commerce:'woocommerce' }
  },
  {
    id:'11-bulk-import', label:'Bulk import mapping chính xác', request:'Bulk import toàn bộ sản phẩm với mapping chính xác và không duplicate',
    files:['importer','postType','card','main','productsCss','home'], patch:patchFile(catalog.importer.path),
    expect:{ type:TASK_TYPES.DATA, path:EXECUTION_PATHS.DEEP }
  },
  {
    id:'12-db-migration', label:'Migration DB idempotent + rollback', request:'Migration DB sản phẩm không trùng, idempotent và có rollback',
    files:['migration','postType','importer','main','card','productsCss'], patch:patchFile(catalog.migration.path),
    expect:{ type:TASK_TYPES.DATA, path:EXECUTION_PATHS.DEEP }
  }
];

function makeInspect(scenario, limit) {
  const ordered = scenario.files.map(key => catalog[key]);
  const selected = ordered.slice(0, Math.max(1, Number(limit) || 6)).map((item,index) => ({
    path:item.path,
    score:100 - index * 3,
    role:item.path.endsWith('.css') ? 'stylesheet' : 'project-source',
    symbols:item.symbols || [],
    content:item.content
  }));
  const topSymbols = ordered.flatMap(item => (item.symbols || []).map(symbol => ({ ...symbol, path:item.path })));
  return {
    ok:true,
    project:{ id:`bench-${scenario.id}`, name:scenario.label, permissions:{ read:true, write:true } },
    frameworks:[{ name:'WordPress' }, { name:'Bricks Builder' }, ...(scenario.woo ? [{ name:'WooCommerce' }] : [])],
    framework_names:['WordPress','Bricks Builder', ...(scenario.woo ? ['WooCommerce'] : [])],
    primary_language:'PHP',
    entrypoints:[p('functions.php')],
    wordpress:{
      isWordPress:true,
      woocommerce:!!scenario.woo,
      childThemes:[{ slug:'fixture-child', template:'bricks', root:ROOT }],
      parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }]
    },
    retrieval_scope:{ strategy:'wordpress-scope-first', benchmark_fixture:true },
    relevant_files:selected,
    relevant_relations:[],
    top_symbols:topSymbols,
    git:null,
    telemetry:{ filesystem_ms:0, brain_refresh_ms:0, git_ms:0 }
  };
}

function createStore(projectId) {
  let state = {
    projects:[{
      id:projectId,
      name:projectId,
      root:'/benchmark/wordpress',
      projectRules:[],
      projectProfile:{
        version:1,
        facts:{
          cms:'wordpress', builder:'bricks',
          global_css_owner:catalog.main.path,
          shared_product_renderer:'eup_product_card'
        },
        factSources:{ global_css_owner:'benchmark', shared_product_renderer:'benchmark' },
        decisions:[], updatedAt:''
      }
    }]
  };
  return {
    getProject(ref) {
      const project = state.projects.find(item => item.id === ref) || state.projects[0];
      if (!project) throw new Error('project not found');
      return project;
    },
    read() { return state; },
    write(next) { state = next; }
  };
}

function createFixtureApi(scenario, counters) {
  const taskState = { id:'', changed:[] };
  return {
    async startWork(projectId) {
      taskState.id = `work-${scenario.id}`;
      return { work_session_id:taskState.id, project_id:projectId, workspace_mode:'safe', baseline:{} };
    },
    async inspectProject(_ref,_request,limit) {
      const inspect = makeInspect(scenario, limit);
      counters.files_read += inspect.relevant_files.length;
      return inspect;
    },
    async readFile(_projectId,file) {
      counters.files_read++;
      if (file === 'package.json') return { content:'{}' };
      const found = Object.values(catalog).find(item => item.path === file);
      if (!found) throw new Error(`missing benchmark file ${file}`);
      return { content:found.content };
    },
    async workMeta() { return { work_session_id:taskState.id, project_id:`bench-${scenario.id}`, workspace_mode:'safe', status:'active' }; },
    async applyPatch(_projectId,patch) {
      counters.mutations++;
      const files = patchScopeFromUnifiedDiff(patch);
      taskState.changed = files;
      return { ok:true, files, changed_files:files, git:null, brain:null, recovery_points:[] };
    },
    async runTask(_projectId,command) {
      counters.terminal_processes++;
      return { ok:true, code:0, stdout:`verified ${command}`, stderr:'' };
    },
    async gitStatus() {
      counters.git_calls++;
      return { ok:true, stdout:'', stderr:'' };
    },
    async workStatus() { return { work_session_id:taskState.id, project_id:`bench-${scenario.id}`, workspace_mode:'safe', status:'active', changed_files:taskState.changed, current:{ git:null }, recovery_points:[] }; },
    async finishWork() { return { status:'completed', changed_files:taskState.changed, recovery_points:[], final:{ git:null }, brain:null }; },
    async rollbackWork() { counters.rollbacks++; return { status:'rolled_back' }; }
  };
}

async function runScenario(scenario) {
  const counters = { files_read:0, git_calls:0, terminal_processes:0, mutations:0, rollbacks:0 };
  const projectId = `bench-${scenario.id}`;
  const runtime = createAgentRuntime(createFixtureApi(scenario,counters), createStore(projectId));
  const started = Date.now();
  let prepared, completed, scopeViolations = 0, verificationFailures = 0;
  let mcpCalls = 0;
  try {
    mcpCalls++;
    prepared = await runtime.prepareTask(projectId, scenario.request, 8);
    const firstPatchMs = Date.now() - started;
    mcpCalls++;
    completed = await runtime.completeTask(prepared.task_id, scenario.patch, []);
    const totalMs = Date.now() - started;
    verificationFailures = (completed.verification || []).filter(item => !item.ok).length;
    const patchScope = patchScopeFromUnifiedDiff(scenario.patch);
    const metrics = {
      mcp_calls:mcpCalls,
      time_to_first_patch_ms:firstPatchMs,
      total_duration_ms:totalMs,
      files_read:counters.files_read,
      context_chars:JSON.stringify({ context:prepared.context, skills:prepared.skills, project_profile:prepared.project_profile, task_card:prepared.task_card, verification_hints:prepared.verification_hints }).length,
      skill_chars:JSON.stringify(prepared.skills || []).length,
      changed_files:(completed.changed_files || []).length,
      new_files:patchScope.filter(item => item.operation === 'create').length,
      git_calls:counters.git_calls,
      terminal_processes:counters.terminal_processes,
      correction_rounds:0,
      verification_failures:verificationFailures,
      scope_violations:scopeViolations
    };
    const checks = [];
    const check = (name, ok, detail = '') => checks.push({ name, ok:!!ok, detail });
    check('task_type', prepared.task_card.type === scenario.expect.type, `${prepared.task_card.type}`);
    check('execution_path', prepared.execution_path === scenario.expect.path, `${prepared.execution_path}`);
    if (scenario.expect.owner) check('owner', prepared.task_card.owner.kind === scenario.expect.owner, `${prepared.task_card.owner.kind}`);
    if (scenario.expect.commerce) check('commerce', prepared.project_profile.facts.commerce === scenario.expect.commerce, `${prepared.project_profile.facts.commerce || ''}`);
    for (const ownerPath of scenario.expect.enforceIncludes || []) check(`owner_set:${path.basename(ownerPath)}`, (prepared.task_card.owner.enforce_paths || []).includes(ownerPath), JSON.stringify(prepared.task_card.owner.enforce_paths));
    check('completed', completed.status === 'completed' && completed.verification_passed === true, completed.status);
    check('git_calls_zero', metrics.git_calls === 0, `${metrics.git_calls}`);
    check('verification_failures_zero', metrics.verification_failures === 0, `${metrics.verification_failures}`);
    check('scope_violations_zero', metrics.scope_violations === 0, `${metrics.scope_violations}`);
    check('correction_rounds_zero', metrics.correction_rounds === 0, `${metrics.correction_rounds}`);
    if (scenario.expect.path === EXECUTION_PATHS.FAST) {
      check('fast_mcp_calls', metrics.mcp_calls <= 3, `${metrics.mcp_calls}`);
      check('fast_files_read', metrics.files_read <= 4, `${metrics.files_read}`);
      check('fast_new_files', metrics.new_files === 0, `${metrics.new_files}`);
      check('fast_skill_chars', metrics.skill_chars < 6000, `${metrics.skill_chars}`);
      check('fast_context_chars', metrics.context_chars < 50000, `${metrics.context_chars}`);
      check('fast_first_patch', metrics.time_to_first_patch_ms < 30000, `${metrics.time_to_first_patch_ms}ms`);
      check('fast_total', metrics.total_duration_ms < 90000, `${metrics.total_duration_ms}ms`);
    }
    return {
      id:scenario.id,
      scenario:scenario.label,
      request:scenario.request,
      task_type:prepared.task_card.type,
      execution_path:prepared.execution_path,
      owner:{ kind:prepared.task_card.owner.kind, status:prepared.task_card.owner.status, primary_path:prepared.task_card.owner.primary_path, enforce_paths:prepared.task_card.owner.enforce_paths || [] },
      metrics,
      pass:checks.every(item => item.ok),
      checks
    };
  } catch (error) {
    if (error?.code === 'TASK_SCOPE_VIOLATION') scopeViolations++;
    return {
      id:scenario.id,
      scenario:scenario.label,
      request:scenario.request,
      task_type:prepared?.task_card?.type || null,
      execution_path:prepared?.execution_path || null,
      owner:prepared?.task_card?.owner || null,
      metrics:{
        mcp_calls:mcpCalls,
        time_to_first_patch_ms:prepared ? Date.now() - started : null,
        total_duration_ms:Date.now() - started,
        files_read:counters.files_read,
        context_chars:prepared ? JSON.stringify(prepared).length : 0,
        skill_chars:prepared ? JSON.stringify(prepared.skills || []).length : 0,
        changed_files:0,
        new_files:0,
        git_calls:counters.git_calls,
        terminal_processes:counters.terminal_processes,
        correction_rounds:0,
        verification_failures:verificationFailures,
        scope_violations:scopeViolations
      },
      pass:false,
      error:{ code:error?.code || 'ERROR', message:String(error?.message || error) },
      checks:[]
    };
  }
}

(async () => {
  const results = [];
  for (const scenario of scenarios) results.push(await runScenario(scenario));
  const fast = results.filter(item => item.execution_path === EXECUTION_PATHS.FAST);
  const summary = {
    scenarios:results.length,
    passed:results.filter(item => item.pass).length,
    failed:results.filter(item => !item.pass).length,
    fast_scenarios:fast.length,
    fast_max_mcp_calls:Math.max(...fast.map(item => item.metrics.mcp_calls),0),
    fast_max_files_read:Math.max(...fast.map(item => item.metrics.files_read),0),
    fast_max_context_chars:Math.max(...fast.map(item => item.metrics.context_chars),0),
    fast_max_skill_chars:Math.max(...fast.map(item => item.metrics.skill_chars),0),
    total_git_calls:results.reduce((sum,item) => sum + item.metrics.git_calls,0),
    total_scope_violations:results.reduce((sum,item) => sum + item.metrics.scope_violations,0),
    total_verification_failures:results.reduce((sum,item) => sum + item.metrics.verification_failures,0),
    total_correction_rounds:results.reduce((sum,item) => sum + item.metrics.correction_rounds,0)
  };
  const report = { version:'v1.0.9-stage8', generated_at:new Date().toISOString(), fixture:true, note:'CI orchestration benchmark; live DB/FTP/Builder acceptance is separate.', summary, results };
  const output = process.env.BENCHMARK_OUTPUT || '';
  if (output) fs.writeFileSync(output, `${JSON.stringify(report,null,2)}\n`);
  console.table(results.map(item => ({ id:item.id, path:item.execution_path, type:item.task_type, owner:item.owner?.kind || '', calls:item.metrics.mcp_calls, reads:item.metrics.files_read, context:item.metrics.context_chars, git:item.metrics.git_calls, terminal:item.metrics.terminal_processes, pass:item.pass })));
  console.log('Stage 8 benchmark summary:', JSON.stringify(summary));
  const failures = results.filter(item => !item.pass);
  if (failures.length) {
    for (const item of failures) console.error(`FAIL ${item.id}:`, item.error || item.checks.filter(check => !check.ok));
    process.exitCode = 1;
    return;
  }
  assert.equal(results.length, 12);
  assert.equal(summary.total_git_calls, 0);
  assert.equal(summary.total_scope_violations, 0);
  console.log('Stage 8 benchmark: PASS (12 historical WordPress + Bricks scenarios)');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
