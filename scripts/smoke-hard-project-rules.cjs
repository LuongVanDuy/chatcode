const assert = require('assert/strict');
const {
  buildHardRuleContract,
  validateHardProjectRules,
  createHardProjectRulesApi
} = require('../core/hard-project-rules');

function prepared(request, overrides = {}) {
  return {
    ok:true,
    status:'ready',
    task_id:'task-1',
    request,
    execution_path:'FAST',
    context:{ framework_names:['WordPress','Bricks'], frameworks:[{ name:'Bricks' }] },
    project_profile:{ facts:{ builder:'bricks', global_css_owner:'assets/css/main.css' } },
    project_decisions:[{ key:'css-owner', value:'Shared tokens stay in assets/css/main.css.' }],
    task_card:{
      version:3,
      type:'FAST_UI',
      execution:{ path:'FAST', patch_file_limit:4, allow_new_source_files:0 },
      owner:{ status:'confirmed', kind:'product_css', enforce_paths:['assets/css/product-card.css'] },
      ownership_map:[
        { kind:'product_css', status:'confirmed', path:'assets/css/product-card.css' },
        { kind:'global_css', status:'confirmed', path:'assets/css/main.css' }
      ],
      constraints:{ new_source_files:0 }
    },
    agent_contract:{ guidance:['existing guidance'] },
    ...overrides
  };
}

function patchModify(path, oldLine, newLine) {
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,1 +1,1 @@',
    `-${oldLine}`,
    `+${newLine}`,
    ''
  ].join('\n');
}

function patchCreate(path, lines) {
  const body = Array.isArray(lines) ? lines : [String(lines || '')];
  return [
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${body.length} @@`,
    ...body.map(line => `+${line}`),
    ''
  ].join('\n');
}

(async () => {
  const base = prepared('Giảm gap product card khoảng 8px');
  const contract = buildHardRuleContract(base);
  assert.equal(contract.file_creation.budget, 0, 'targeted task must default to zero new files');
  assert.equal(contract.owner_first.enforced, true, 'confirmed owner must be binding');
  assert.equal(contract.native_bricks.enabled, true);
  assert.equal(contract.native_bricks.allow_custom_source, false);
  assert.equal(contract.global_css.owner, 'assets/css/main.css');

  const ownerPatch = patchModify('assets/css/product-card.css', '.card{gap:16px}', '.card{gap:8px}');
  assert.equal(validateHardProjectRules(contract, ownerPatch).ok, true, 'existing owner patch should pass');

  const helperCreate = patchCreate('assets/css/product-card-fix.css', '.card{gap:8px}');
  const helperCheck = validateHardProjectRules(contract, helperCreate);
  assert.equal(helperCheck.ok, false);
  assert.ok(helperCheck.violations.some(x => /file-creation budget is 0/i.test(x)), 'parallel helper file must be blocked');
  assert.ok(helperCheck.violations.some(x => /bypasses evidence-backed owner/i.test(x)), 'parallel owner must be blocked');

  const wrongOwnerPatch = patchModify('functions.php', 'old();', 'newValue();');
  const wrongOwnerCheck = validateHardProjectRules(contract, wrongOwnerPatch);
  assert.equal(wrongOwnerCheck.ok, false);
  assert.ok(wrongOwnerCheck.violations.some(x => /bypasses evidence-backed owner/i.test(x)));

  const rootPatch = [
    '--- a/assets/css/product-card.css',
    '+++ b/assets/css/product-card.css',
    '@@ -1,1 +1,4 @@',
    ' .card{gap:16px}',
    '+:root {',
    '+  --brand: #123456;',
    '+}',
    ''
  ].join('\n');
  const rootCheck = validateHardProjectRules(contract, rootPatch);
  assert.equal(rootCheck.ok, false);
  assert.ok(rootCheck.violations.some(x => /global tokens must stay/i.test(x)), ':root outside global owner must be blocked');

  const shortcodePatch = [
    '--- a/assets/css/product-card.css',
    '+++ b/assets/css/product-card.css',
    '@@ -1,1 +1,2 @@',
    ' .card{gap:16px}',
    "+add_shortcode('promo_box', 'render_promo_box');",
    ''
  ].join('\n');
  const shortcodeCheck = validateHardProjectRules(contract, shortcodePatch);
  assert.equal(shortcodeCheck.ok, false);
  assert.ok(shortcodeCheck.violations.some(x => /Native Bricks is required/i.test(x)), 'implicit shortcode must be blocked on Bricks tasks');

  // Negated source-creation language must never become an allowance.
  const negatedFile = buildHardRuleContract(prepared('Không tạo file mới, chỉ sửa owner hiện tại.'));
  assert.equal(negatedFile.file_creation.budget, 0, 'negated new-file request must stay at zero');
  assert.equal(negatedFile.owner_first.enforced, true, 'negated new-file request must keep owner binding');
  const negatedCustom = buildHardRuleContract(prepared('Do not add shortcode or custom Bricks element; use native Bricks only.'));
  assert.equal(negatedCustom.file_creation.budget, 0, 'negated custom-source request must stay at zero');
  assert.equal(negatedCustom.native_bricks.allow_custom_source, false, 'negated custom-source request must not authorize custom source');

  // Merely mentioning an existing custom element is not permission to create another source owner.
  const existingCustomMention = buildHardRuleContract(prepared('Fix padding in the existing custom Bricks element by 8px', {
    execution_path:'DEEP',
    task_card:{
      ...base.task_card,
      type:'BRICKS_BUILDER',
      execution:{ path:'DEEP', patch_file_limit:24, allow_new_source_files:'existing owner first' }
    }
  }));
  assert.equal(existingCustomMention.file_creation.budget, 0, 'existing custom element mention must not grant a new-file budget');
  assert.equal(existingCustomMention.native_bricks.allow_custom_source, false);

  const explicitFilePrepared = prepared('Create new file `assets/css/promo.css` for the isolated promo stylesheet', {
    task_card:{
      ...base.task_card,
      execution:{ path:'FAST', patch_file_limit:4, allow_new_source_files:1 },
      owner:{ status:'unknown', kind:null, enforce_paths:[] }
    }
  });
  const explicitFileContract = buildHardRuleContract(explicitFilePrepared);
  assert.equal(explicitFileContract.file_creation.budget, 1);
  assert.deepEqual(explicitFileContract.file_creation.explicit_paths, ['assets/css/promo.css']);
  assert.equal(validateHardProjectRules(explicitFileContract, patchCreate('assets/css/promo.css', '.promo{}')).ok, true, 'explicit new file path should pass');
  const wrongNewPath = validateHardProjectRules(explicitFileContract, patchCreate('assets/css/promo-helper.css', '.promo{}'));
  assert.equal(wrongNewPath.ok, false);
  assert.ok(wrongNewPath.violations.some(x => /explicit user paths/i.test(x)), 'explicit new file must not authorize sibling helper files');

  const customPrepared = prepared('Create a custom Bricks element for the special configurator', {
    execution_path:'DEEP',
    task_card:{
      ...base.task_card,
      type:'BRICKS_BUILDER',
      execution:{ path:'DEEP', patch_file_limit:24, allow_new_source_files:'existing owner first' },
      owner:{ status:'unknown', kind:null, enforce_paths:[] }
    }
  });
  const customContract = buildHardRuleContract(customPrepared);
  assert.equal(customContract.file_creation.budget, 1, 'explicit custom source request may receive one file');
  assert.equal(customContract.native_bricks.allow_custom_source, true);
  const customPatch = patchCreate('inc/elements/configurator.php', 'class Configurator extends \\Bricks\\Element {}');
  assert.equal(validateHardProjectRules(customContract, customPatch).ok, true, 'explicit custom Bricks element should be allowed within budget');

  let completedCalls = 0;
  const fake = {
    prepareTask:async () => base,
    completeTask:async () => { completedCalls++; return { ok:true, status:'completed', task_card:base.task_card }; }
  };
  const wrapped = createHardProjectRulesApi(fake);
  const runtimePrepared = await wrapped.prepareTask('demo', base.request, 4);
  assert.equal(runtimePrepared.task_card.execution.allow_new_source_files, 0);
  assert.equal(runtimePrepared.task_card.constraints.hard_project_rules, 'enforced');
  assert.ok(runtimePrepared.agent_contract.guidance.some(x => /Hard file-creation budget: 0/i.test(x)));
  await assert.rejects(
    () => wrapped.completeTask(runtimePrepared.task_id, helperCreate, []),
    error => error?.code === 'TASK_SCOPE_VIOLATION' || error?.details?.code === 'TASK_SCOPE_VIOLATION' || /Hard Project Rules/i.test(String(error?.message || ''))
  );
  assert.equal(completedCalls, 0, 'hard-rule rejection must happen before raw complete/apply');
  const runtimeCompleted = await wrapped.completeTask(runtimePrepared.task_id, ownerPatch, []);
  assert.equal(runtimeCompleted.status, 'completed');
  assert.equal(completedCalls, 1);
  assert.equal(runtimeCompleted.hard_rules_check.ok, true);

  console.log('Hard Project Rules PASS: owner-first + zero-default file budget + negation-safe native Bricks + global CSS owner guards.');
})().catch(error => { console.error(error); process.exit(1); });
