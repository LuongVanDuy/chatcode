const assert = require('assert/strict');
const { TASK_TYPES, classifyTask, buildTaskCard } = require('../core/task-planner');
const { createAgentRuntime } = require('../core/agent-runtime');

const bricksInspect = {
  project:{ id:'p1', name:'fixture' },
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder' }],
  framework_names:['WordPress','Bricks Builder'],
  primary_language:'PHP',
  wordpress:{
    isWordPress:true,
    woocommerce:false,
    childThemes:[{ slug:'fixture-child', template:'bricks', root:'wp-content/themes/fixture-child' }],
    parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }]
  },
  retrieval_scope:{ strategy:'wordpress-scope-first' },
  relevant_files:[
    { path:'wp-content/themes/fixture-child/assets/css/home.css', score:90 },
    { path:'wp-content/themes/fixture-child/assets/css/main.css', score:88 },
    { path:'wp-content/themes/fixture-child/elements/featured-products.php', score:86 },
    { path:'wp-content/themes/fixture-child/inc/product/post-type.php', score:84 },
    { path:'wp-content/themes/fixture-child/inc/templates/header.php', score:82 },
    { path:'wp-content/themes/fixture-child/functions.php', score:80 }
  ],
  relevant_relations:[],
  top_symbols:[],
  git:null
};

assert.equal(classifyTask('Sửa font và width container ở trang chủ', bricksInspect), TASK_TYPES.FAST_UI);
assert.equal(classifyTask('Thêm Builder controls cho Featured Products trong Bricks', bricksInspect), TASK_TYPES.BRICKS_BUILDER);
assert.equal(classifyTask('Tạo CPT sản phẩm catalog không WooCommerce và không có giá', bricksInspect), TASK_TYPES.DATA);
assert.equal(classifyTask('Upload đúng các file đã sửa qua FTP và kiểm tra live cache', bricksInspect), TASK_TYPES.PRODUCTION);
assert.equal(classifyTask('Sửa spacing của header trên mobile', bricksInspect), TASK_TYPES.FAST_UI, 'header styling alone must stay on the fast UI path');
assert.equal(classifyTask('Tạo Bricks Header template mới', bricksInspect), TASK_TYPES.BRICKS_BUILDER, 'real Bricks template work must be a Builder task');

const projectRules = [
  { key:'global-css-owner', value:'Global tokens stay in assets/css/main.css.' },
  { key:'builder-content-editable', value:'Normal Bricks content must remain editable in Builder.' },
  { key:'checkout-null-policy', value:'Normalize checkout null values to empty strings.' }
];

const fast = buildTaskCard({
  request:'Sửa font và width container ở trang chủ',
  inspect:bricksInspect,
  projectRules,
  verificationHints:[{ command_template:'php -l "{file}"' }]
});
assert.equal(fast.type, TASK_TYPES.FAST_UI);
assert.equal(fast.constraints.expected_read_limit, 4);
assert.equal(fast.constraints.new_source_files, 0);
assert.ok(fast.expected_files.length <= 4);
assert.ok(fast.owner.primary_path.endsWith('assets/css/home.css'), `unexpected owner candidate: ${fast.owner.primary_path}`);
assert.ok(fast.out_of_scope.some(item => /refactor/i.test(item)));
assert.ok(fast.decision_keys.includes('global-css-owner'));
assert.equal(fast.decision_keys.includes('checkout-null-policy'), false, 'unrelated checkout decision must not enter a font/layout Task Card');
assert.ok(JSON.stringify(fast).length < 4500, 'Task Card should stay compact');

const builder = buildTaskCard({ request:'Thêm Builder controls cho Featured Products trong Bricks', inspect:bricksInspect, projectRules });
assert.equal(builder.type, TASK_TYPES.BRICKS_BUILDER);
assert.ok(builder.owner.primary_path.includes('featured-products.php'));
assert.ok(builder.must_preserve.some(item => /Builder\/user-edited data/.test(item)));
assert.ok(builder.verification.some(item => /editable/.test(item)));
assert.ok(builder.decision_keys.includes('builder-content-editable'));

const data = buildTaskCard({ request:'Tạo CPT sản phẩm catalog không WooCommerce và không có giá', inspect:bricksInspect, projectRules });
assert.equal(data.type, TASK_TYPES.DATA);
assert.ok(data.owner.primary_path.includes('post-type.php'));
assert.ok(data.verification.some(item => /duplicate/.test(item)));
assert.ok(data.out_of_scope.some(item => /UI redesign/.test(item)));

const production = buildTaskCard({ request:'Upload đúng các file đã sửa qua FTP và kiểm tra live cache', inspect:bricksInspect, projectRules });
assert.equal(production.type, TASK_TYPES.PRODUCTION);
assert.ok(production.verification.some(item => /source of truth/.test(item)));
assert.ok(production.out_of_scope.some(item => /cache clearing/.test(item)));

(async () => {
  let extraReads = 0;
  const store = {
    getProject:() => ({ id:'p1', name:'fixture', projectRules }),
    read:() => ({ projects:[] })
  };
  const runtime = createAgentRuntime({
    startWork:async () => ({ work_session_id:'work-card', project_id:'p1', workspace_mode:'safe', baseline:{} }),
    inspectProject:async () => bricksInspect,
    readFile:async () => { extraReads++; throw new Error('unexpected extra read'); }
  }, store);
  const prepared = await runtime.prepareTask('p1', 'Sửa font và width container ở trang chủ', 8);
  assert.equal(prepared.task_card.type, TASK_TYPES.FAST_UI);
  assert.equal(prepared.task_card.constraints.expected_read_limit, 4);
  assert.equal(extraReads, 0, 'Task Planner must reuse inspected context instead of reading more files');
  assert.ok(prepared.agent_contract.guidance.some(line => /task_card/.test(line)));
  console.log('Task Planner smoke test: PASS (4 task types + compact owner/scope card + zero extra reads)');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
