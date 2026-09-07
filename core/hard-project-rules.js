const { chatError } = require('./errors');
const { explicitUserPaths } = require('./owner-resolver');
const { patchScopeFromUnifiedDiff, EXECUTION_PATHS } = require('./task-planner');

const HARD_RULES_VERSION = 1;
const MAX_EXPLICIT_NEW_FILES = 2;
const MAX_TASK_CONTRACTS = 200;
const NEGATED_SOURCE_CLAUSE_RE = /(?:(?:\b(?:do\s+not|don't|dont|without|no|not|never|không|khong|dung)\b)|đừng)[^.!?\n]{0,180}/gi;
const CONTRAST_RE = /\b(?:but|however|nhưng|nhung|tuy\s+nhiên|tuy\s+nhien)\b/i;
const FILE_CREATE_ACTION = String.raw`(?:\b(?:create|add|new|tao|them)\b|tạo|thêm)`;
const SOURCE_CREATE_ACTION = String.raw`(?:\b(?:create|add|build|implement|register|tao|them)\b|tạo|thêm|triển\s+khai|\btrien\s+khai\b|xây\s+dựng|\bxay\s+dung\b)`;

function norm(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function text(value) { return String(value || '').trim().toLowerCase(); }
function unique(values) { return [...new Set((values || []).map(norm).filter(Boolean))]; }

function stripNegatedSourceCreationEvidence(value = '') {
  return text(value).replace(NEGATED_SOURCE_CLAUSE_RE, clause => {
    const contrast = clause.search(CONTRAST_RE);
    if (contrast < 0) return ' ';
    return ` ${clause.slice(contrast)} `;
  });
}

function explicitNewFileIntent(request = '') {
  const q = stripNegatedSourceCreationEvidence(request);
  const target = String.raw`(?:new\s+)?(?:source\s+)?(?:file|stylesheet|css\s+file|php\s+file|js\s+file|ts\s+file)`;
  const reverseTarget = String.raw`(?:file|stylesheet)[^\n]{0,70}${FILE_CREATE_ACTION}`;
  const vietnameseNew = String.raw`(?:file|tệp|tep)\s+(?:mới|moi)\b`;
  return new RegExp(
    `${FILE_CREATE_ACTION}[^\\n]{0,70}${target}|${reverseTarget}|${vietnameseNew}`,
    'i'
  ).test(q);
}

function explicitCustomBricksSourceIntent(request = '') {
  const q = stripNegatedSourceCreationEvidence(request);
  const source = String.raw`(?:custom\s+(?:bricks\s+)?element|bricks\s+custom\s+element|custom\s+shortcode|shortcode)`;
  const explicitNew = String.raw`(?:\bnew\b|mới|\bmoi\b)`;
  return new RegExp(
    `${SOURCE_CREATE_ACTION}[^\\n]{0,70}${source}|${source}[^\\n]{0,70}${SOURCE_CREATE_ACTION}|${explicitNew}[^\\n]{0,30}${source}`,
    'i'
  ).test(q);
}

function explicitArchitectureSourceIntent(request = '') {
  const q = stripNegatedSourceCreationEvidence(request);
  const target = String.raw`(?:plugin|module|service|source\s+class|custom\s+(?:bricks\s+)?element|shortcode|migration\s+file|seed\s+file)`;
  return new RegExp(`${SOURCE_CREATE_ACTION}[^\\n]{0,70}${target}`, 'i').test(q);
}

function projectRelativeExplicitPaths(request = '') {
  return unique(explicitUserPaths(request).filter(value => !/^[a-z]:\//i.test(value) && !String(value).startsWith('/')));
}

function isBricksPrepared(prepared = {}) {
  if (text(prepared?.project_profile?.facts?.builder) === 'bricks') return true;
  if ((prepared?.context?.framework_names || []).some(name => /\bbricks\b/i.test(String(name)))) return true;
  return (prepared?.context?.frameworks || []).some(item => /\bbricks\b/i.test(String(item?.name || item || '')));
}

function globalCssOwner(prepared = {}) {
  const fromFacts = norm(prepared?.project_profile?.facts?.global_css_owner || '');
  if (fromFacts) return fromFacts;
  const map = prepared?.task_card?.ownership_map || [];
  return norm(map.find(item => item?.kind === 'global_css' && item?.path)?.path || '');
}

function ownerBinding(prepared = {}) {
  const owner = prepared?.task_card?.owner || {};
  const status = text(owner.status);
  const paths = unique(owner.enforce_paths || []);
  const binding = ['confirmed','detected'].includes(status) && paths.length > 0 && owner.kind !== 'explicit_path';
  return { binding, status:status || 'unknown', paths };
}

function requestedFileBudget(prepared = {}) {
  const request = String(prepared?.request || '');
  const card = prepared?.task_card || {};
  const execution = card.execution || {};
  const explicitPaths = projectRelativeExplicitPaths(request);
  const explicitFile = explicitNewFileIntent(request);
  const explicitCustom = explicitCustomBricksSourceIntent(request);
  const explicitArchitecture = explicitArchitectureSourceIntent(request);
  let proposed = 0;
  let reason = 'reuse-existing-owner';

  if (explicitFile) {
    proposed = Math.min(MAX_EXPLICIT_NEW_FILES, Math.max(1, explicitPaths.length || 1));
    reason = explicitPaths.length ? 'explicit-new-file-path' : 'explicit-new-file-request';
  } else if (explicitCustom || explicitArchitecture) {
    proposed = 1;
    reason = explicitCustom ? 'explicit-custom-source-request' : 'explicit-architecture-source-request';
  }

  // Never make FAST looser than the planner allowance that already existed before v1.0.28.
  if (execution.path === EXECUTION_PATHS.FAST) {
    const oldLimit = Math.max(0, Number(execution.allow_new_source_files) || 0);
    proposed = Math.min(proposed, oldLimit);
    if (!proposed && oldLimit === 0 && reason !== 'reuse-existing-owner') reason = 'fast-planner-disallows-new-file';
  }

  if (card.type === 'PRODUCTION' && !explicitFile) {
    proposed = 0;
    reason = 'production-reuses-local-source';
  }

  return {
    budget:proposed,
    reason,
    explicit_paths:explicitPaths,
    explicit_file:explicitFile,
    explicit_custom_source:explicitCustom
  };
}

function buildHardRuleContract(prepared = {}) {
  const binding = ownerBinding(prepared);
  const filePolicy = requestedFileBudget(prepared);
  const bricks = isBricksPrepared(prepared);
  const cssOwner = globalCssOwner(prepared);
  const decisions = (prepared?.project_decisions || prepared?.project_rules || [])
    .map(item => ({ key:String(item?.key || ''), value:String(item?.value || '') }))
    .filter(item => item.key && item.value)
    .slice(0,6);

  return {
    version:HARD_RULES_VERSION,
    owner_first:{
      enforced:binding.binding && !filePolicy.explicit_file && !filePolicy.explicit_custom_source,
      status:binding.status,
      paths:binding.paths
    },
    file_creation:{
      budget:filePolicy.budget,
      reason:filePolicy.reason,
      explicit_paths:filePolicy.explicit_paths
    },
    native_bricks:{
      enabled:bricks,
      allow_custom_source:!bricks || filePolicy.explicit_custom_source
    },
    global_css:{
      owner:cssOwner || null,
      root_only_in_owner:!!cssOwner
    },
    project_decisions:decisions,
    principles:['owner-first','reuse-before-create','no-parallel-owner','native-bricks-before-custom-source','global-tokens-stay-global']
  };
}

function normalizePatchPath(value) {
  let out = String(value || '').trim();
  if (out.startsWith('"') && out.endsWith('"')) out = out.slice(1,-1);
  out = out.replace(/^\.?\/?[ab]\//, '').replace(/\\/g, '/');
  return out === '/dev/null' ? '' : norm(out);
}

function addedLinesByFile(patch = '') {
  const lines = String(patch || '').split(/\r?\n/);
  const map = new Map();
  let current = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('--- ')) {
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith('+++ ') && !lines[j].startsWith('--- ')) j++;
      if (j < lines.length && lines[j].startsWith('+++ ')) {
        const before = normalizePatchPath(lines[i].slice(4).split('\t')[0]);
        const after = normalizePatchPath(lines[j].slice(4).split('\t')[0]);
        current = after || before;
        if (current && !map.has(current)) map.set(current, []);
        i = j;
      }
      continue;
    }
    if (!current || !lines[i].startsWith('+') || lines[i].startsWith('+++')) continue;
    map.get(current).push(lines[i].slice(1));
  }
  return map;
}

function validateHardProjectRules(contract = {}, patch = '') {
  const files = patchScopeFromUnifiedDiff(patch);
  const violations = [];
  const creates = files.filter(item => item.operation === 'create');
  const budget = Math.max(0, Number(contract?.file_creation?.budget) || 0);
  if (creates.length > budget) {
    violations.push(`Patch creates ${creates.length} source files; hard file-creation budget is ${budget}`);
  }

  const explicitPaths = new Set(unique(contract?.file_creation?.explicit_paths || []));
  if (explicitPaths.size && creates.some(item => !explicitPaths.has(norm(item.path)))) {
    violations.push(`New files must stay on explicit user paths: ${[...explicitPaths].join(', ')}`);
  }

  const owner = contract?.owner_first || {};
  const ownerPaths = new Set(unique(owner.paths || []));
  if (owner.enforced && files.length && ownerPaths.size && files.every(item => !ownerPaths.has(norm(item.path)))) {
    violations.push(`Patch bypasses evidence-backed owner: ${[...ownerPaths].join(', ')}`);
  }

  const added = addedLinesByFile(patch);
  const cssOwner = norm(contract?.global_css?.owner || '');
  if (cssOwner && contract?.global_css?.root_only_in_owner) {
    for (const [file, lines] of added.entries()) {
      if (norm(file) === cssOwner) continue;
      if (lines.some(line => /(^|[^a-z0-9_-]):root\b/i.test(line) || /^\s*:root\b/i.test(line))) {
        violations.push(`:root/global tokens must stay in ${cssOwner}; found new :root in ${file}`);
      }
    }
  }

  if (contract?.native_bricks?.enabled && !contract?.native_bricks?.allow_custom_source) {
    const joined = [...added.values()].flat().join('\n');
    const customSignals = [];
    if (/\badd_shortcode\s*\(/i.test(joined)) customSignals.push('shortcode registration');
    if (/extends\s+(?:\\?Bricks\\)?Element\b/i.test(joined)) customSignals.push('custom Bricks Element class');
    if (/Bricks\\Elements::register_element|\bregister_element\s*\(/i.test(joined)) customSignals.push('custom Bricks element registration');
    if (customSignals.length) violations.push(`Native Bricks is required before custom source; patch adds ${customSignals.join(', ')}`);
  }

  return { ok:violations.length === 0, violations, files, creates, budget };
}

function decoratePrepared(result = {}, contract = {}) {
  const taskCard = result?.task_card || {};
  const execution = { ...(taskCard.execution || {}), allow_new_source_files:Number(contract?.file_creation?.budget || 0) };
  const constraints = {
    ...(taskCard.constraints || {}),
    new_source_files:Number(contract?.file_creation?.budget || 0),
    hard_project_rules:'enforced'
  };
  const decoratedCard = {
    ...taskCard,
    version:Math.max(4, Number(taskCard.version) || 0),
    execution,
    constraints,
    hard_rules:contract
  };
  const guidance = [
    ...(result?.agent_contract?.guidance || []),
    `Hard file-creation budget: ${contract.file_creation.budget}. Budget 0 means modify/reuse existing owners only; do not create helper/migration/CSS/PHP files.`,
    contract.owner_first.enforced
      ? `Hard owner-first: patch must include an evidence-backed owner (${contract.owner_first.paths.join(', ')}); do not create a parallel owner.`
      : 'Owner-first/reuse-first remains mandatory; new owner creation requires explicit source-creation intent.',
    contract.native_bricks.enabled && !contract.native_bricks.allow_custom_source
      ? 'Hard native-Bricks rule: do not add a shortcode or custom Bricks Element source when native Bricks can own the requested UI.'
      : '',
    contract.global_css.root_only_in_owner
      ? `Hard global-CSS rule: new :root/global tokens may only be added in ${contract.global_css.owner}.`
      : '',
    contract.project_decisions.length
      ? 'Relevant project decisions in hard_project_rules.project_decisions are mandatory conventions for this task.'
      : ''
  ].filter(Boolean);
  return {
    ...result,
    task_card:decoratedCard,
    hard_project_rules:contract,
    agent_contract:{ ...(result?.agent_contract || {}), guidance }
  };
}

function createHardProjectRulesApi(api) {
  if (!api || api.__hardProjectRulesWrapped) return api;
  api.__hardProjectRulesWrapped = true;
  const tasks = new Map();

  function rememberTask(taskId, state) {
    const id = String(taskId || '');
    if (!id) return;
    tasks.set(id, state);
    while (tasks.size > MAX_TASK_CONTRACTS) tasks.delete(tasks.keys().next().value);
  }

  if (typeof api.prepareTask === 'function') {
    const rawPrepare = api.prepareTask.bind(api);
    api.prepareTask = async (...args) => {
      const prepared = await rawPrepare(...args);
      if (prepared?.status !== 'ready' || !prepared?.task_id) return prepared;
      const contract = buildHardRuleContract(prepared);
      const decorated = decoratePrepared(prepared, contract);
      rememberTask(prepared.task_id, { contract, task_card:decorated.task_card });
      return decorated;
    };
  }

  if (typeof api.completeTask === 'function') {
    const rawComplete = api.completeTask.bind(api);
    api.completeTask = async (taskId, patch, ...rest) => {
      const id = String(taskId || '');
      const state = tasks.get(id);
      if (state) {
        const check = validateHardProjectRules(state.contract, patch);
        if (!check.ok) {
          throw chatError('TASK_SCOPE_VIOLATION', 'Patch vi phạm Hard Project Rules. Không có file nào được thay đổi.', {
            task_id:id,
            violations:check.violations,
            patch_files:check.files,
            file_creation_budget:check.budget,
            hard_project_rules:state.contract,
            next_action:'Thu nhỏ patch để reuse owner hiện tại. Chỉ re-plan khi yêu cầu của người dùng thật sự cần source owner/file mới.'
          });
        }
      }
      const result = await rawComplete(taskId, patch, ...rest);
      if (!state) return result;
      const decorated = {
        ...result,
        task_card:state.task_card,
        hard_project_rules:state.contract,
        hard_rules_check:{ ok:true }
      };
      if (['completed','rolled_back'].includes(String(result?.status || ''))) tasks.delete(id);
      return decorated;
    };
  }

  for (const method of ['finishWork','rollbackWork']) {
    if (typeof api[method] !== 'function') continue;
    const raw = api[method].bind(api);
    api[method] = async (taskId, ...rest) => {
      const result = await raw(taskId, ...rest);
      tasks.delete(String(taskId || ''));
      return result;
    };
  }

  return api;
}

function installHardProjectRulesPatches() {
  const safety = require('./safety-tools');
  if (safety.__hardProjectRulesPatched) return;
  safety.__hardProjectRulesPatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function hardProjectRulesSafeToolApi(projects, store, approvals, backups, options) {
    return createHardProjectRulesApi(previousCreate(projects, store, approvals, backups, options));
  };
}

module.exports = {
  HARD_RULES_VERSION,
  stripNegatedSourceCreationEvidence,
  explicitNewFileIntent,
  explicitCustomBricksSourceIntent,
  buildHardRuleContract,
  addedLinesByFile,
  validateHardProjectRules,
  createHardProjectRulesApi,
  installHardProjectRulesPatches
};
