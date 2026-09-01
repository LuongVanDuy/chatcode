const assert = require('assert/strict');
const {
  TASK_TYPES,
  EXECUTION_PATHS,
  preflightExecutionPath,
  buildTaskCard,
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
    { path:'wp-content/themes/fixture-child/functions.php', score:75, content:'<?php' }
  ],
  relevant_relations:Array.from({ length:60 }, (_,i) => ({ source:`a${i}`, target:`b${i}` })),
  top_symbols:Array.from({ length:50 }, (_,i) => ({ name:`symbol${i}` })),
  git:null
};

const rules = [
  { key:'global-css-owner', value:'Global tokens stay in assets/css/main.css.' },
  { key:'builder-content-editable', value:'Normal Bricks content must remain editable in Builder.' },
  { key:'checkout-null-policy', value:'Checkout null values become empty strings.' }
];

assert.equal(preflightExecutionPath('Sửa font và width container trang chủ').path, EXECUTION_PATHS.FAST);
const microPreflight = preflightExecutionPath('Giảm spacing product card trên mobile 8px');
assert.equal(microPreflight.path, EXECUTION_PATHS.FAST);
assert.equal(microPreflight.limits.context_files, 3);
assert.equal(microPreflight.limits.patch_files, 2);
assert.equal(microPreflight.limits.skill_chars, 3600);
assert.equal(preflightExecutionPath('Tạo Bricks Header template mới').path, EXECUTION_PATHS.DEEP);
assert.equal(preflightExecutionPath('Thêm Builder controls và repeater cho Featured Products').path, EXECUTION_PATHS.DEEP);
assert.equal(preflightExecutionPath('Migrate persisted Bricks Builder data safely').path, EXECUTION_PATHS.DEEP);
assert.equal(preflightExecutionPath('Migrate Bricks Builder JSON tree and keep stable element IDs').path, EXECUTION_PATHS.DEEP);
assert.equal(preflightExecutionPath('Update WordPress option wp_options records with rollback').path, EXECUTION_PATHS.DEEP);
assert.equal(preflightExecutionPath('Run SQL with $wpdb against a database table').path, EXECUTION_PATHS.DEEP);
assert.equal(preflightExecutionPath('Bulk import toàn bộ sản phẩm').path, EXECUTION_PATHS.DEEP);
assert.equal(preflightExecutionPath('Fix WooCommerce checkout flow').path, EXECUTION_PATHS.DEEP);
assert.equal(preflightExecutionPath('Upload file qua FTP và verify production').path, EXECUTION_PATHS.DEEP);

const explicitPath = 'wp-content/themes/bricks-child/.chatcodex-1.0.16-smoke.txt';
const explicitRequest = `Tạo đúng một file tạm tại \`${explicitPath}\`, ghi một dòng \`CHATCODEX_1_0_16_OK\`, verify rồi rollback. Không sửa database, Builder data, PHP, CSS, JavaScript, plugin hoặc file khác.`;
const explicitPreflight = preflightExecutionPath(explicitRequest);
assert.equal(explicitPreflight.path, EXECUTION_PATHS.FAST, 'negated database/Builder data must not turn explicit filesystem work into DEEP');
assert.equal(explicitPreflight.reasons.includes('persisted-data-migration'), false);
const explicitCard = buildTaskCard({ request:explicitRequest, inspect, projectRules:rules });
assert.equal(explicitCard.type, TASK_TYPES.FAST_UI);
assert.equal(explicitCard.execution.path, EXECUTION_PATHS.FAST);
assert.equal(explicitCard.execution.reasons.length, 0);
assert.equal(explicitCard.execution.allow_new_source_files, 1);
assert.equal(explicitCard.owner.kind, 'explicit_path');
assert.equal(explicitCard.owner.primary_path, explicitPath);
assert.equal(explicitCard.owner.confidence, 1);
assert.deepEqual(explicitCard.owner.candidates, []);
assert.equal(explicitCard.owner.requires_read, false);
assert.deepEqual(explicitCard.expected_files, [explicitPath]);

for (const prompt of [
  `Create \`${explicitPath}\` then rollback; do not modify database.`,
  `Create \`${explicitPath}\`; do not modify Builder data.`,
  `Tạo \`${explicitPath}\`; không sửa database.`,
  `Tạo \`${explicitPath}\`; không đụng Builder data.`
]) {
  const card = buildTaskCard({ request:prompt, inspect, projectRules:rules });
  assert.equal(card.type, TASK_TYPES.FAST_UI, prompt);
  assert.equal(card.execution.path, EXECUTION_PATHS.FAST, prompt);
  assert.equal(card.execution.reasons.includes('persisted-data-migration'), false, prompt);
}

const realBuilderMigration = buildTaskCard({ request:'Migrate Bricks Builder JSON tree, preserve element IDs and rollback persisted state safely', inspect, projectRules:rules });
assert.equal(realBuilderMigration.type, TASK_TYPES.DATA);
assert.equal(realBuilderMigration.execution.path, EXECUTION_PATHS.DEEP);
assert.ok(realBuilderMigration.execution.reasons.includes('persisted-data-migration'));
const realOptionMigration = buildTaskCard({ request:'Update WordPress option records in wp_options and verify stored values', inspect, projectRules:rules });
assert.equal(realOptionMigration.type, TASK_TYPES.DATA);
assert.equal(realOptionMigration.execution.path, EXECUTION_PATHS.DEEP);
assert.ok(realOptionMigration.execution.reasons.includes('persisted-data-migration'));

const fast = buildTaskCard({ request:'Sửa font và width container trang chủ', inspect, projectRules:rules });
assert.equal(fast.type, TASK_TYPES.FAST_UI);
assert.equal(fast.execution.path, EXECUTION_PATHS.FAST);
assert.equal(fast.execution.context_file_limit, 4);
assert.equal(fast.execution.patch_file_limit, 4);
assert.equal(fast.execution.allow_new_source_files, 0);
assert.equal(fast.execution.allow_delete, false);
assert.ok(fast.expected_files.length <= 4);

const micro = buildTaskCard({ request:'Giảm spacing product card trên mobile 8px', inspect, projectRules:rules });
assert.equal(micro.type, TASK_TYPES.FAST_UI);
assert.equal(micro.execution.path, EXECUTION_PATHS.FAST);
assert.equal(micro.execution.context_file_limit, 3);
assert.equal(micro.execution.patch_file_limit, 2);
assert.equal(micro.execution.skill_context_limit_chars, 3600);
assert.ok(micro.expected_files.length <= 3);

const simpleCpt = buildTaskCard({ request:'Đăng ký CPT sản phẩm catalog không WooCommerce trong owner hiện tại', inspect, projectRules:rules });
assert.equal(simpleCpt.type, TASK_TYPES.DATA);
assert.equal(simpleCpt.execution.path, EXECUTION_PATHS.FAST, 'simple CPT code registration should not automatically become Deep');

const builderDeep = buildTaskCard({ request:'Thêm Builder controls và repeater cho Featured Products', inspect, projectRules:rules });
assert.equal(builderDeep.type, TASK_TYPES.BRICKS_BUILDER);
assert.equal(builderDeep.execution.path, EXECUTION_PATHS.DEEP);
assert.ok(builderDeep.execution.reasons.includes('builder-schema'));

const prodDeep = buildTaskCard({ request:'Upload đúng file qua FTP và kiểm tra live production', inspect, projectRules:rules });
assert.equal(prodDeep.type, TASK_TYPES.PRODUCTION);
assert.equal(prodDeep.execution.path, EXECUTION_PATHS.DEEP);

const oneFilePatch = [
  '--- a/wp-content/themes/fixture-child/assets/css/home.css',
  '+++ b/wp-content/themes/fixture-child/assets/css/home.css',
  '@@ -1 +1 @@',
  '-.hero{}',
  '+.hero{padding:20px}',
  ''
].join('\n');
assert.equal(validatePatchAgainstTaskCard(fast, oneFilePatch).ok, true);

const explicitFilePatch = [
  '--- /dev/null',
  `+++ b/${explicitPath}`,
  '@@ -0,0 +1 @@',
  '+CHATCODEX_1_0_16_OK',
  ''
].join('\n');
assert.equal(validatePatchAgainstTaskCard(explicitCard, explicitFilePatch).ok, true, 'explicit requested file create must pass FAST scope gate');

const newFilePatch = [
  '--- /dev/null',
  '+++ b/wp-content/themes/fixture-child/assets/css/extra.css',
  '@@ -0,0 +1 @@',
  '+.x{}',
  ''
].join('\n');
assert.deepEqual(patchScopeFromUnifiedDiff(newFilePatch), [{ path:'wp-content/themes/fixture-child/assets/css/extra.css', operation:'create' }]);
assert.equal(validatePatchAgainstTaskCard(fast, newFilePatch).ok, false, 'FAST must block unrequested new source files');

const deletePatch = [
  '--- a/wp-content/themes/fixture-child/assets/css/home.css',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-.hero{}',
  ''
].join('\n');
assert.equal(validatePatchAgainstTaskCard(fast, deletePatch).ok, false, 'FAST must block delete');
assert.equal(validatePatchAgainstTaskCard(builderDeep, newFilePatch).ok, true, 'DEEP relies on existing safety/approval rules instead of Fast limits');

(async () => {
  const seenLimits = [];
  let applyCalls = 0;
  const store = {
    getProject:() => ({ id:'p1', name:'fixture', projectRules:rules }),
    read:() => ({ projects:[{ id:'p1', projectRules:rules }] }),
    write:() => {},
    normalizeProjectRules:value => value
  };
  const api = {
    startWork:async () => ({ work_session_id:`work-${seenLimits.length + 1}`, project_id:'p1', workspace_mode:'safe', baseline:{} }),
    inspectProject:async (_ref,_request,limit) => { seenLimits.push(limit); return inspect; },
    readFile:async () => { throw new Error('Fast WordPress prepare should not probe package.json'); },
    workMeta:async id => ({ work_session_id:id, project_id:'p1', workspace_mode:'safe', status:'active' }),
    applyPatch:async () => { applyCalls++; throw new Error('scope violation must be rejected before mutation'); }
  };
  const runtime = createAgentRuntime(api, store);

  const preparedFast = await runtime.prepareTask('p1', 'Sửa font và width container trang chủ', 8);
  assert.equal(preparedFast.execution_path, EXECUTION_PATHS.FAST);
  assert.equal(seenLimits[0], 4, 'Fast prepare must inspect at most four ranked files');
  assert.ok(preparedFast.context.relevant_files.length <= 4);
  assert.ok(preparedFast.context.relevant_relations.length <= 32);
  assert.ok(preparedFast.skills.every(skill => skill.resource_context.fast_compact === true));
  assert.ok(JSON.stringify(preparedFast.skills).length < 6000, 'Fast skill contract should stay below the target context budget');
  assert.ok(preparedFast.project_rules.some(rule => rule.key === 'global-css-owner'));
  assert.equal(preparedFast.project_rules.some(rule => rule.key === 'checkout-null-policy'), false, 'Fast task should inject only relevant decisions');

  await assert.rejects(
    runtime.completeTask(preparedFast.task_id, newFilePatch, []),
    error => error && error.code === 'TASK_SCOPE_VIOLATION'
  );
  assert.equal(applyCalls, 0, 'scope violation must not reach applyPatch');

  const preparedMicro = await runtime.prepareTask('p1', 'Giảm spacing product card trên mobile 8px', 8);
  assert.equal(preparedMicro.execution_path, EXECUTION_PATHS.FAST);
  assert.equal(seenLimits[1], 3, 'Micro Fast prepare must inspect at most three ranked files');
  assert.ok(preparedMicro.context.relevant_files.length <= 3);
  assert.ok(preparedMicro.context.relevant_relations.length <= 18);
  assert.ok(preparedMicro.context.top_symbols.length <= 14);
  assert.equal(preparedMicro.task_card.execution.patch_file_limit, 2);
  assert.equal(preparedMicro.task_card.execution.skill_context_limit_chars, 3600);
  assert.ok(preparedMicro.skills.every(skill => skill.resource_context.fast_compact === true));

  const preparedExplicit = await runtime.prepareTask('p1', explicitRequest, 8);
  assert.equal(preparedExplicit.execution_path, EXECUTION_PATHS.FAST);
  assert.equal(preparedExplicit.task_card.type, TASK_TYPES.FAST_UI);
  assert.equal(preparedExplicit.task_card.owner.kind, 'explicit_path');
  assert.equal(preparedExplicit.task_card.owner.primary_path, explicitPath);
  assert.equal(preparedExplicit.task_card.owner.confidence, 1);
  assert.deepEqual(preparedExplicit.task_card.expected_files, [explicitPath]);
  assert.equal(preparedExplicit.task_card.execution.reasons.includes('persisted-data-migration'), false);
  assert.ok(preparedExplicit.skills.every(skill => !skill.domains.includes('data') && !skill.domains.includes('bricks')));

  const preparedDeep = await runtime.prepareTask('p1', 'Thêm Builder controls và repeater cho Featured Products', 8);
  assert.equal(preparedDeep.execution_path, EXECUTION_PATHS.DEEP);
  assert.equal(seenLimits[3], 6, 'Deep prepare may use the six-file WordPress context cap');
  assert.ok(preparedDeep.skills.some(skill => skill.resource_context.fast_compact !== true));
  assert.ok(preparedDeep.task_card.execution.reasons.includes('builder-schema'));

  console.log('Fast/Deep routing smoke test: PASS (negation-aware explicit file FAST + real migration DEEP + compact graph + scope gate)');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});