const path = require('path');

const TASK_TYPES = Object.freeze({
  FAST_UI:'FAST_UI',
  BRICKS_BUILDER:'BRICKS_BUILDER',
  DATA:'DATA',
  PRODUCTION:'PRODUCTION'
});

const TYPE_READ_LIMIT = Object.freeze({
  FAST_UI:4,
  BRICKS_BUILDER:6,
  DATA:6,
  PRODUCTION:6
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

function selectOwnerCandidates(inspect, request, type) {
  const files = (inspect?.relevant_files || []).map((item,index) => scoreFile(item,index,request,type)).filter(item => item.path);
  files.sort((a,b) => b.score - a.score || a.path.localeCompare(b.path));
  return files.slice(0, TYPE_READ_LIMIT[type] || 6);
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

function buildTaskCard({ request, inspect = {}, projectRules = [], verificationHints = [] } = {}) {
  const type = classifyTask(request, inspect);
  const ownerCandidates = selectOwnerCandidates(inspect, request, type);
  const relevantRules = selectRelevantRules(projectRules, request, type);
  const policy = typePolicy(type);
  const limit = TYPE_READ_LIMIT[type] || 6;
  const primary = ownerCandidates[0] || null;
  const verification = unique([...verificationFromHints(verificationHints), ...policy.verify]).slice(0,8);

  return {
    version:1,
    type,
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
      new_source_files:type === TASK_TYPES.FAST_UI ? 0 : 'existing owner first',
      scope_expansion:'only when a concrete missing dependency/evidence blocks a safe patch'
    }
  };
}

module.exports = {
  TASK_TYPES,
  TYPE_READ_LIMIT,
  classifyTask,
  targetLabel,
  selectOwnerCandidates,
  selectRelevantRules,
  buildTaskCard
};
