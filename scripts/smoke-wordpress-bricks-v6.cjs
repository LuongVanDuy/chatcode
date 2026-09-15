const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readBundledSpec, resolveBricksSpec, detectBricksVersion, allKnownElements } = require('../core/bricks-spec');
const { validateBricksJson } = require('../core/bricks-validator');
const { augmentThemeRootInspection, createBricksProjectDetectionApi } = require('../core/bricks-project-detection');
const { createBricksSkillEnforcerApi, CONTRACT_VERSION, ACK_TEXT, HARD_RULES } = require('../core/bricks-skill-enforcer');
const { hasBricksProjectEvidence } = require('../core/skill-runtime');

const skillRoot = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills', 'wordpress-bricks');
const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'manifest.json'), 'utf8'));
const entry = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const core = fs.readFileSync(path.join(skillRoot, 'resources', 'core-checklist.md'), 'utf8');

assert.equal(manifest.contract_version, 6);
assert.equal(manifest.enforcement, 'task-bound');
assert.equal(manifest.acknowledgement, ACK_TEXT);
assert.equal(CONTRACT_VERSION, 6);
for (const text of [entry, core, HARD_RULES]) {
  assert.match(text, /Tôi sẽ sử dụng Bricks skill\./i);
  assert.match(text, /element ID/i);
  assert.match(text, /media|attachment/i);
  assert.match(text, /prepare_task/i);
}

const spec2313 = readBundledSpec('2.3.13');
assert.ok(spec2313, 'missing Bricks 2.3.13 spec');
assert.equal(spec2313.bricks_version, '2.3.13');
assert.equal(spec2313.schema_version, 2);
assert.match(spec2313.node.id_pattern, /a-f0-9/);
assert.ok(allKnownElements(spec2313).has('form'));
assert.ok(allKnownElements(spec2313).has('carousel'));
assert.ok(allKnownElements(spec2313).has('woocommerce-account-payment-methods'));
assert.ok(spec2313.templates.woocommerce_types.includes('wc_account_dashboard'));
assert.equal(spec2313.templates.single_type, 'content');
assert.ok(spec2313.breakpoints.defaults.some(item => item.key === 'desktop' && item.base === true));
assert.equal(spec2313.site_options.global_queries, 'bricks_global_queries');
assert.equal(spec2313.site_options.style_manager, 'bricks_style_manager');

const exactInspect = {
  project:{ id:'p1', name:'fixture' },
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder', version:'2.3.13' }],
  framework_names:['WordPress','Bricks Builder'],
  wordpress:{ isWordPress:true, parentThemes:[{ slug:'bricks', name:'Bricks', version:'2.3.13', root:'wp-content/themes/bricks' }], childThemes:[{ slug:'child', template:'bricks', version:'1.0.0' }] },
  relevant_files:[]
};
assert.equal(detectBricksVersion(exactInspect), '2.3.13');
assert.equal(resolveBricksSpec(exactInspect).status, 'exact');
assert.equal(resolveBricksSpec(exactInspect).spec_version, '2.3.13');

const childOnlyInspect = { project:{ id:'child', name:'bricks-child' }, frameworks:[], framework_names:[], wordpress:{ isWordPress:false }, relevant_files:[] };
const childStyle = `/*\nTheme Name: Client Child\nTemplate: bricks\nVersion: 1.0.0\n*/`;
const augmented = augmentThemeRootInspection(childOnlyInspect, childStyle, 'child');
assert.equal(hasBricksProjectEvidence(augmented).active, true, 'theme-root child detection must activate Bricks policy');
assert.equal(detectBricksVersion({ ...augmented, project_profile:{ facts:{ bricks_version:'1.0.0' } } }), '', 'child theme version must not become Bricks version');

(async () => {
  const detectionApi = createBricksProjectDetectionApi({
    async inspectProject(){ return childOnlyInspect; },
    async readFile(_ref,file){ if (file === 'style.css') return { content:childStyle }; throw new Error('missing'); }
  });
  const detected = await detectionApi.inspectProject('child','test',4);
  assert.equal(hasBricksProjectEvidence(detected).active, true);

  const tolerant = [
    { id:'a1b2c3', name:'section', parent:0, children:['d4e5f6'], settings:{} },
    { id:'d4e5f6', name:'heading', parent:'a1b2c3' }
  ];
  const tolerantResult = validateBricksJson(tolerant, exactInspect);
  assert.equal(tolerantResult.ok, true, JSON.stringify(tolerantResult.errors));
  assert.ok(tolerantResult.warnings.some(item => item.code === 'BRICKS_CHILDREN_IMPLICIT'));
  assert.ok(tolerantResult.warnings.some(item => item.code === 'BRICKS_SETTINGS_IMPLICIT'));
  const canonicalResult = validateBricksJson(tolerant, exactInspect, { mode:'write' });
  assert.equal(canonicalResult.ok, false);
  assert.ok(canonicalResult.errors.some(item => item.code === 'BRICKS_CHILDREN_IMPLICIT'));

  const slots = [
    { id:'a1b2c3', name:'container', parent:0, children:[], slotChildren:{ s1:['d4e5f6'] }, settings:{} },
    { id:'d4e5f6', name:'text-basic', parent:'a1b2c3', children:[], settings:{} }
  ];
  assert.equal(validateBricksJson(slots, exactInspect).ok, true, 'slotChildren must satisfy reciprocity');

  const pagination = [{ id:'a1b2c3', name:'pagination', parent:0, children:[], settings:{ queryId:'main' } }];
  assert.equal(validateBricksJson(pagination, exactInspect).ok, true, 'pagination queryId=main must be valid');

  const globalQuery = [{ id:'a1b2c3', name:'container', parent:0, children:[], settings:{ hasLoop:true, query:{ id:'global001' } } }];
  assert.equal(validateBricksJson(globalQuery, exactInspect).ok, true, 'Global Query id may replace local objectType');

  const iconDynamic = [{ id:'a1b2c3', name:'icon', parent:0, children:[], settings:{ icon:{ library:'dynamicData', dynamicData:'{featured_image}' } } }];
  assert.equal(validateBricksJson(iconDynamic, exactInspect).ok, true, 'Dynamic Data icons are valid in 2.3.13');

  const project = { id:'p1', name:'fixture', root:'/srv/fixture' };
  const store = { getProject(ref){ if (['p1','fixture'].includes(String(ref))) return project; throw new Error('missing project'); } };
  const bricksContext = exactInspect;
  const skill = { id:'wordpress-bricks', name:'WordPress + Bricks Native Delivery', version:5, mandatory:true, domains:['bricks'], bricks_spec:{ detected_version:'2.3.13', spec_version:'2.3.13', status:'exact' }, instructions:'base skill' };
  let writes = 0, patches = 0, execs = 0, completes = 0, rollbacks = 0;
  const baseApi = {
    async inspectProject(){ return { ...bricksContext, skills:[skill] }; },
    async prepareTask(){ return { ok:true, status:'ready', task_id:'task-1', work_session_id:'task-1', execution_path:'DEEP', context:bricksContext, skills:[skill], agent_contract:{ guidance:[] } }; },
    async completeTask(){ completes++; return { ok:true, status:'completed', task_id:'task-1' }; },
    async workStatus(){ return { status:'active', project_id:'p1', project:'fixture' }; },
    async startWork(){ return { work_session_id:'legacy' }; },
    async applyPatch(){ patches++; return { ok:true }; },
    async applyAndVerify(){ return { ok:true }; },
    async writeFile(){ writes++; return { ok:true }; },
    async deleteFile(){ return { ok:true }; },
    async renameFile(){ return { ok:true }; },
    async runTask(){ return { ok:true }; },
    async exec(){ execs++; return { status:'completed', exit_code:0 }; },
    async finishWork(){ return { status:'completed' }; },
    async rollbackWork(){ rollbacks++; return { status:'rolled_back' }; }
  };
  const enforced = createBricksSkillEnforcerApi(baseApi, store);

  const inspected = await enforced.inspectProject('p1','inspect',4);
  assert.equal(inspected.skill_policy.enforcement, 'task-bound');
  assert.equal(inspected.user_acknowledgement_required, ACK_TEXT);

  await assert.rejects(() => enforced.writeFile('p1','x.php','x'), error => error?.code === 'BRICKS_SKILL_TASK_REQUIRED');
  assert.equal(writes,0,'inspect must not prime low-level writes');
  await assert.rejects(() => enforced.startWork('p1','bypass'), error => error?.code === 'BRICKS_SKILL_TASK_REQUIRED');
  await assert.rejects(() => enforced.applyAndVerify('p1',[],[]), error => error?.code === 'BRICKS_SKILL_TASK_REQUIRED');

  await enforced.rollbackWork('orphan-recovery');
  assert.equal(rollbacks,1,'rollback recovery must remain available without a receipt');

  const prepared = await enforced.prepareTask('p1','Create Bricks section',8,{});
  assert.equal(prepared.skill_receipt.contract_version,6);
  assert.equal(prepared.skill_policy.acknowledgement_text,ACK_TEXT);
  assert.match(prepared.skills[0].instructions,/element ID/i);
  await assert.rejects(() => enforced.writeFile('p1','x.php','x'), error => error?.code === 'BRICKS_SKILL_TASK_REQUIRED');
  await enforced.applyPatch('p1','patch','task-1');
  await enforced.exec('p1','php -l x.php',{ work_session_id:'task-1' });
  assert.equal(patches,1);
  assert.equal(execs,1);
  const completed = await enforced.completeTask('task-1','patch',[]);
  assert.equal(completes,1);
  assert.equal(completed.skill_receipt.contract_version,6);

  console.log('WordPress + Bricks v6 PASS: 2.3.13 exact spec + tolerant tree + slot/query/component rules + child-theme detection + task-bound hard gate');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
