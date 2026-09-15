const fs = require('fs');
function replaceOnce(file,before,after){let s=fs.readFileSync(file,'utf8');if(!s.includes(before))throw new Error(`${file}: marker missing`);fs.writeFileSync(file,s.replace(before,after));}

replaceOnce('core/task-planner.js',
"const EXECUTION_PATHS = Object.freeze({\n  FAST:'FAST',\n  DEEP:'DEEP'\n});",
"const EXECUTION_PATHS = Object.freeze({\n  FAST:'FAST',\n  DEEP:'DEEP'\n});\n\nconst GUARD_SEVERITY = Object.freeze({ HARD:'HARD', SOFT:'SOFT', ADVISORY:'ADVISORY' });");

replaceOnce('core/task-planner.js',
"function deepPathReasons(request, type = '') {",
`function classifyTaskFacets(request, inspect = {}) {
  const text = normalizeText(request);
  const evidence = stripNegatedStoredStateEvidence(request);
  const facets = [];
  if (hasPersistedStateEvidence(request) || /\\b(?:seed|seeding|sample\\s+data|data\\s+mẫu|dữ\\s+liệu\\s+mẫu|du\\s+lieu\\s+mau|database|wpdb|sql|migration|import|cpt)\\b/i.test(evidence)) facets.push(TASK_TYPES.DATA);
  const ui = /\\b(?:frontend|front-end|\\bfe\\b|ui|layout|responsive|css|style|section|cards?|filter|grid|page)\\b|giao\\s+diện|giao\\s+dien|trang|hiển\\s+thị|hien\\s+thi/i.test(text);
  if (ui) facets.push(TASK_TYPES.FAST_UI);
  const bricksIntent = /bricks|builder|template|query\\s+loop|controls?|element|builder[-\\s]?editable/i.test(text)
    || (hasBricks(inspect) && ui && /(?:build|create|implement|triển\\s+khai|trien\\s+khai|tạo|tao|thêm|them)/i.test(text));
  if (hasBricks(inspect) && bricksIntent) facets.push(TASK_TYPES.BRICKS_BUILDER);
  if (/\\b(?:ftp|sftp|production|deploy|deployment|hosting|server)\\b|live\\s+(?:site|website|frontend)/i.test(text)) facets.push(TASK_TYPES.PRODUCTION);
  if (!facets.length) facets.push(classifyTask(request,inspect));
  return unique(facets);
}

function deepPathReasons(request, type = '') {`);

replaceOnce('core/task-planner.js',
"  const type = classifyTask(request, inspect);\n  const execution = classifyExecutionPath(request, type);",
"  const type = classifyTask(request, inspect);\n  const facets = classifyTaskFacets(request, inspect);\n  const execution = classifyExecutionPath(request, type);");
replaceOnce('core/task-planner.js',
"  const allowNewFile = execution.path === EXECUTION_PATHS.FAST && explicitNewFileRequest(request);",
"  const allowNewFile = execution.path === EXECUTION_PATHS.FAST ? 1 : 'existing owner first';\n  const newFileExplicit = explicitNewFileRequest(request);");
replaceOnce('core/task-planner.js',
"    version:3,\n    type,",
"    version:4,\n    type,\n    facets,");
replaceOnce('core/task-planner.js',
"      allow_new_source_files:execution.path === EXECUTION_PATHS.DEEP ? 'existing owner first' : allowNewFile ? 1 : 0,",
"      allow_new_source_files:allowNewFile,");
replaceOnce('core/task-planner.js',
"      escalation:'fixed for this task; do not self-promote FAST to DEEP. Re-plan only when concrete evidence makes the current path unsafe.'",
"      escalation:'Keep the same task_id. HARD blocks stop mutation; SOFT guards request one targeted proof then a bounded fallback; ADVISORY rules are preferences, not permission boundaries.'");
replaceOnce('core/task-planner.js',
"    ownership_map:(resolved.entries || []).slice(0,8),",
"    ownership_map:(resolved.entries || []).slice(0,8),\n    guard_policy:{ hard:['cross-project/wrong-root mutation','destructive or corrupt mutation without affected-set/recovery proof','malformed persisted Bricks tree','duplicate fatal PHP symbol','unsafe path/outside project'], soft:['owner uncertainty','ideal API/DB path unavailable','one-shot seed/helper needed','new bounded component owner needed'], advisory:['zero new files','native-first','avoid functions.php/shortcode/temp helper/direct DB','prefer semantic classes/current owner'] },");
replaceOnce('core/task-planner.js',
"      new_source_files:execution.path === EXECUTION_PATHS.FAST ? (allowNewFile ? 1 : 0) : 'existing owner first',",
"      new_source_files:allowNewFile,\n      new_file_preference:newFileExplicit ? 'explicitly requested' : 'reuse owner first; one bounded correct owner is allowed when needed',");

const start = "function validatePatchAgainstTaskCard(taskCard, patch) {";
const end = "\nmodule.exports = {";
let source = fs.readFileSync('core/task-planner.js','utf8');
const a = source.indexOf(start), b = source.indexOf(end,a);
if(a<0||b<0) throw new Error('task-planner validator block missing');
const validator = `function validatePatchAgainstTaskCard(taskCard, patch) {
  const files = patchScopeFromUnifiedDiff(patch);
  if (!taskCard) return { ok:true, files, violations:[], hard_blocks:[], soft_guards:[], advisories:[], unexpected_files:[] };
  const execution = taskCard.execution || {};
  const hard = [], soft = [], advisory = [];
  const limit = Math.max(1, Number(execution.patch_file_limit) || (execution.path === EXECUTION_PATHS.FAST ? PATH_LIMITS.FAST.patch_files : PATH_LIMITS.DEEP.patch_files));
  if (files.length > limit) hard.push(\`Patch touches \${files.length} files; bounded task limit is \${limit}\`);

  const creates = files.filter(item => item.operation === 'create');
  const deletes = files.filter(item => item.operation === 'delete');
  const numericNewLimit = Number(execution.allow_new_source_files);
  if (Number.isFinite(numericNewLimit) && creates.length > numericNewLimit) hard.push(\`Patch creates \${creates.length} files; bounded allowance is \${numericNewLimit}\`);
  if (creates.length) advisory.push('Prefer the existing functional owner; a bounded new owner is allowed only when it is the smallest correct responsibility boundary.');
  if (deletes.length && execution.allow_delete !== true) hard.push('This execution path may not delete source files.');

  const facets = new Set(taskCard.facets || [taskCard.type]);
  if (taskCard.type === TASK_TYPES.FAST_UI && !facets.has(TASK_TYPES.DATA)) {
    const deepOnly = files.filter(item => /(?:^|\\/)(?:migrations?|seed(?:ing)?|installer|database)(?:\\/|[-_.])/i.test(item.path));
    if (deepOnly.length) hard.push(\`Pure FAST_UI patch entered data/migration ownership: \${deepOnly.map(item => item.path).join(', ')}\`);
  }

  const expected = new Set((taskCard.expected_files || []).map(item => String(item).replace(/\\\\/g,'/')));
  const unexpected = expected.size ? files.filter(item => !expected.has(item.path)).map(item => item.path) : [];
  if (files.length && expected.size && files.every(item => !expected.has(item.path))) soft.push('Patch leaves all ranked owner candidates; read the intended owner/relationship once before proceeding with a bounded fallback.');

  const enforcePaths = new Set((taskCard?.owner?.enforce_paths || []).map(item => String(item).replace(/\\\\/g,'/')));
  if (files.length && enforcePaths.size && files.every(item => !enforcePaths.has(item.path))) soft.push(\`Patch bypasses the strongest resolved \${taskCard.owner.kind || 'owner'} evidence: \${[...enforcePaths].join(', ')}\`);

  const confidence = Number(taskCard?.owner?.confidence || 0);
  if (taskCard?.owner?.primary_path && confidence > 0 && confidence < 0.8) soft.push(\`Owner confidence is \${confidence.toFixed(2)}; perform one targeted read/proof, then proceed with the best bounded owner instead of abandoning the task.\`);
  if (unexpected.length) advisory.push(\`Patch includes non-ranked paths: \${unexpected.join(', ')}. Keep them only when directly required by the same task.\`);

  return {
    ok:hard.length === 0,
    files,
    violations:hard,
    hard_blocks:hard,
    soft_guards:unique(soft),
    advisories:unique(advisory),
    unexpected_files:unexpected,
    requires_targeted_read:soft.length > 0,
    severity:hard.length ? GUARD_SEVERITY.HARD : soft.length ? GUARD_SEVERITY.SOFT : advisory.length ? GUARD_SEVERITY.ADVISORY : null
  };
}
`;
source = source.slice(0,a) + validator + source.slice(b);
source = source.replace("  TASK_TYPES,\n  EXECUTION_PATHS,", "  TASK_TYPES,\n  EXECUTION_PATHS,\n  GUARD_SEVERITY,");
source = source.replace("  classifyTask,\n  deepPathReasons,", "  classifyTask,\n  classifyTaskFacets,\n  deepPathReasons,");
fs.writeFileSync('core/task-planner.js',source);
console.log('execution-first task policy staged');
