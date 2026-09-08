const { chatError } = require('./errors');
const { explicitUserPaths } = require('./owner-resolver');
const { patchScopeFromUnifiedDiff, EXECUTION_PATHS } = require('./task-planner');

const HARD_RULES_VERSION = 2;
const MAX_EXPLICIT_NEW_FILES = 2;
const MAX_FUNCTIONAL_NEW_FILES = 2;
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

function explicitNoNewFileIntent(request = '') {
  return /(?:(?:\b(?:do\s+not|don't|dont|never|without|no|không|khong)\b)|đừng)[^.!?\n]{0,90}(?:new\s+(?:source\s+)?file|file\s+(?:mới|moi)|tệp\s+(?:mới|moi)|tep\s+moi|create\s+(?:a\s+)?file|add\s+(?:a\s+)?file|tạo\s+file|tao\s+file|thêm\s+file|them\s+file)/i.test(String(request || ''));
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

function isGenericOwnerPath(value = '') {
  const file = norm(value);
  return /(?:^|\/)(?:functions\.php|style\.css|main\.css|base\.css|global\.css|variables\.css)$/i.test(file);
}

function functionalScope(request = '') {
  const q = stripNegatedSourceCreationEvidence(request);
  const header = /\bheader\b|đầu\s+trang|dau\s+trang/i.test(q);
  const footer = /\bfooter\b|chân\s+trang|chan\s+trang/i.test(q);
  if (header && footer) return 'header-footer';
  if (header) return 'header';
  if (footer) return 'footer';
  const scopes = [
    ['home', /homepage|home\s*page|trang\s+chủ|trang\s+chu|front\s*page/i],
    ['checkout', /\bcheckout\b|thanh\s+toán|thanh\s+toan/i],
    ['cart', /\bcart\b|giỏ\s+hàng|gio\s+hang/i],
    ['single-product', /single\s+product|product\s+detail|chi\s+tiết\s+sản\s*phẩm|chi\s+tiet\s+san\s*pham/i],
    ['archive', /\barchive\b|taxonomy|product\s+category|danh\s+mục\s+sản\s*phẩm|danh\s+muc\s+san\s*pham/i],
    ['account', /my\s+account|\baccount\b|tài\s+khoản|tai\s+khoan/i],
    ['contact', /\bcontact\b|liên\s+hệ|lien\s+he/i],
    ['about', /\babout\b|giới\s+thiệu|gioi\s+thieu/i],
    ['menu', /\bmenu\b|navigation|\bnav\b/i],
    ['search', /\bsearch\b|tìm\s+kiếm|tim\s+kiem/i],
    ['recruitment', /recruitment|tuyển\s+dụng|tuyen\s+dung/i],
    ['order-tracking', /order\s+tracking|tra\s+cứu\s+đơn\s+hàng|tra\s+cuu\s+don\s+hang/i]
  ];
  return scopes.find(([, re]) => re.test(q))?.[0] || '';
}

function matchesFunctionalScopePath(value = '', scope = '') {
  const file = norm(value).toLowerCase();
  if (!file || !scope) return false;
  const tests = {
    'header-footer': /(?:^|[\/_-])(?:header|footer)(?:[\/_.-]|$)/i,
    header:/(?:^|[\/_-])header(?:[\/_.-]|$)/i,
    footer:/(?:^|[\/_-])footer(?:[\/_.-]|$)/i,
    home:/(?:^|[\/_-])(?:home|homepage|front-page|front_page)(?:[\/_.-]|$)/i,
    checkout:/(?:^|[\/_-])checkout(?:[\/_.-]|$)/i,
    cart:/(?:^|[\/_-])cart(?:[\/_.-]|$)/i,
    'single-product':/(?:^|[\/_-])(?:single-product|single_product|product-detail|product_detail|product)(?:[\/_.-]|$)/i,
    archive:/(?:^|[\/_-])(?:archive|taxonomy|category)(?:[\/_.-]|$)/i,
    account:/(?:^|[\/_-])(?:account|my-account|my_account|tai-khoan)(?:[\/_.-]|$)/i,
    contact:/(?:^|[\/_-])(?:contact|lien-he)(?:[\/_.-]|$)/i,
    about:/(?:^|[\/_-])(?:about|gioi-thieu)(?:[\/_.-]|$)/i,
    menu:/(?:^|[\/_-])(?:menu|menus|navigation|nav)(?:[\/_.-]|$)/i,
    search:/(?:^|[\/_-])search(?:[\/_.-]|$)/i,
    recruitment:/(?:^|[\/_-])(?:recruitment|tuyen-dung)(?:[\/_.-]|$)/i,
    'order-tracking':/(?:^|[\/_-])(?:order-tracking|order_tracking|tracking|tra-cuu)(?:[\/_.-]|$)/i
  };
  return tests[scope]?.test(file) || false;
}

function isVagueFunctionalOwnerPath(value = '') {
  const base = norm(value).split('/').pop() || '';
  return /(?:^|[-_.])(?:fix|temp|temporary|v2|final|latest|common2|misc|stuff|helper|helpers)(?:[-_.]|$)/i.test(base)
    || /section[-_]?\d+/i.test(base)
    || /^(?:site-parts|site-chrome)(?:\.|[-_])/i.test(base);
}

function functionalOwnerPolicy(prepared = {}, binding = ownerBinding(prepared)) {
  const request = String(prepared?.request || '');
  const card = prepared?.task_card || {};
  const execution = card.execution || {};
  if (explicitNoNewFileIntent(request)) return { allowed:false, reason:'explicit-no-new-file' };
  if (projectRelativeExplicitPaths(request).length && !explicitNewFileIntent(request)) return { allowed:false, reason:'explicit-existing-path' };
  if (card.type === 'PRODUCTION') return { allowed:false, reason:'production-reuses-local-source' };

  const q = stripNegatedSourceCreationEvidence(request);
  const action = /\b(?:create|add|build|implement|introduce|register)\b|tạo|tao|thêm|them|triển\s+khai|trien\s+khai|xây\s+dựng|xay\s+dung|bổ\s+sung|bo\s+sung|\blàm\b|\blam\b/i.test(q);
  const scope = functionalScope(q);
  if (!action || !scope) return { allowed:false, reason:'no-new-functional-scope' };

  const cssOwner = globalCssOwner(prepared);
  const genericPaths = unique([...(binding.paths || []), cssOwner]).filter(isGenericOwnerPath);
  if (!genericPaths.length) return { allowed:false, reason:'scoped-owner-already-primary' };

  const owner = card.owner || {};
  const knownPaths = unique([
    ...(owner.candidates || []),
    ...(owner.companions || []),
    ...(card.ownership_map || []).map(item => item?.path),
    ...(prepared?.context?.relevant_files || []).map(item => item?.path)
  ]);
  const existingScoped = knownPaths.find(path => !isGenericOwnerPath(path) && matchesFunctionalScopePath(path, scope));
  if (existingScoped) return { allowed:false, reason:'reuse-existing-functional-owner', existing_path:existingScoped, scope };

  const requested = execution.lane === 'MICRO_UI' ? 1 : MAX_FUNCTIONAL_NEW_FILES;
  const patchLimit = Math.max(1, Number(execution.patch_file_limit) || requested);
  return {
    allowed:true,
    reason:'generic-owner-would-grow',
    scope,
    budget:Math.min(requested, patchLimit),
    generic_paths:genericPaths
  };
}

function requestedFileBudget(prepared = {}) {
  const request = String(prepared?.request || '');
  const card = prepared?.task_card || {};
  const execution = card.execution || {};
  const binding = ownerBinding(prepared);
  const explicitPaths = projectRelativeExplicitPaths(request);
  const explicitNoFile = explicitNoNewFileIntent(request);
  const explicitFile = explicitNewFileIntent(request);
  const explicitCustom = explicitCustomBricksSourceIntent(request);
  const explicitArchitecture = explicitArchitectureSourceIntent(request);
  const functional = functionalOwnerPolicy(prepared, binding);
  let proposed = 0;
  let reason = 'reuse-existing-owner';

  if (explicitNoFile) {
    proposed = 0;
    reason = 'explicit-no-new-file';
  } else if (explicitFile) {
    proposed = Math.min(MAX_EXPLICIT_NEW_FILES, Math.max(1, explicitPaths.length || 1));
    reason = explicitPaths.length ? 'explicit-new-file-path' : 'explicit-new-file-request';
  } else if (explicitCustom || explicitArchitecture) {
    proposed = 1;
    reason = explicitCustom ? 'explicit-custom-source-request' : 'explicit-architecture-source-request';
  } else if (functional.allowed) {
    proposed = functional.budget;
    reason = 'functional-owner-split';
  }

  // FAST remains strict for ordinary edits. The only bounded exception is a proven
  // functional split away from a generic bootstrap/global owner.
  if (execution.path === EXECUTION_PATHS.FAST && reason !== 'functional-owner-split') {
    const oldLimit = Math.max(0, Number(execution.allow_new_source_files) || 0);
    proposed = Math.min(proposed, oldLimit);
    if (!proposed && oldLimit === 0 && !['reuse-existing-owner','explicit-no-new-file'].includes(reason)) reason = 'fast-planner-disallows-new-file';
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
    explicit_no_new_file:explicitNoFile,
    explicit_custom_source:explicitCustom,
    functional_owner_allowed:reason === 'functional-owner-split',
    functional_scope:functional.scope || '',
    generic_owner_paths:functional.generic_paths || [],
    existing_functional_owner:functional.existing_path || ''
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
      enforced:binding.binding && !filePolicy.explicit_file && !filePolicy.explicit_custom_source && !filePolicy.functional_owner_allowed,
      status:binding.status,
      paths:binding.paths
    },
    file_creation:{
      budget:filePolicy.budget,
      reason:filePolicy.reason,
      explicit_paths:filePolicy.explicit_paths,
      functional_scope:filePolicy.functional_scope || null
    },
    functional_ownership:{
      allowed:filePolicy.functional_owner_allowed,
      scope:filePolicy.functional_scope || null,
      generic_owner_paths:filePolicy.generic_owner_paths,
      existing_owner:filePolicy.existing_functional_owner || null,
      rule:'reuse scoped owner first; otherwise split stable page/component/module ownership away from generic entry files'
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
    principles:['owner-first','reuse-before-create','functional-owner-before-monolith','no-parallel-owner','thin-bootstrap-global-entrypoints','native-bricks-before-custom-source','global-tokens-stay-global']
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

  if (contract?.functional_ownership?.allowed && creates.length) {
    const scope = String(contract.functional_ownership.scope || '');
    for (const item of creates) {
      const file = norm(item.path);
      if (isGenericOwnerPath(file)) {
        violations.push(`Functional owner split must move responsibility out of generic entry owner: ${file}`);
      }
      if (isVagueFunctionalOwnerPath(file)) {
        violations.push(`Functional owner must use a stable page/component/module name; vague helper/fix/temp/v2/section file is not allowed: ${file}`);
      }
      if (scope && !matchesFunctionalScopePath(file, scope)) {
        violations.push(`New functional owner must match scope ${scope}; received ${file}`);
      }
    }
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
  const functional = contract?.functional_ownership || {};
  const guidance = [
    ...(result?.agent_contract?.guidance || []),
    functional.allowed
      ? `Functional owner budget: ${contract.file_creation.budget} for ${functional.scope}. Reuse an existing scoped owner if found; otherwise create only stable page/component/module owners in the project's established folders. Keep functions.php/style.css/main.css thin or global; do not create per-section, helper, fix, temp or v2 owners.`
      : `Hard file-creation budget: ${contract.file_creation.budget}. Budget 0 means modify/reuse suitable existing owners only; do not create helper/migration/CSS/PHP files.`,
    contract.owner_first.enforced
      ? `Hard owner-first: patch must include an evidence-backed owner (${contract.owner_first.paths.join(', ')}); do not create a parallel owner.`
      : functional.allowed
        ? `Generic owner split is allowed because ${functional.generic_owner_paths.join(', ')} would otherwise grow. New files must match functional scope ${functional.scope}.`
        : 'Owner-first/reuse-first remains mandatory; new owner creation requires explicit source-creation intent.',
    contract.native_bricks.enabled && !contract.native_bricks.allow_custom_source
      ? 'Hard native-Bricks rule: do not add a shortcode or custom Bricks Element source when native Bricks can own the requested UI.'
      : '',
    contract.global_css.root_only_in_owner
      ? `Hard global-CSS rule: new :root/global tokens may only be added in ${contract.global_css.owner}. Component/page CSS belongs in its scoped owner.`
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
            next_action:'Reuse owner theo đúng chức năng. Nếu owner hiện tại chỉ là functions.php/style.css/global entry và contract cho phép functional split, hãy tạo owner page/component/module có tên ổn định trong đúng cấu trúc project.'
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
  explicitNoNewFileIntent,
  explicitNewFileIntent,
  explicitCustomBricksSourceIntent,
  functionalScope,
  functionalOwnerPolicy,
  matchesFunctionalScopePath,
  buildHardRuleContract,
  addedLinesByFile,
  validateHardProjectRules,
  createHardProjectRulesApi,
  installHardProjectRulesPatches
};