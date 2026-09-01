const assert = require('node:assert/strict');
const {
  readBundledSpec,
  detectBricksVersion,
  resolveBricksSpec,
  searchBricksKnowledge,
  formatBricksKnowledge
} = require('../core/bricks-spec');
const { validateBricksJson } = require('../core/bricks-validator');
const { loadWordPressBricksSkill } = require('../core/skill-runtime');
const { runBricksJsonVerification } = require('../core/agent-runtime');

const bundled = readBundledSpec();
assert.ok(bundled);
assert.equal(bundled.bricks_version, '2.3.6');
assert.equal(bundled.schema_version, 1);

const exactInspect = {
  project:{ id:'bricks-spec-fixture', name:'fixture' },
  framework_names:['WordPress','Bricks Builder'],
  frameworks:[{ name:'WordPress' }, { name:'Bricks Builder' }],
  wordpress:{
    isWordPress:true,
    parentThemes:[{ slug:'bricks', version:'2.3.6' }],
    childThemes:[{ slug:'fixture-child', template:'bricks' }]
  },
  project_profile:{ facts:{ builder:'bricks', bricks_version:'2.3.6' } },
  relevant_files:[]
};

assert.equal(detectBricksVersion(exactInspect), '2.3.6');
assert.equal(detectBricksVersion({
  framework_names:['WordPress','Bricks Builder'],
  wordpress:{
    bricks_version:'2.3.6',
    parent_themes:[{ slug:'bricks', name:'Bricks', version:'2.3.6' }],
    child_themes:[{ slug:'bricks-child', template:'bricks', version:'1.0.0' }]
  }
}), '2.3.6', 'snake_case local WordPress summary must expose actual Bricks version');

const exact = resolveBricksSpec(exactInspect);
assert.equal(exact.status, 'exact');
assert.equal(exact.exact_shapes, true);
assert.equal(exact.source_required, false);
const accordionFacts = searchBricksKnowledge('Tạo accordion native Bricks có FAQ và kiểm structure', exact, 3);
assert.ok(accordionFacts.some(item => item.id === 'accordion-structure'));
assert.ok(formatBricksKnowledge(accordionFacts, exact).includes('accordion-nested'));

const patchDifferent = resolveBricksSpec({
  ...exactInspect,
  project_profile:{ facts:{ builder:'bricks' } },
  wordpress:{ ...exactInspect.wordpress, bricks_version:'2.3.7', parentThemes:[{ slug:'bricks', version:'2.3.7' }] }
});
assert.equal(patchDifferent.status, 'compatible-version-different-patch');
assert.equal(patchDifferent.source, 'bundled-invariants-only');
assert.equal(patchDifferent.exact_shapes, false, 'same minor but different patch must not guess exact Builder JSON shapes');
assert.equal(patchDifferent.source_required, true);
const patchFacts = searchBricksKnowledge('builder data parent children typography', patchDifferent, 5);
assert.ok(patchFacts.length >= 1);
assert.ok(patchFacts.every(item => item.stability === 'invariant'));

const mismatch = resolveBricksSpec({ ...exactInspect, project_profile:{ facts:{ bricks_version:'2.4.1' } }, wordpress:{ ...exactInspect.wordpress, parentThemes:[{ slug:'bricks', version:'2.4.1' }] } });
assert.equal(mismatch.status, 'version-mismatch');
assert.equal(mismatch.exact_shapes, false);
assert.equal(mismatch.source_required, true);
const mismatchFacts = searchBricksKnowledge('builder data parent children typography', mismatch, 5);
assert.ok(mismatchFacts.length >= 1);
assert.ok(mismatchFacts.every(item => item.stability === 'invariant'));

const localSpec = JSON.parse(JSON.stringify(bundled));
localSpec.bricks_version = '2.4.1';
const local = resolveBricksSpec({ ...exactInspect, bricks_spec:localSpec, project_profile:{ facts:{ bricks_version:'2.4.1' } } });
assert.equal(local.status, 'local');
assert.equal(local.source, 'local-project-evidence');
assert.equal(local.exact_shapes, true);

const validClipboard = {
  source:'bricksCopiedElements',
  version:'2.3.6',
  globalClasses:[{ id:'cls001', name:'hero-title', settings:{} }],
  content:[
    { id:'sec001', name:'section', parent:0, children:['con001'], settings:{} },
    { id:'con001', name:'container', parent:'sec001', children:['hed001'], settings:{} },
    { id:'hed001', name:'heading', parent:'con001', children:[], settings:{ text:'Hello', _cssGlobalClasses:['cls001'], _typography:{ 'font-size':'2rem', 'font-weight':'700' } } }
  ]
};
const valid = validateBricksJson(validClipboard, exactInspect);
assert.equal(valid.recognized, true);
assert.equal(valid.ok, true, JSON.stringify(valid.errors));
assert.equal(valid.format, 'clipboard');
assert.equal(valid.node_count, 3);

const broken = JSON.parse(JSON.stringify(validClipboard));
broken.content.push({ id:'bad001', name:'section', parent:'con001', children:[], settings:{
  _typography:{ fontSize:'18px' },
  _boxShadow:{ offsetY:'8', color:{ hex:'#000000' } },
  _gradient:{ stops:[{ color:{ hex:'#000' }, stop:'0' }] },
  hasLoop:true,
  query:{},
  queryId:'missing'
} });
broken.content[1].children.push('bad001');
broken.content.push({ id:'bad001', name:'heading', parent:'con001', children:[], settings:{} });
const invalid = validateBricksJson(broken, exactInspect);
assert.equal(invalid.ok, false);
const invalidCodes = new Set(invalid.errors.map(item => item.code));
for (const code of [
  'BRICKS_ID_DUPLICATE',
  'BRICKS_SECTION_NESTED',
  'BRICKS_TYPOGRAPHY_CAMELCASE',
  'BRICKS_SHADOW_VALUES',
  'BRICKS_GRADIENT_STOPS',
  'BRICKS_QUERY_OBJECT_TYPE',
  'BRICKS_QUERY_TARGET_MISSING'
]) assert.ok(invalidCodes.has(code), `missing validation code ${code}`);

const tabsBroken = {
  source:'bricksCopiedElements', version:'2.3.6', globalClasses:[],
  content:[
    { id:'tab001', name:'tabs-nested', parent:0, children:['blk001'], settings:{} },
    { id:'blk001', name:'block', parent:'tab001', children:[], settings:{} }
  ]
};
const tabsValidation = validateBricksJson(tabsBroken, exactInspect);
assert.equal(tabsValidation.ok, false);
assert.ok(tabsValidation.errors.some(item => item.code === 'BRICKS_NESTABLE_STRUCTURE'));

const randomJson = validateBricksJson({ hello:'world' }, exactInspect);
assert.equal(randomJson.recognized, false);
assert.equal(randomJson.ok, true);

const skill = loadWordPressBricksSkill(exactInspect, 'Tạo accordion native Bricks có responsive style', { type:'BRICKS_BUILDER' });
assert.ok(skill);
assert.ok(skill.domains.includes('bricks'));
assert.equal(skill.bricks_spec.status, 'exact');
assert.ok(skill.bricks_guidance.some(item => item.id === 'accordion-structure'));
assert.ok(skill.resources.some(item => item.name === 'knowledge/bricks-spec'));
assert.ok(skill.resource_context.bricks_guidance_count >= 1);
assert.ok(skill.resource_context.used_chars <= 12000);

(async () => {
  const api = {
    async readFile(_projectId, file) {
      if (file === 'bricks-layout.json') return { content:JSON.stringify(broken) };
      return { content:'{"name":"not-bricks"}' };
    }
  };
  const results = await runBricksJsonVerification(api, 'p1', [{ path:'bricks-layout.json' }, { path:'package.json' }], exactInspect);
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'bricks-json');
  assert.equal(results[0].ok, false);
  assert.ok(results[0].errors.some(item => item.code === 'BRICKS_TYPOGRAPHY_CAMELCASE'));
  console.log('Bricks Spec Engine PASS: local version precedence + exact-shape gate + deterministic JSON/tree/settings validation');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});