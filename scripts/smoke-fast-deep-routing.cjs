const assert = require('assert/strict');
const {
  TASK_TYPES,
  EXECUTION_PATHS,
  EXECUTION_LANES,
  preflightExecutionPath,
  buildTaskCard,
  classifyTask,
  patchScopeFromUnifiedDiff,
  validatePatchAgainstTaskCard
} = require('../core/task-planner');
const { createAgentRuntime } = require('../core/agent-runtime');

const inspect = {
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
    { path:'wp-content/themes/fixture-child/assets/css/home.css', score:100, content:'.hero{}' },
    { path:'wp-content/themes/fixture-child/assets/css/main.css', score:95, content:':root{}' },
    { path:'wp-content/themes/fixture-child/elements/featured-products.php', score:90, content:'<?php' },
    { path:'wp-content/themes/fixture-child/inc/product/post-type.php', score:85, content:'<?php' },
    { path:'wp-content/themes/fixture-child/inc/templates/header.php', score:80, content:'<?php' },
    { path:'wp-content/themes/fixture-child/functions.php', score:70, content:'<?php' }
  ],
  relevant_relations:[],
  top_symbols:[],
  git:null
};

assert.equal(EXECUTION_PATHS.DEEP, undefined, 'DEEP execution path must not exist');
assert.equal(EXECUTION_PATHS.BOUNDED, 'BOUNDED');

const longKhai = preflightExecutionPath('Tiếp theo, vẫn ở trang home build cho tôi section như ảnh nhé ảnh và text thay thế được, tạm thời dùng chung 1 ảnh id 4923');
assert.equal(longKhai.path, EXECUTION_PATHS.BOUNDED);
assert.equal(longKhai.lane, EXECUTION_LANES.MICRO_UI);
assert.equal(longKhai.limits.context_files, 2);
assert.equal(longKhai.limits.patch_files, 2);

const mimoHome = preflightExecutionPath('Build native Bricks Home page section with editable slider, deploy changed files and verify live frontend.');
assert.equal(mimoHome.path, EXECUTION_PATHS.BOUNDED);
assert.equal(mimoHome.lane, EXECUTION_LANES.BUILDER_DELIVERY);
assert.equal(mimoHome.limits.context_files, 4);
assert.equal(mimoHome.limits.patch_files, 4);

const persisted = preflightExecutionPath('Migrate persisted Bricks Builder data/templates and preserve element IDs');
assert.equal(persisted.path, EXECUTION_PATHS.BOUNDED);
assert.equal(persisted.risk.persisted_data, true);
assert.ok(persisted.risk.capabilities.includes('persisted_write'));
assert.ok(persisted.limits.context_files <= 6);
assert.ok(persisted.limits.patch_files <= 6);
assert.ok(persisted.limits.skill_chars <= 9000);

const production = preflightExecutionPath('Debug FTP deployment failure on production server');
assert.equal(production.path, EXECUTION_PATHS.BOUNDED);
assert.equal(production.risk.production, true);
assert.ok(production.risk.capabilities.includes('production_io'));

const woo = preflightExecutionPath('Fix WooCommerce checkout order state migration');
assert.equal(woo.path, EXECUTION_PATHS.BOUNDED);
assert.equal(woo.risk.woocommerce_state, true);
assert.equal(woo.risk.persisted_data, true);

assert.equal(classifyTask('Verify Bricks tree integrity without changing persisted data', inspect), TASK_TYPES.FAST_UI);
assert.equal(classifyTask('Make this Bricks section easy to duplicate/edit in Builder', inspect), TASK_TYPES.BRICKS_BUILDER);

const mimoGoal = 'User explicitly wants the existing Mimosa Hotel implementation renamed away from old mimo-hotel-* naming. Update source owners consistently and migrate persisted Bricks Builder data/templates. Preserve IDs/relationships/user edits and deploy.';
const mimo = buildTaskCard({ request:mimoGoal, inspect });
assert.equal(mimo.execution.path, EXECUTION_PATHS.BOUNDED);
assert.ok(mimo.execution.latency_guard, 'every task must be bounded');
assert.equal(mimo.execution.latency_guard.diagnostic_round_limit, 1);
assert.equal(mimo.execution.latency_guard.corrective_patch_round_limit, 1);
assert.equal(mimo.execution.latency_guard.stop_after_scope_verify, true);
assert.equal(mimo.execution.risk.persisted_data, true);
assert.ok(mimo.execution.patch_file_limit <= 6);
assert.ok(mimo.execution.skill_context_limit_chars <= 9000);
assert.doesNotMatch(mimo.constraints.workflow, /DEEP/i);

const builder = buildTaskCard({ request:'Thêm Builder controls và repeater cho Featured Products', inspect });
assert.equal(builder.type, TASK_TYPES.BRICKS_BUILDER);
assert.equal(builder.execution.lane, EXECUTION_LANES.BUILDER_DELIVERY);
assert.equal(builder.execution.patch_file_limit, 4);

function patchFor(paths) {
  return paths.map((file, i) => [
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,1 +1,1 @@',
    `-old${i}`,
    `+new${i}`
  ].join('\n')).join('\n');
}

const stateCard = buildTaskCard({ request:'Migrate persisted Bricks Builder data', inspect:{ ...inspect, relevant_files:[] } });
const sevenFiles = Array.from({ length:7 }, (_, i) => `inc/migration-${i}.php`);
assert.equal(patchScopeFromUnifiedDiff(patchFor(sevenFiles)).length, 7);
const stateScope = validatePatchAgainstTaskCard(stateCard, patchFor(sevenFiles));
assert.equal(stateScope.ok, false);
assert.ok(stateScope.violations.some(item => /limit is 6/.test(item)), 'stateful work must still have a hard patch budget');

(async () => {
  const store = {
    getProject:() => ({ id:'p1', name:'fixture' }),
    read:() => ({ projects:[] })
  };
  const runtime = createAgentRuntime({
    startWork:async () => ({ work_session_id:'mimo-task', project_id:'p1', workspace_mode:'trusted', baseline:{} }),
    inspectProject:async () => inspect,
    readFile:async () => { throw new Error('unexpected extra read'); }
  }, store);
  const prepared = await runtime.prepareTask('p1', mimoGoal, 8);
  assert.equal(prepared.execution_path, EXECUTION_PATHS.BOUNDED);
  assert.ok(prepared.task_card.execution.latency_guard);
  assert.ok(prepared.task_card.execution.skill_context_limit_chars <= 9000);
  assert.equal(prepared.agent_contract.next_tool, 'complete_task');
  console.log('Bounded routing PASS: no DEEP path; UI, Bricks, persisted data, Woo and production all use one bounded flow.');
})().catch(error => { console.error(error); process.exit(1); });