const PROFILE_VERSION = 1;
const DECISION_LIMIT = 12;
const DECISION_VALUE_LIMIT = 320;
const FACT_VALUE_LIMIT = 180;
const PROFILE_CONTEXT_FACT_LIMIT = 9;
const PROFILE_CONTEXT_DECISION_LIMIT = 6;

const FACT_KEYS = Object.freeze([
  'cms','builder','bricks_version','commerce','product_model','child_theme','child_theme_root','parent_theme',
  'global_css_owner','page_css_pattern','shared_product_renderer','shared_post_renderer','source','database',
  'production_deploy','php_runtime','primary_language'
]);
const FACT_KEY_SET = new Set(FACT_KEYS);

function cleanKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0,64);
}

function isUnsafeMemory(key, value) {
  const normalizedKey = cleanKey(key);
  const text = String(value || '');
  if (/(?:^|[-_.])(?:password|passwd|secret|credential|api[-_.]?(?:key|token)|access[-_.]?token|auth[-_.]?token|refresh[-_.]?token|session[-_.]?token|private[-_.]?key)(?:$|[-_.])/i.test(normalizedKey)) return true;
  if (/https?:\/\/|www\./i.test(text)) return true;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text)) return true;
  if (/(?:password|passwd|secret|credential|api[-_.\s]?(?:key|token)|access[-_.\s]?token|auth[-_.\s]?token|refresh[-_.\s]?token|session[-_.\s]?token)\s*[:=]/i.test(text)) return true;
  if (/\bbearer\s+[A-Za-z0-9._~+\/-]{8,}/i.test(text)) return true;
  return false;
}

function normalizeDecisions(raw = []) {
  const byKey = new Map();
  for (const item of Array.isArray(raw) ? raw.slice(-DECISION_LIMIT * 3) : []) {
    const key = cleanKey(item?.key);
    const value = String(item?.value || '').trim().slice(0, DECISION_VALUE_LIMIT);
    if (!key || !value || isUnsafeMemory(key, value)) continue;
    byKey.set(key, { key, value, updatedAt:String(item?.updatedAt || new Date().toISOString()) });
  }
  return [...byKey.values()].slice(-DECISION_LIMIT);
}

function normalizeFacts(raw = {}) {
  const out = {};
  for (const key of FACT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw || {}, key)) continue;
    const value = String(raw?.[key] ?? '').trim().slice(0, FACT_VALUE_LIMIT);
    if (!value || isUnsafeMemory(key, value)) continue;
    out[key] = value;
  }
  return out;
}

function normalizeFactSources(raw = {}, facts = {}) {
  const out = {};
  for (const key of Object.keys(facts)) {
    const value = String(raw?.[key] || 'detected').trim().slice(0,80);
    out[key] = value || 'detected';
  }
  return out;
}

function normalizeProjectProfile(raw = {}, legacyRules = []) {
  const facts = normalizeFacts(raw?.facts || {});
  const decisions = normalizeDecisions([...(Array.isArray(legacyRules) ? legacyRules : []), ...(Array.isArray(raw?.decisions) ? raw.decisions : [])]);
  return {
    version:PROFILE_VERSION,
    facts,
    factSources:normalizeFactSources(raw?.factSources || {}, facts),
    decisions,
    updatedAt:String(raw?.updatedAt || '')
  };
}

function frameworkStrings(inspect = {}) {
  return [
    ...(inspect?.framework_names || []),
    ...(inspect?.frameworks || []).map(item => item?.name || item || ''),
    ...((inspect?.wordpress?.childThemes || []).map(item => `${item?.name || ''} ${item?.slug || ''} ${item?.template || ''}`)),
    ...((inspect?.wordpress?.parentThemes || []).map(item => `${item?.name || ''} ${item?.slug || ''}`))
  ].map(String).filter(Boolean);
}

function relevantSourceText(inspect = {}) {
  return (inspect?.relevant_files || []).map(item => String(item?.content || '')).filter(Boolean).join('\n').slice(0, 500000);
}

function detectBricksVersion(inspect = {}) {
  const joined = `${frameworkStrings(inspect).join('\n')}\n${relevantSourceText(inspect)}`;
  const explicit = joined.match(/\bBricks(?:\s+Builder)?\s*(?:version|v)?\s*[:=]?\s*(\d+\.\d+(?:\.\d+)?)/i);
  if (explicit) return explicit[1];
  const styleHeader = relevantSourceText(inspect).match(/^\s*Version\s*:\s*(\d+\.\d+(?:\.\d+)?)/mi);
  return styleHeader?.[1] || '';
}

function detectCptProductModel(inspect = {}) {
  if (inspect?.wordpress?.woocommerce) return '';
  const text = relevantSourceText(inspect);
  const slugs = [];
  const re = /\bregister_post_type\s*\(\s*(['"])([^'"]+)\1/gi;
  let match;
  while ((match = re.exec(text))) {
    const slug = String(match[2] || '').trim();
    if (slug && !slugs.includes(slug)) slugs.push(slug);
    if (slugs.length >= 20) break;
  }
  const productish = slugs.filter(slug => /product|san[-_]?pham|sản[-_]?phẩm|sp[-_]/i.test(slug));
  return productish.length === 1 ? productish[0] : '';
}

function detectCssOwner(inspect = {}) {
  const paths = (inspect?.relevant_files || []).map(item => String(item?.path || '').replace(/\\/g,'/')).filter(Boolean);
  const preferred = paths.find(file => /(?:^|\/)assets\/css\/main\.css$/i.test(file))
    || paths.find(file => /(?:^|\/)main\.css$/i.test(file))
    || paths.find(file => /(?:^|\/)(?:global|base)\.css$/i.test(file));
  return preferred || '';
}

function validCallableRendererSymbol(symbol = {}) {
  const name = String(symbol?.name || '').trim();
  const kind = String(symbol?.kind || '').trim().toLowerCase();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  return !kind || /^(?:function|method)$/.test(kind);
}

function detectSharedProductRenderer(inspect = {}) {
  const names = [];
  for (const symbol of inspect?.top_symbols || []) {
    const name = String(symbol?.name || '');
    if (!validCallableRendererSymbol(symbol) || !/(?:product.*card|card.*product|product.*item|item.*product)/i.test(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  if (!names.length) {
    const text = relevantSourceText(inspect), re = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*(?:product[A-Za-z0-9_]*(?:card|item)|(?:card|item)[A-Za-z0-9_]*product)[A-Za-z0-9_]*)\s*\(/gi;
    let match;
    while ((match = re.exec(text))) if (!names.includes(match[1])) names.push(match[1]);
  }
  if (names.length === 1) return names[0];
  const renderers = names.filter(name => /(?:render.*product.*(?:card|item)|product.*(?:card|item).*render)/i.test(name));
  return renderers.length === 1 ? renderers[0] : '';
}

function deriveProjectFacts(inspect = {}, currentFacts = {}, project = {}) {
  const facts = { ...normalizeFacts(currentFacts) };
  if (facts.shared_product_renderer && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(facts.shared_product_renderer)) delete facts.shared_product_renderer;
  const sources = {};
  const set = (key, value, source) => {
    value = String(value || '').trim();
    if (!FACT_KEY_SET.has(key) || !value) return;
    facts[key] = value.slice(0, FACT_VALUE_LIMIT);
    sources[key] = String(source || 'inspection').slice(0,80);
  };

  const wp = inspect?.wordpress || {};
  const frameworks = frameworkStrings(inspect);
  if (wp.isWordPress || frameworks.some(value => /\bwordpress\b/i.test(value))) set('cms','wordpress','inspection.frameworks');
  if (frameworks.some(value => /\bbricks\b/i.test(value))) set('builder','bricks','inspection.frameworks');
  else if (frameworks.some(value => /\bflatsome\b/i.test(value))) set('builder','flatsome','inspection.frameworks');

  if (facts.builder === 'bricks') {
    const version = detectBricksVersion(inspect);
    if (version) set('bricks_version', version, 'retrieved-source');
  }

  const child = (wp.childThemes || [])[0];
  if (child) {
    set('child_theme', child.slug || child.name, 'wordpress-profile');
    set('child_theme_root', child.root, 'wordpress-profile');
    if (child.template) set('parent_theme', child.template, 'wordpress-profile');
  }
  if (!facts.parent_theme && facts.builder === 'bricks') {
    const bricksParent = (wp.parentThemes || []).find(theme => /bricks/i.test(`${theme?.slug || ''} ${theme?.name || ''}`));
    if (bricksParent) set('parent_theme', bricksParent.slug || bricksParent.name, 'wordpress-profile');
  }

  if (wp.woocommerce) {
    set('commerce','woocommerce','wordpress-profile');
    set('product_model','wc_product','wordpress-profile');
  } else {
    const cptProduct = detectCptProductModel(inspect);
    if (cptProduct) {
      set('commerce','custom_cpt','retrieved-source');
      set('product_model',cptProduct,'retrieved-source');
    }
  }

  const cssOwner = detectCssOwner(inspect);
  if (cssOwner) set('global_css_owner', cssOwner, 'retrieved-file-path');
  const productRenderer = detectSharedProductRenderer(inspect);
  if (productRenderer) set('shared_product_renderer', productRenderer, 'retrieved-source-symbol');
  if (inspect?.primary_language) set('primary_language', inspect.primary_language, 'inspection.primary_language');
  if (project?.root) set('source','local','chatcode-project-root');

  return { facts:normalizeFacts(facts), detectedSources:sources };
}

function readProjectProfile(store, projectId) {
  if (!store || typeof store.getProject !== 'function') return normalizeProjectProfile();
  try {
    const project = store.getProject(projectId);
    return normalizeProjectProfile(project.projectProfile, project.projectRules);
  } catch {
    return normalizeProjectProfile();
  }
}

function profilesEqual(a, b) {
  return JSON.stringify({ facts:a?.facts || {}, factSources:a?.factSources || {}, decisions:a?.decisions || [] }) === JSON.stringify({ facts:b?.facts || {}, factSources:b?.factSources || {}, decisions:b?.decisions || [] });
}

function refreshProjectProfile(store, projectId, inspect = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') return readProjectProfile(store, projectId);
  const state = store.read();
  const index = state.projects.findIndex(project => project.id === projectId);
  if (index < 0) return readProjectProfile(store, projectId);
  const project = state.projects[index];
  const current = normalizeProjectProfile(project.projectProfile, project.projectRules);
  const derived = deriveProjectFacts(inspect, current.facts, project);
  const next = normalizeProjectProfile({
    ...current,
    facts:derived.facts,
    factSources:{ ...current.factSources, ...derived.detectedSources },
    decisions:current.decisions,
    updatedAt:current.updatedAt
  });
  if (!profilesEqual(current, next)) {
    next.updatedAt = new Date().toISOString();
    state.projects[index].projectProfile = next;
    state.projects[index].projectRules = next.decisions;
    store.write(state);
    return readProjectProfile(store, projectId);
  }
  return current;
}

function saveProjectDecisions(store, projectId, input) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') return readProjectProfile(store, projectId);
  const proposed = Array.isArray(input) ? input : [];
  if (!proposed.length) return readProjectProfile(store, projectId);
  const state = store.read();
  const index = state.projects.findIndex(project => project.id === projectId);
  if (index < 0) return readProjectProfile(store, projectId);
  const project = state.projects[index];
  const current = normalizeProjectProfile(project.projectProfile, project.projectRules);
  const now = new Date().toISOString();
  const decisions = normalizeDecisions([...current.decisions, ...proposed.map(item => ({ key:item?.key, value:item?.value, updatedAt:now }))]);
  const next = normalizeProjectProfile({ ...current, decisions, updatedAt:now });
  state.projects[index].projectProfile = next;
  state.projects[index].projectRules = next.decisions;
  store.write(state);
  return readProjectProfile(store, projectId);
}

function requestTokens(value) {
  const stop = new Set(['the','and','for','with','this','that','from','into','trong','cho','của','cua','với','voi','một','mot','phần','phan','sửa','sua','chỉnh','chinh','thêm','them','tạo','tao']);
  return [...new Set(String(value || '').toLowerCase().split(/[^a-z0-9À-ỹ_-]+/i).filter(token => token.length >= 3 && !stop.has(token)))].slice(0,18);
}

function selectRelevantDecisions(profile, request, type = '', preferredKeys = []) {
  const decisions = normalizeDecisions(profile?.decisions || []);
  const wanted = new Set((preferredKeys || []).map(String));
  if (wanted.size) return decisions.filter(item => wanted.has(item.key)).slice(0, PROFILE_CONTEXT_DECISION_LIMIT);
  const tokens = new Set(requestTokens(`${request} ${type}`));
  const ranked = decisions.map(item => {
    const key = item.key.toLowerCase(), value = item.value.toLowerCase(); let score = 0;
    for (const token of tokens) { if (key.includes(token)) score += 4; if (value.includes(token)) score += 1; }
    return { item, score };
  }).filter(row => row.score > 0).sort((a,b) => b.score - a.score);
  return ranked.slice(0, PROFILE_CONTEXT_DECISION_LIMIT).map(row => row.item);
}

function selectRelevantFacts(profile, request, type = '') {
  const facts = normalizeFacts(profile?.facts || {}), text = `${String(request || '').toLowerCase()} ${String(type || '').toLowerCase()}`;
  const keys = new Set(['cms','builder','commerce','product_model','child_theme']);
  if (/bricks|builder|template|element|control|header|footer|archive|single/.test(text)) ['bricks_version','child_theme_root','parent_theme'].forEach(key => keys.add(key));
  if (/css|style|font|layout|container|card|renderer|homepage|home/.test(text)) ['global_css_owner','page_css_pattern','shared_product_renderer','shared_post_renderer'].forEach(key => keys.add(key));
  if (/data|cpt|seed|migration|import|database|db|product/.test(text)) ['database','product_model','commerce'].forEach(key => keys.add(key));
  if (/production|deploy|ftp|sftp|hosting|live|cache/.test(text)) ['source','production_deploy','php_runtime'].forEach(key => keys.add(key));
  if (/php|lint|runtime/.test(text)) ['php_runtime','primary_language'].forEach(key => keys.add(key));
  const out = {};
  for (const key of keys) if (facts[key]) out[key] = facts[key];
  return Object.fromEntries(Object.entries(out).slice(0, PROFILE_CONTEXT_FACT_LIMIT));
}

function projectProfileContext(profile, request, type = '', preferredDecisionKeys = []) {
  const normalized = normalizeProjectProfile(profile);
  const facts = selectRelevantFacts(normalized, request, type);
  const decisions = selectRelevantDecisions(normalized, request, type, preferredDecisionKeys).map(({ key,value }) => ({ key,value }));
  return {
    version:PROFILE_VERSION,
    facts,
    decisions,
    omitted:{
      facts:Math.max(0, Object.keys(normalized.facts).length - Object.keys(facts).length),
      decisions:Math.max(0, normalized.decisions.length - decisions.length)
    },
    updatedAt:normalized.updatedAt || ''
  };
}

module.exports = {
  PROFILE_VERSION,
  FACT_KEYS,
  normalizeFacts,
  normalizeDecisions,
  normalizeProjectProfile,
  deriveProjectFacts,
  readProjectProfile,
  refreshProjectProfile,
  saveProjectDecisions,
  selectRelevantFacts,
  selectRelevantDecisions,
  projectProfileContext
};