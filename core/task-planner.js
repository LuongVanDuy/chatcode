const path = require('path');

const TASK_TYPES = Object.freeze({
  FAST_UI:'FAST_UI',
  BRICKS_BUILDER:'BRICKS_BUILDER',
  DATA:'DATA',
  PRODUCTION:'PRODUCTION'
});

const EXECUTION_PATHS = Object.freeze({
  FAST:'FAST',
  DEEP:'DEEP'
});

const TYPE_READ_LIMIT = Object.freeze({
  FAST_UI:4,
  BRICKS_BUILDER:6,
  DATA:6,
  PRODUCTION:6
});

const PATH_LIMITS = Object.freeze({
  FAST:Object.freeze({ context_files:4, patch_files:4, skill_chars:6000 }),
  DEEP:Object.freeze({ context_files:6, patch_files:24, skill_chars:56000 })
});

function unique(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function requestTokens(request) {
  const stop = new Set(['the','and','for','with','this','that','from','into','trong','cho','của','cua','với','voi','một','mot','phần','phan','sửa','sua','chỉnh','chinh','thêm','them','tạo','tao']);
  return unique(normalizeText(request).split(/[^a-z0-9À-ỹ_-]+/i).filter(token => token.length >= 3 && !stop.has(token))).slice(0,18);
}

function hasBricks(inspect = {}) {
  if ((inspect?.framework_names || []).some(name => /\bbricks\b/i.test(String(name)))) return true;
  if ((inspect?.frameworks || []).some(item => /\bbricks\b/i.test(String(item?.name || item || '')))) return true;
  const wp = inspect?.wordpress || {};
  return [...(wp.childThemes || []), ...(wp.parentThemes || [])].some(theme => /\bbricks\b/i.test(`${theme?.slug || ''} ${theme?.name || ''} ${theme?.template || ''} ${theme?.root || ''}`));
}

function classifyTask(request, inspect = {}) {
  const text = normalizeText(request);

  const production = /\b(?:ftp|sftp|production|deploy|deployment|hosting|server|cdn)\b|website\s+live|live\s+(?:site|website|frontend)|upload[^\n]{0,70}(?:hosting|server|ftp|sftp)|(?:cache|asset)[^\n]{0,50}(?:live|production)|(?:live|production)[^\n]{0,50}(?:cache|asset)/i.test(text);
  if (production) return TASK_TYPES.PRODUCTION;

  const data = /\b(?:cpt|database|db|seed|seeding|reseed|migration|migrate|import|export|duplicate|duplicates)\b|custom\s+post\s+type|bulk\s+(?:update|import|create)|wp_insert_post|wp_update_post|update_post_meta|builder\s+data|dữ\s+liệu|du\s+lieu|trùng\s+(?:bài|post|template|dữ\s+liệu)|duplicate\s+(?:post|template|record|data)/i.test(text);
  if (data) return TASK_TYPES.DATA;

  const builderIntent = /builder[-\s]?editable|builder\s+controls?|set_controls|repeater|custom\s+(?:bricks\s+)?element|query\s+loop|template\s+condition|bricks\s+template|native\s+bricks|bricks\s+(?:page|section|element)|(?:create|build|add|tạo|tao|thêm|them|triển\s+khai)[^\n]{0,70}(?:section|page|trang|template|element)|(?:header|footer|archive|single)[^\n]{0,40}template|template[^\n]{0,40}(?:header|footer|archive|single)/i.test(text);
  if (hasBricks(inspect) && builderIntent) return TASK_TYPES.BRICKS_BUILDER;

  return TASK_TYPES.FAST_UI;
}

function deepPathReasons(request, type = '') {
  const text = normalizeText(request);
  const reasons = [];
  const add = (reason, re) => { if (re.test(text)) reasons.push(reason); };

  if (type === TASK_TYPES.PRODUCTION) reasons.push('production-operation');
  add('production-operation', /\b(?:ftp|sftp|production|deploy|deployment|hosting|server)\b|website\s+live|live\s+(?:site|website|frontend)/i);
  add('bricks-template', /bricks\s+template|(?:header|footer|archive|single)[^\n]{0,50}template|template[^\n]{0,50}(?:header|footer|archive|single)|template\s+condition/i);
  add('builder-schema', /custom\s+(?:bricks\s+)?element|builder\s+controls?|set_controls|\brepeater\b|builder[-\s]?editable/i);
  add('builder-page-write', /(?:create|build|tạo|tao|triển\s+khai)[^\n]{0,70}(?:native\s+bricks|bricks)[^\n]{0,50}(?:page|trang)|(?:native\s+bricks|bricks)[^\n]{0,50}(?:page|trang)/i);
  add('persisted-data-migration', /\b(?:migration|migrate)\b|builder\s+data|element\s+id|parent\s*\/\s*children|compare-and-set|rollback[^\n]{0,50}(?:db|database|builder|data)/i);
  add('bulk-or-seed', /\b(?:seed|seeding|reseed)\b|bulk\s+(?:import|update|create|delete)|(?:import|nhập\s+dữ\s+liệu)[^\n]{0,80}(?:all|bulk|toàn\s+bộ|products?|sản\s*phẩm)/i);
  add('woocommerce-state', /(?:woocommerce|\bwoo\b)?[^\n]{0,30}\b(?:checkout|cart|order)\b|giỏ\s+hàng|thanh\s+toán|đơn\s+hàng/i);
  add('destructive-data-repair', /(?:delete|remove|drop|truncate|cleanup|repair|xóa|xoá|dọn)[^\n]{0,90}(?:duplicate|data|database|record|post|template|builder)|(?:duplicate|trùng)[^\n]{0,90}(?:delete|remove|cleanup|repair|xóa|xoá|dọn)/i);
  add('explicit-broad-scope', /full\s+(?:audit|refactor|review)|(?:audit|refactor|review)[^\n]{0,50}(?:entire|whole|all)\s+(?:project|site|code)|quét\s+(?:lại\s+)?toàn\s+bộ|rà\s+soát\s+toàn\s+bộ|tái\s+cấu\s+trúc\s+toàn\s+bộ/i);

  return unique(reasons);
}

function preflightExecutionPath(request) {
  const reasons = deepPathReasons(request, '');
  const executionPath = reasons.length ? EXECUTION_PATHS.DEEP : EXECUTION_PATHS.FAST;
  return { path:executionPath, reasons, limits:PATH_LIMITS[executionPath] };
}

function classifyExecutionPath(request, type) {
  const reasons = deepPathReasons(request, type);
  const executionPath = reasons.length ? EXECUTION_PATHS.DEEP : EXECUTION_PATHS.FAST;
  return { path:executionPath, reasons, limits:PATH_LIMITS[executionPath] };
}

function targetLabel(request) {
  const text = normalizeText(request);
  const parts = [];
  const add = (label, re) => { if (re.test(text)) parts.push(label); };
  add('homepage', /homepage|home\s*page|trang\s+chủ|trang\s+chu/);
  add('header', /\bheader\b/);
  add('footer', /\bfooter\b/);
  add('product card', /product\s+card|card\s+sản\s*phẩm|thẻ\s+sản\s*phẩm/);
  add('featured products', /featured\s+products?|sản\s*phẩm\s+nổi\s+bật/);
  add('archive', /\barchive\b|taxonomy/);
  add('single product', /single\s+product|chi\s+tiết\s+sản\s*phẩm/);
  add('checkout', /checkout|thanh\s+toán/);
  add('CPT', /\bcpt\b|custom\s+post\s+type/);
  add('migration', /migration|migrate|di\s+chuyển\s+dữ\s+liệu/);
  add('import', /\bimport\b|nhập\s+dữ\s+liệu/);
  add('font', /\bfont\b|typography|phông\s+chữ/);
  add('container', /\bcontainer\b|\bwidth\b|chiều\s+rộng/);
  add('section', /\bsection\b/);
  if (parts.length) return unique(parts).slice(0,3).join(' / ');
  return String(request || '').trim().replace(/\s+/g, ' ').slice(0,160) || 'task';
}

function scoreFile(item, index, request, type) {
  const rel = String(item?.path || item?.file || item || '').replace(/\\/g, '/');
  const lower = rel.toLowerCase();
  let score = Math.max(0, 20 - index * 2);
  for (const token of requestTokens(request)) if (lower.includes(token)) score += 4;

  if (type === TASK_TYPES.FAST_UI) {
    if (/\.(?:css|scss|sass|less)$/.test(lower)) score += 10;
    if (/header|footer|home|product|card|style|frontend/.test(lower)) score += 3;
  } else if (type === TASK_TYPES.BRICKS_BUILDER) {
    if (/bricks|element|template|header|footer|archive|single|builder/.test(lower)) score += 9;
    if (/\.php$/.test(lower)) score += 3;
  } else if (type === TASK_TYPES.DATA) {
    if (/seed|migration|migrate|post-type|cpt|import|data|database|setup|installer/.test(lower)) score += 10;
    if (/\.php$/.test(lower)) score += 3;
  } else if (type === TASK_TYPES.PRODUCTION) {
    if (/deploy|ftp|sftp|cache|asset|enqueue|functions\.php/.test(lower)) score += 8;
  }

  return { path:rel, score, role:String(item?.role || ''), reasons:Array.isArray(item?.reasons) ? item.reasons.slice(0,3).map(String) : [] };
}

function selectOwnerCandidates(inspect, request, type, limit = TYPE_READ_LIMIT[type] || 6) {
  const files = (inspect?.relevant_files || []).map((item,index) => scoreFile(item,index,request,type)).filter(item => item.path);
  files.sort((a,b) => b.score - a.score || a.path.localeCompare(b.path));
  return files.slice(0, Math.max(1, Number(limit) || 6));
}

function selectRelevantRules(projectRules, request, type) {
  const tokens = new Set(requestTokens(request));
  for (const token of normalizeText(type).split(/[^a-z0-9]+/)) if (token.length > 2) tokens.add(token);
  if (type === TASK_TYPES.FAST_UI) ['css','style','font','layout','container','card','renderer','owner'].forEach(x => tokens.add(x));
  if (type === TASK_TYPES.BRICKS_BUILDER) ['bricks','builder','template','element','control','editable'].forEach(x => tokens.add(x));
  if (type === TASK_TYPES.DATA) ['cpt','data','seed','migration','product','database'].forEach(x => tokens.add(x));
  if (type === TASK_TYPES.PRODUCTION) ['production','deploy','ftp','source','cache'].forEach(x => tokens.add(x));

  const ranked = [];
  for (const rule of Array.isArray(projectRules) ? projectRules : []) {
    const key = normalizeText(rule?.key);
    const value = normalizeText(rule?.value);
    let score = 0;
    for (const token of tokens) {
      if (key.includes(token)) score += 4;
      if (value.includes(token)) score += 1;
    }
    if (/builder|owner|renderer|global|css|layout|product|source|deploy/.test(key)) score += 1;
    if (score > 0) ranked.push({ key:String(rule.key), value:String(rule.value), score });
  }
  return ranked.sort((a,b) => b.score - a.score).slice(0,6).map(({ key,value }) => ({ key,value }));
}

function typePolicy(type) {
  if (type === TASK_TYPES.BRICKS_BUILDER) return {
    preserve:['current Builder/user-edited data','Bricks element IDs, parent/children relations and unrelated settings','existing shared renderer and design-system ownership'],
    out:['unrelated templates or sections','whole Builder-tree reseed for a targeted change','shortcode replacement when native Bricks can own the content','global CSS refactor unless explicitly requested'],
    verify:['Builder controls/settings remain editable','validate touched Bricks tree/template conditions','check only affected responsive states']
  };
  if (type === TASK_TYPES.DATA) return {
    preserve:['records outside the requested data set','current Builder/user-edited data','stable semantic identity for generated records'],
    out:['unrelated UI redesign','full reseed when a targeted update is sufficient','destructive duplicate cleanup without evidence','production deploy unless explicitly requested'],
    verify:['dry-run or preflight when possible','before/after counts and duplicate check','idempotency on repeat execution','rollback/recovery path for material writes']
  };
  if (type === TASK_TYPES.PRODUCTION) return {
    preserve:['confirmed local source of truth','unrelated remote files and data','current live state until the changed artifact is verified'],
    out:['unrelated source refactor','database mutation unless explicitly requested','broad cache clearing before source/deploy state is checked'],
    verify:['identify local/remote/production source of truth','deploy only expected changed files','confirm asset/cache version when relevant','verify the live target after deploy']
  };
  return {
    preserve:['existing owner/component structure','unrelated sections, files and layout','shared renderer and global design tokens'],
    out:['broad CSS/code refactor','new renderer/template/migration for a targeted UI change','unrelated data or Builder changes','production deploy unless explicitly requested'],
    verify:['check the affected page/component only','check affected responsive breakpoints','syntax-check changed executable source']
  };
}

function verificationFromHints(hints) {
  return unique((Array.isArray(hints) ? hints : []).map(item => item?.command || item?.command_template || '').filter(Boolean));
}

function explicitNewFileRequest(request) {
  return /(?:create|add|tạo|tao|thêm|them)[^\n]{0,60}(?:new\s+)?(?:file|stylesheet|css\s+file|php\s+file)|(?:file|stylesheet)[^\n]{0,60}(?:create|add|tạo|tao|thêm|them)/i.test(String(request || ''));
}

function buildTaskCard({ request, inspect = {}, projectRules = [], verificationHints = [] } = {}) {
  const type = classifyTask(request, inspect);
  const execution = classifyExecutionPath(request, type);
  const typeLimit = TYPE_READ_LIMIT[type] || 6;
  const limit = Math.min(typeLimit, execution.limits.context_files);
  const ownerCandidates = selectOwnerCandidates(inspect, request, type, limit);
  const relevantRules = selectRelevantRules(projectRules, request, type);
  const policy = typePolicy(type);
  const primary = ownerCandidates[0] || null;
  const verification = unique([...verificationFromHints(verificationHints), ...policy.verify]).slice(0,8);
  const allowNewFile = execution.path === EXECUTION_PATHS.FAST && explicitNewFileRequest(request);

  return {
    version:2,
    type,
    execution:{
      path:execution.path,
      reasons:execution.reasons,
      context_file_limit:execution.limits.context_files,
      patch_file_limit:execution.limits.patch_files,
      skill_context_limit_chars:execution.limits.skill_chars,
      allow_new_source_files:execution.path === EXECUTION_PATHS.DEEP ? 'existing owner first' : allowNewFile ? 1 : 0,
      allow_delete:execution.path === EXECUTION_PATHS.DEEP,
      escalation:'fixed for this task; do not self-promote FAST to DEEP. Re-plan only when concrete evidence makes the current path unsafe.'
    },
    target:targetLabel(request),
    owner:{
      status:primary ? 'candidate' : 'unknown',
      primary_path:primary?.path || null,
      candidates:ownerCandidates.map(item => item.path).slice(0,limit),
      basis:primary ? 'ranked existing task context; confirm ownership before broadening or creating a new owner' : 'no owner candidate in current task context'
    },
    expected_files:ownerCandidates.map(item => item.path).slice(0,limit),
    must_preserve:policy.preserve,
    out_of_scope:policy.out,
    verification,
    decision_keys:relevantRules.map(rule => rule.key),
    constraints:{
      expected_read_limit:limit,
      new_source_files:execution.path === EXECUTION_PATHS.FAST ? (allowNewFile ? 1 : 0) : 'existing owner first',
      scope_expansion:execution.path === EXECUTION_PATHS.FAST ? 'blocked by default; re-plan only on concrete evidence' : 'evidence-driven only'
    }
  };
}

function normalizePatchPath(value) {
  let text = String(value || '').trim();
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1,-1);
  text = text.replace(/^\.?\/?[ab]\//, '').replace(/\\/g, '/');
  return text === '/dev/null' ? '' : text;
}

function patchScopeFromUnifiedDiff(patch) {
  const lines = String(patch || '').split(/\r?\n/);
  const files = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('--- ')) continue;
    const before = normalizePatchPath(lines[i].slice(4).split('\t')[0]);
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('+++ ') && !lines[j].startsWith('--- ')) j++;
    if (j >= lines.length || !lines[j].startsWith('+++ ')) continue;
    const after = normalizePatchPath(lines[j].slice(4).split('\t')[0]);
    const file = after || before;
    if (!file) continue;
    files.push({ path:file, operation:!before ? 'create' : !after ? 'delete' : 'modify' });
    i = j;
  }
  const byPath = new Map();
  for (const item of files) byPath.set(item.path, item);
  return [...byPath.values()];
}

function validatePatchAgainstTaskCard(taskCard, patch) {
  const files = patchScopeFromUnifiedDiff(patch);
  const execution = taskCard?.execution || {};
  if (!taskCard || execution.path !== EXECUTION_PATHS.FAST) return { ok:true, files, violations:[], unexpected_files:[] };

  const violations = [];
  const limit = Math.max(1, Number(execution.patch_file_limit) || PATH_LIMITS.FAST.patch_files);
  if (files.length > limit) violations.push(`FAST patch touches ${files.length} files; limit is ${limit}`);

  const creates = files.filter(item => item.operation === 'create');
  const deletes = files.filter(item => item.operation === 'delete');
  const newLimit = Number(execution.allow_new_source_files) || 0;
  if (creates.length > newLimit) violations.push(`FAST patch creates ${creates.length} files; allowed is ${newLimit}`);
  if (deletes.length && execution.allow_delete !== true) violations.push('FAST patch may not delete files');

  if (taskCard.type === TASK_TYPES.FAST_UI) {
    const deepOnlyPaths = files.filter(item => /(?:^|\/)(?:migrations?|seed(?:ing)?|installer|database)(?:\/|[-_.])/i.test(item.path));
    if (deepOnlyPaths.length) violations.push(`FAST_UI patch entered data/migration ownership: ${deepOnlyPaths.map(item => item.path).join(', ')}`);
  }

  const expected = new Set((taskCard.expected_files || []).map(item => String(item).replace(/\\/g, '/')));
  const unexpected = expected.size ? files.filter(item => !expected.has(item.path)).map(item => item.path) : [];
  if (files.length && expected.size && files.every(item => !expected.has(item.path))) {
    violations.push('FAST patch abandons all ranked owner candidates; re-plan before changing a different owner');
  }

  return { ok:violations.length === 0, files, violations, unexpected_files:unexpected };
}

module.exports = {
  TASK_TYPES,
  EXECUTION_PATHS,
  TYPE_READ_LIMIT,
  PATH_LIMITS,
  classifyTask,
  deepPathReasons,
  preflightExecutionPath,
  classifyExecutionPath,
  targetLabel,
  selectOwnerCandidates,
  selectRelevantRules,
  buildTaskCard,
  patchScopeFromUnifiedDiff,
  validatePatchAgainstTaskCard
};
