const assert = require('node:assert/strict');
const {
  createBricksEvidenceApi,
  extractPatchEvidenceRefs,
  isHookRecursionRestore,
  HARDENING_VERSION
} = require('../core/bricks-evidence');

const project = { id:'p1', name:'site', root:'/srv/site' };
const store = {
  getProject(ref) {
    if (['p1','site'].includes(String(ref))) return project;
    throw new Error('missing project');
  }
};

const receipt = {
  task_id:'t1', project_id:'p1', project_name:'site',
  skill_id:'wordpress-bricks', contract_version:6,
  domains:['bricks','ui']
};

let completeCount = 0;
const baseApi = {
  bricksSkillReceipt(id) { return id === 't1' ? receipt : null; },
  async prepareTask() {
    return {
      task_id:'t1', work_session_id:'t1',
      context:{ relevant_files:[] },
      skills:[{ id:'wordpress-bricks', instructions:'base' }],
      skill_receipt:receipt
    };
  },
  async completeTask() {
    completeCount++;
    return { status:'ready_for_more', verification_passed:true };
  },
  async readFile() {
    return { content:JSON.stringify([{ id:'abc123', name:'heading', parent:0, children:[], settings:{} }]) };
  },
  async readFiles() { return []; },
  async exec(_ref, command) {
    if (/wp post get 77/.test(command)) return { status:'completed', exit_code:0, stdout:'attachment\n' };
    return { status:'completed', exit_code:0, stdout:'' };
  },
  async findSymbols(_ref, query) {
    return query === 'duplicateFn'
      ? [{ name:'duplicateFn', kind:'function', path:'inc/existing.php', line:2 }]
      : [];
  },
  async search(_ref, query) {
    if (/save_post_tai_lieu/.test(query) && /htc_document_save_meta/.test(query)) {
      return [{ path:'inc/content-types/documents.php', snippet:"add_action( 'save_post_tai_lieu', 'htc_document_save_meta', 10, 2 );" }];
    }
    return [];
  }
};

(async () => {
  const api = createBricksEvidenceApi(baseApi,store);
  const prepared = await api.prepareTask('p1','Fix responsive UI',8,{});
  assert.equal(prepared.bricks_evidence.hardening_version,HARDENING_VERSION);
  assert.equal(HARDENING_VERSION,2);
  assert.equal(prepared.bricks_evidence.element_ids.length,0);
  assert.equal(prepared.verification_requirements.responsive,true);
  assert.match(prepared.skills[0].instructions,/evidence hardening/i);

  const cssPatch = [
    '--- a/x.css',
    '+++ b/x.css',
    '@@ -0,0 +1 @@',
    '+#brxe-abc123{display:block}'
  ].join('\n');

  await assert.rejects(
    () => api.completeTask('t1',cssPatch,[],{}),
    error => error?.code === 'BRICKS_EVIDENCE_REQUIRED'
      && error.details.errors.some(item => item.code === 'BRICKS_ELEMENT_ID_UNVERIFIED')
  );

  const read = await api.readFile('p1','bricks-tree.json');
  assert.deepEqual(read.bricks_evidence_recorded.element_ids,['abc123']);

  const codeOnly = await api.completeTask('t1',cssPatch,[],{});
  assert.equal(codeOnly.verification_state.completion_level,'code_verified_not_live_verified');
  assert.equal(codeOnly.verification_state.live.verified,false);
  assert.equal(codeOnly.verification_state.responsive.required,true);
  assert.ok(codeOnly.bricks_patch_lint.warnings.some(item => item.code === 'BRICKS_GENERATED_SELECTOR_COUPLING'));

  const mediaPatch = [
    '--- a/x.php',
    '+++ b/x.php',
    '@@ -0,0 +1 @@',
    '+$url = wp_get_attachment_url(77);'
  ].join('\n');

  await assert.rejects(
    () => api.completeTask('t1',mediaPatch,[],{}),
    error => error?.code === 'BRICKS_EVIDENCE_REQUIRED'
      && error.details.errors.some(item => item.code === 'WORDPRESS_MEDIA_ID_UNVERIFIED')
  );

  const mediaCheck = await api.exec('p1','wp post get 77 --field=post_type',{ work_session_id:'t1' });
  assert.deepEqual(mediaCheck.bricks_evidence_recorded.media_ids,['77']);
  await api.completeTask('t1',mediaPatch,[],{});

  const duplicatePatch = [
    '--- a/x.php',
    '+++ b/x.php',
    '@@ -0,0 +1 @@',
    '+function duplicateFn() {}'
  ].join('\n');
  await assert.rejects(
    () => api.completeTask('t1',duplicatePatch,[],{}),
    error => error?.code === 'BRICKS_EVIDENCE_REQUIRED'
      && error.details.errors.some(item => item.code === 'PHP_DUPLICATE_PUBLIC_SYMBOL')
  );

  const unstableSelectorPatch = [
    '--- a/x.css',
    '+++ b/x.css',
    '@@ -0,0 +1 @@',
    '+[data-field-id="hero"]{display:block}'
  ].join('\n');
  await assert.rejects(
    () => api.completeTask('t1',unstableSelectorPatch,[],{}),
    error => error?.code === 'BRICKS_EVIDENCE_REQUIRED'
      && error.details.errors.some(item => item.code === 'BRICKS_DATA_FIELD_SELECTOR_COUPLING')
  );

  const newNodePatch = [
    '--- a/tree.json',
    '+++ b/tree.json',
    '@@ -0,0 +1,5 @@',
    '+{',
    '+  "id":"def456",',
    '+  "name":"heading",',
    '+  "parent":"abc123",',
    '+  "children":[]',
    '+}'
  ].join('\n');
  const refs = extractPatchEvidenceRefs(newNodePatch);
  assert.ok(refs.defined_element_ids.includes('def456'));
  assert.equal(refs.element_refs.includes('def456'),false,'newly defined element id must not require prior evidence');
  assert.equal(refs.element_refs.includes('abc123'),true,'existing parent must remain evidence-bound');

  const recursionText = [
    "remove_action( 'save_post_tai_lieu', 'htc_document_save_meta', 10 );",
    'wp_update_post( $post_data );',
    "add_action( 'save_post_tai_lieu', 'htc_document_save_meta', 10, 2 );"
  ].join('\n');
  assert.equal(isHookRecursionRestore(recursionText,{
    type:'add_action', hook:'save_post_tai_lieu', callback:'htc_document_save_meta'
  }),true,'remove -> mutation -> restore must be recognized as a recursion guard');

  const recursionPatch = [
    '--- a/inc/content-types/documents.php',
    '+++ b/inc/content-types/documents.php',
    '@@ -0,0 +1,3 @@',
    "+remove_action( 'save_post_tai_lieu', 'htc_document_save_meta', 10 );",
    '+wp_update_post( $post_data );',
    "+add_action( 'save_post_tai_lieu', 'htc_document_save_meta', 10, 2 );"
  ].join('\n');
  const recursionResult = await api.completeTask('t1',recursionPatch,[],{});
  assert.ok(recursionResult.php_duplicate_preflight.warnings.some(item => item.code === 'PHP_HOOK_RECURSION_RESTORE_SAFE'));
  assert.equal(
    recursionResult.php_duplicate_preflight.warnings.some(item => item.code === 'PHP_DUPLICATE_HOOK_CANDIDATE'),
    false,
    'temporary hook restore must not be misclassified as a duplicate registration'
  );

  assert.ok(completeCount >= 3);
  console.log('WordPress + Bricks hardening PASS: task evidence + media proof + safe recursion hook classification + explicit verification states');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});