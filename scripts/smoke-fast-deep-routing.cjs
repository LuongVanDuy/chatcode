const assert = require('assert/strict');
const {
  TASK_TYPES,
  EXECUTION_PATHS,
  EXECUTION_LANES,
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

const longKhaiReferencePrompt = 'Tiếp theo, vẫn ở trang home build cho tôi section như ảnh nhé ảnh và text thay thế được, tạm thời dùng chung 1 ảnh id 4923';
const mimoHomeExpandedPrompt = "Implement the first Home section for `/mimosa-hotel/` based on the supplied TrangTrang reference screenshot. Requirements: change both existing Mimosa Hotel header and footer logos to attachment ID 714; correct header architecture so the header is transparent, 135px tall, overlaying the top of the Home hero/slider (the image must belong to the slider section, not header background); create the first Home section as a native Bricks banner slider using new banner image attachment ID 715 for the initial slide, Builder-editable, with overlay/content/arrows styled close to reference. Keep Vietnamese UI/text. Use ChatCode v1.0.31 flow: thin bootstrap, functional owners, no shortcode/custom Bricks element, no parent/core/plugin edits, preserve existing Builder edits outside targeted logo/header structure/home first section. Create only minimal owner files if needed (e.g. dedicated home setup/content owner + dedicated home CSS), do not dump into functions.php/style.css. Header/footer existing component CSS owner is `assets/css/mimosa-hotel-shell.css`; existing one-time shell setup owner is `inc/mimosa-hotel-shell.php`. Verify Bricks tree integrity, responsive behavior, and deploy only touched files to FTP.";
const mimoOverviewExpandedPrompt = "Implement the Mimosa Hotel Overview page based on the user's two reference screenshots. Use native Bricks. Create a reusable native Bricks section/template for the top overview slider (not a custom PHP Bricks element/shortcode), using image attachment ID 715 for the first slide and keeping it easy to duplicate/edit in Builder. Build the Overview page with exactly two main sections: 1) full-width hero/overview slider with transparent existing header overlay, compact slide dots, image ID 715, no separate header background; 2) a more distinctive editorial text/introduction section inspired by the second screenshot, using current Mimosa Hotel Vietnamese brand content and the existing Be Vietnam Pro/global design tokens. Preserve existing homepage and unrelated Builder content. Prefer /mimosa-hotel/overview/ as the Overview page and update the Mimosa Hotel header 'TỔNG QUAN' link to that page if appropriate. Reuse current functional owners; no custom Bricks element source if native template/section works. Verify Builder structure/editability, responsive layout, and live frontend after deploy.";

assert.equal(preflightExecutionPath('Sửa hành vi frontend tìm kiếm sản phẩm trong owner hiện tại').path, EXECUTION_PATHS.FAST);
const microPreflight = preflightExecutionPath('Giảm spacing product card trên mobile 8px');
assert.equal(microPreflight.path, EXECUTION_PATHS.FAST);
assert.equal(microPreflight.lane, EXECUTION_LANES.MICRO_UI);
assert.equal(microPreflight.limits.context_files, 2);
assert.equal(microPreflight.limits.patch_files, 2);
assert.equal(microPreflight.limits.skill_chars, 2200);
const longKhaiHomePreflight = preflightExecutionPath('CSS lại layout trang Home, chỉnh banner và danh mục cho gọn hơn');
assert.equal(longKhaiHomePreflight.path, EXECUTION_PATHS.FAST);
assert.equal(longKhaiHomePreflight.lane, EXECUTION_LANES.MICRO_UI);
const longKhaiReferencePreflight = preflightExecutionPath(longKhaiReferencePrompt);
assert.equal(longKhaiReferencePreflight.path, EXECUTION_PATHS.FAST);
assert.equal(longKhaiReferencePreflight.lane, EXECUTION_LANES.MICRO_UI, 'reference-image section build must enter Micro UI without requiring CSS/layout wording');

for (const prompt of [mimoHomeExpandedPrompt, mimoOverviewExpandedPrompt]) {
  const route = preflightExecutionPath(prompt);
  assert.equal(route.path, EXECUTION_PATHS.FAST, 'implementation request must not become DEEP merely because acceptance wording mentions deploy/live');
  assert.equal(route.lane, EXECUTION_LANES.BUILDER_DELIVERY);
  assert.equal(route.reasons.includes('production-operation'), false);
  assert.equal(route.limits.context_files, 4);
  assert.equal(route.limits.patch_files, 4);
  assert.equal(route.limits.skill_chars, 6500);
}

const headerPreflight = preflightExecutionPath('Tạo Bricks Header template mới');
assert.equal(headerPreflight.path, EXECUTION_PATHS.FAST);
assert.equal(headerPreflight.lane, EXECUTION_LANES.FAST, 'preflight must not assume Bricks project evidence from wording alone');
const headerCard = buildTaskCard({ request:'Tạo Bricks Header template mới', inspect, projectRules:rules });
assert.equal(headerCard.type, TASK_TYPES.BRICKS_BUILDER);
assert.equal(headerCard.execution.lane, EXECUTION_LANES.BUILDER_DELIVERY, 'after inspect confirms Bricks, template delivery must use bounded Builder lane');
assert.equal(preflightExecutionPath('Thêm Builder controls và repeater cho Featured Products').path, EXECUTION_PATHS.FAST);
assert.equal(preflightExecutionPath('Thêm Builder controls và repeater cho Featured Products').lane, EXECUTION_LANES.BUILDER_DELIVERY);
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

const fast = buildTaskCard({ request:'Sửa hành vi frontend tìm kiếm sản phẩm trong owner hiện tại', inspect, projectRules:rules });
assert.equal(fast.type, TASK_TYPES.FAST_UI);
assert.equal(fast.execution.path, EXECUTION_PATHS.FAST);
assert.equal(fast.execution.lane, EXECUTION_LANES.FAST);
assert.equal(fast.execution.context_file_limit, 4);
assert.equal(fast.execution.patch_file_limit, 4);
assert.equal(fast.execution.allow_new_source_files, 0);
assert.equal(fast.execution.allow_delete, false);
assert.equal(fast.execution.latency_guard, null);
assert.ok(fast.expected_files.length <= 4);

const micro = buildTaskCard({ request:longKhaiReferencePrompt, inspect, projectRules:rules });
assert.equal(micro.type, TASK_TYPES.BRICKS_BUILDER);
assert.equal(micro.execution.path, EXECUTION_PATHS.FAST);
assert.equal(micro.execution.lane, EXECUTION_LANES.MICRO_UI);
assert.equal(micro.execution.context_file_limit, 2);
assert.equal(micro.execution.patch_file_limit, 2);
assert.equal(micro.execution.skill_context_limit_chars, 2200);
assert.equal(micro.execution.latency_guard.preferred_calls, 2);
assert.equal(micro.execution.latency_guard.discovery_round_limit, 1);
assert.equal(micro.execution.latency_guard.dependency_hop_limit, 1);
assert.equal(micro.execution.latency_guard.verification_round_limit, 1);
assert.equal(micro.execution.latency_guard.diagnostic_round_limit, 1);
assert.equal(micro.execution.latency_guard.corrective_patch_round_limit, 1);
assert.equal(micro.execution.latency_guard.allow_git_inspection, false);
assert.equal(micro.execution.latency_guard.allow_manual_ftp, false);
assert.equal(micro.execution.latency_guard.allow_browser_live_verify, false);
assert.equal(micro.execution.latency_guard.allow_database_diagnostics, false);
assert.equal(micro.execution.latency_guard.allow_snapshot_diagnostics, false);
assert.equal(micro.execution.latency_guard.auto_deploy_changed_files, true);
assert.equal(micro.execution.latency_guard.stop_after_scope_verify, true);
assert.match(micro.constraints.workflow, /prepare_task context -> patch -> complete_task/);
assert.ok(micro.expected_files.length <= 2);

for (const prompt of [mimoHomeExpandedPrompt, mimoOverviewExpandedPrompt]) {
  const builderDelivery = buildTaskCard({ request:prompt, inspect, projectRules:rules });
  assert.equal(builderDelivery.type, TASK_TYPES.BRICKS_BUILDER);
  assert.equal(builderDelivery.execution.path, EXECUTION_PATHS.FAST);
  assert.equal(builderDelivery.execution.lane, EXECUTION_LANES.BUILDER_DELIVERY);
  assert.equal(builderDelivery.execution.context_file_limit, 4);
  assert.equal(builderDelivery.execution.patch_file_limit, 4);
  assert.equal(builderDelivery.execution.skill_context_limit_chars, 6500);
  assert.equal(builderDelivery.execution.latency_guard.diagnostic_round_limit, 1);
  assert.equal(builderDelivery.execution.latency_guard.corrective_patch_round_limit, 1);
  assert.equal(builderDelivery.execution.latency_guard.final_verification_round_limit, 1);
  assert.equal(builderDelivery.execution.latency_guard.allow_manual_ftp, false);
  assert.equal(builderDelivery.execution.latency_guard.auto_deploy_changed_files, true);
  assert.equal(builderDelivery.execution.latency_guard.stop_after_scope_verify, true);
  assert.match(builderDelivery.constraints.workflow, /BUILDER_DELIVERY/);
}

const simpleCpt = buildTaskCard({ request:'Đăng ký CPT sản phẩm catalog không WooCommerce trong owner hiện tại', inspect, projectRules:rules });
assert.equal(simpleCpt.type, TASK_TYPES.DATA);
assert.equal(simpleCpt.execution.path, EXECUTION_PATHS.FAST, 'simple CPT code registration should not automatically become Deep');

const builderDelivery = buildTaskCard({ request:'Thêm Builder controls và repeater cho Featured Products', inspect, projectRules:rules });
assert.equal(builderDelivery.type, TASK_TYPES.BRICKS_BUILDER);
assert.equal(builderDelivery.execution.path, EXECUTION_PATHS.FAST);
assert.equal(builderDelivery.execution.lane, EXECUTION_LANES.BUILDER_DELIVERY);
assert.equal(builderDelivery.execution.context_file_limit, 4);
assert.equal(builderDelivery.execution.patch_file_limit, 4);

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
assert.equal(validatePatchAgainstTaskCard(builderDelivery, newFilePatch).ok, false, 'Builder Delivery still obeys owner/new-file scope limits');

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

  const preparedFast = await runtime.prepareTask('p1', 'Sửa hành vi frontend tìm kiếm sản phẩm trong owner hiện tại', 8);
  assert.equal(preparedFast.execution_path, EXECUTION_PATHS.FAST);
  assert.equal(seenLimits[0], 4, 'Standard Fast prepare must inspect at most four ranked files');
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

  const preparedMicro = await runtime.prepareTask('p1', longKhaiReferencePrompt, 8);
  assert.equal(preparedMicro.execution_path, EXECUTION_PATHS.FAST);
  assert.equal(seenLimits[1], 2, 'real Longkhai reference-image Micro UI prepare must inspect at most two ranked files');
  assert.ok(preparedMicro.context.relevant_files.length <= 2);
  assert.ok(preparedMicro.context.relevant_relations.length <= 18);
  assert.ok(preparedMicro.context.top_symbols.length <= 14);
  assert.equal(preparedMicro.task_card.execution.lane, EXECUTION_LANES.MICRO_UI);
  assert.equal(preparedMicro.task_card.execution.patch_file_limit, 2);
  assert.equal(preparedMicro.task_card.execution.skill_context_limit_chars, 2200);
  assert.equal(preparedMicro.task_card.execution.latency_guard.preferred_calls, 2);
  assert.equal(preparedMicro.task_card.execution.latency_guard.discovery_round_limit, 1);
  assert.equal(preparedMicro.task_card.execution.latency_guard.allow_manual_ftp, false);
  assert.equal(preparedMicro.task_card.execution.latency_guard.allow_browser_live_verify, false);
  assert.ok(preparedMicro.skills.every(skill => skill.resource_context.fast_compact === true));

  const preparedBuilder = await runtime.prepareTask('p1', mimoOverviewExpandedPrompt, 8);
  assert.equal(preparedBuilder.execution_path, EXECUTION_PATHS.FAST);
  assert.equal(seenLimits[2], 4, 'Mimo Builder Delivery must stay bounded to four ranked files');
  assert.equal(preparedBuilder.task_card.execution.lane, EXECUTION_LANES.BUILDER_DELIVERY);
  assert.ok(preparedBuilder.skills.every(skill => skill.resource_context.fast_compact === true));
  const builderInstructions = preparedBuilder.skills.map(skill => skill.instructions).join('\n');
  assert.match(builderInstructions, /resolve\/adopt an existing template/i, 'Mimo Builder Delivery lost duplicate-template protection in compact context');
  assert.match(builderInstructions, /short local file\/class names/i, 'Mimo Builder Delivery lost short local naming in compact context');

  const preparedExplicit = await runtime.prepareTask('p1', explicitRequest, 8);
  assert.equal(preparedExplicit.execution_path, EXECUTION_PATHS.FAST);
  assert.equal(preparedExplicit.task_card.type, TASK_TYPES.FAST_UI);
  assert.equal(preparedExplicit.task_card.owner.kind, 'explicit_path');
  assert.equal(preparedExplicit.task_card.owner.primary_path, explicitPath);
  assert.equal(preparedExplicit.task_card.owner.confidence, 1);
  assert.deepEqual(preparedExplicit.task_card.expected_files, [explicitPath]);
  assert.equal(preparedExplicit.task_card.execution.reasons.includes('persisted-data-migration'), false);
  assert.ok(preparedExplicit.skills.every(skill => !skill.domains.includes('data') && !skill.domains.includes('bricks')));

  const preparedDeep = await runtime.prepareTask('p1', 'Migrate existing persisted Bricks Builder data with rollback', 8);
  assert.equal(preparedDeep.execution_path, EXECUTION_PATHS.DEEP);
  assert.equal(seenLimits[4], 6, 'Deep prepare may use the six-file WordPress context cap');
  assert.ok(preparedDeep.skills.some(skill => skill.resource_context.fast_compact !== true));
  assert.ok(preparedDeep.task_card.execution.reasons.includes('persisted-data-migration'));

  console.log('Fast/Deep routing smoke test: PASS (LongKhai Micro UI + Mimo Builder Delivery compact naming/template guard + evidence-gated Header + true production/data DEEP)');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
