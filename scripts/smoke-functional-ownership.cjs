const assert = require('assert/strict');
const {
  buildHardRuleContract,
  validateHardProjectRules,
  functionalScope,
  functionalOwnerPolicy
} = require('../core/hard-project-rules');

function prepared(request, overrides = {}) {
  const root = 'wp-content/themes/demo-child';
  const base = {
    ok:true,
    status:'ready',
    task_id:'functional-owner-task',
    request,
    execution_path:'FAST',
    context:{
      framework_names:['WordPress','Bricks'],
      frameworks:[{ name:'Bricks' }],
      relevant_files:[
        { path:`${root}/functions.php` },
        { path:`${root}/assets/css/main.css` }
      ]
    },
    project_profile:{ facts:{ builder:'bricks', global_css_owner:`${root}/assets/css/main.css` } },
    task_card:{
      version:4,
      type:'BRICKS_BUILDER',
      execution:{ path:'FAST', lane:'MICRO_UI', patch_file_limit:2, allow_new_source_files:0 },
      owner:{
        status:'confirmed',
        kind:'php_bootstrap',
        enforce_paths:[`${root}/functions.php`],
        candidates:[`${root}/functions.php`, `${root}/assets/css/main.css`],
        companions:[]
      },
      ownership_map:[
        { kind:'php_bootstrap', status:'confirmed', path:`${root}/functions.php` },
        { kind:'global_css', status:'confirmed', path:`${root}/assets/css/main.css` }
      ],
      constraints:{ new_source_files:0 }
    },
    agent_contract:{ guidance:[] }
  };
  return { ...base, ...overrides };
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

function patchCreateMany(entries) {
  return entries.map(([path, lines]) => patchCreate(path, lines)).join('\n');
}

const root = 'wp-content/themes/demo-child';

assert.equal(functionalScope('Triển khai header mới'), 'header');
assert.equal(functionalScope('Build header và footer theo mẫu'), 'header-footer');
assert.equal(functionalScope('Tiếp theo ở trang home build section như ảnh'), 'home');

const microHeader = prepared('Triển khai header mới theo layout hiện tại');
const microPolicy = functionalOwnerPolicy(microHeader);
assert.equal(microPolicy.allowed, true);
assert.equal(microPolicy.scope, 'header');
assert.equal(microPolicy.budget, 1, 'Micro UI may create at most one stable functional owner');

const microContract = buildHardRuleContract(microHeader);
assert.equal(microContract.file_creation.budget, 1);
assert.equal(microContract.file_creation.reason, 'functional-owner-split');
assert.equal(microContract.functional_ownership.allowed, true);
assert.equal(microContract.functional_ownership.scope, 'header');
assert.equal(microContract.owner_first.enforced, false, 'generic functions.php owner must not force feature code into bootstrap');
assert.equal(
  validateHardProjectRules(microContract, patchCreate(`${root}/assets/css/header.css`, '.site-header{}')).ok,
  true,
  'stable scoped header owner should be allowed'
);

const vagueHeader = validateHardProjectRules(
  microContract,
  patchCreate(`${root}/assets/css/header-fix.css`, '.site-header{}')
);
assert.equal(vagueHeader.ok, false);
assert.ok(vagueHeader.violations.some(x => /stable page\/component\/module name/i.test(x)));

const wrongScope = validateHardProjectRules(
  microContract,
  patchCreate(`${root}/assets/css/home.css`, '.home{}')
);
assert.equal(wrongScope.ok, false);
assert.ok(wrongScope.violations.some(x => /must match scope header/i.test(x)));

const perSectionSprawl = buildHardRuleContract(prepared('Ở trang home build thêm section như ảnh'));
assert.equal(perSectionSprawl.file_creation.budget, 1);
const sectionFile = validateHardProjectRules(
  perSectionSprawl,
  patchCreate(`${root}/assets/css/home-section-3.css`, '.section{}')
);
assert.equal(sectionFile.ok, false, 'file-per-section sprawl must remain blocked');
assert.ok(sectionFile.violations.some(x => /stable page\/component\/module name/i.test(x)));
assert.equal(
  validateHardProjectRules(perSectionSprawl, patchCreate(`${root}/assets/css/home.css`, '.home-section{}')).ok,
  true,
  'page-level home.css is the stable owner when no Home stylesheet exists'
);

const smallTweak = buildHardRuleContract(prepared('Sửa padding header 8px cho gọn hơn'));
assert.equal(smallTweak.file_creation.budget, 0, 'small edits must not create a new owner merely because current owner is generic');
assert.equal(smallTweak.owner_first.enforced, true);

const noNewFile = buildHardRuleContract(prepared('Không tạo file mới. Triển khai header bằng owner hiện tại.'));
assert.equal(noNewFile.file_creation.budget, 0, 'explicit no-new-file instruction must win over functional split');
assert.equal(noNewFile.file_creation.reason, 'explicit-no-new-file');

const existingHeaderPrepared = prepared('Triển khai thêm phần header theo chức năng', {
  context:{
    framework_names:['WordPress','Bricks'],
    frameworks:[{ name:'Bricks' }],
    relevant_files:[
      { path:`${root}/functions.php` },
      { path:`${root}/assets/css/main.css` },
      { path:`${root}/assets/css/header.css` }
    ]
  },
  task_card:{
    ...microHeader.task_card,
    owner:{
      status:'confirmed',
      kind:'header_css',
      enforce_paths:[`${root}/assets/css/header.css`],
      candidates:[`${root}/assets/css/header.css`, `${root}/assets/css/main.css`],
      companions:[]
    },
    ownership_map:[
      { kind:'header_css', status:'confirmed', path:`${root}/assets/css/header.css` },
      { kind:'global_css', status:'confirmed', path:`${root}/assets/css/main.css` }
    ]
  }
});
const existingHeader = buildHardRuleContract(existingHeaderPrepared);
assert.equal(existingHeader.file_creation.budget, 0, 'existing scoped owner must be reused');
assert.equal(existingHeader.owner_first.enforced, true);

const normalFeature = prepared('Triển khai header và footer mới, tách code và CSS theo chức năng', {
  task_card:{
    ...microHeader.task_card,
    type:'FAST_UI',
    execution:{ path:'FAST', lane:'FAST', patch_file_limit:4, allow_new_source_files:0 }
  }
});
const normalContract = buildHardRuleContract(normalFeature);
assert.equal(normalContract.file_creation.budget, 2, 'normal feature may create at most two stable functional owner files');
const pairedOwners = patchCreateMany([
  [`${root}/inc/templates/header.php`, ['<?php', 'function demo_header_owner() {}']],
  [`${root}/assets/css/header-footer.css`, ['.site-header{}', '.site-footer{}']]
]);
assert.equal(validateHardProjectRules(normalContract, pairedOwners).ok, true, 'bounded code + style functional owners should pass');

const bricksCustomSource = validateHardProjectRules(
  microContract,
  patchCreate(`${root}/inc/templates/header.php`, ["<?php add_shortcode('site_header', 'render_site_header');"])
);
assert.equal(bricksCustomSource.ok, false, 'functional ownership must not bypass native Bricks guard');
assert.ok(bricksCustomSource.violations.some(x => /Native Bricks is required/i.test(x)));

console.log('Functional Ownership PASS: generic entry files stay thin while stable scoped owners are allowed with bounded budgets.');
