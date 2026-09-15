const { detectBricksVersion } = require('./bricks-spec');

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

function detectCptProductModels(inspect = {}) {
  const source = relevantSourceText(inspect);
  const slugs = [];
  const re = /\bregister_post_type\s*\(\s*(['"])([^'"]+)\1/gi;
  let match;
  while ((match = re.exec(source))) {
    const slug = String(match[2] || '').trim();
    if (slug && !slugs.includes(slug)) slugs.push(slug);
    if (slugs.length >= 24) break;
  }
  return slugs.filter(slug => /product|san[-_]?pham|sản[-_]?phẩm|sp[-_]/i.test(slug)).slice(0,6);
}

function productModelDecision(decisions = []) {
  const rows = normalizeDecisions(decisions).slice().reverse();
  for (const item of rows) {
    const haystack = `${item.key} ${item.value}`;
    if (!/(?:product|catalog|catalogue|sản\s*phẩm|san[-_\s]?pham)/i.test(haystack)) continue;
    if (/\bwc_product\b|woocommerce\s+(?:native\s+)?product/i.test(item.value)) return 'wc_product';
    const explicit = item.value.match(/\b(?:cpt|custom\s+post\s+type|post[_\s-]?type)\s*(?:is|=|:|uses?|dùng|dung)?\s*[`'\"]?([a-z0-9_-]{2,80})/i)
      || item.value.match(/\buses?\s+(?:the\s+)?(?:cpt|post\s+type)\s+[`'\"]?([a-z0-9_-]{2,80})/i);
    if (explicit?.[1] && !/^(?:woocommerce|product|products|native)$/i.test(explicit[1])) return explicit[1];
  }
  return '';
}

function detectCssOwner(inspect = {}) {
  const paths = (inspect?.relevant_files || []).map(item => String(item?.path || '').replace(/\\/g,'/')).filter(Boolean);
  const preferred = paths.find(file => /(?:^|\/)assets\/css\/main\.css$/i.test(file))
    || paths.find(file => /(?:^|\/)main\.css$/i.test(file))
    || paths.find(file => /(?:^|\/)(?:global|base)\.css$/i.test(file));
  return preferred || '';
}

function detectSharedProductRenderer(inspect = {}) {
  const names = [];
  for (const symbol of inspect?.top_symbols || []) {
    const name = String(symbol?.name || '');
    if (!name || !/(?:product.*card|card.*product|product.*item|item.*product)/i.test(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  if (!names.length) {
    const source = relevantSourceText(inspect), re = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*(?:product[A-Za-z0-9_]*(?:card|item)|(?:card|item)[A-Za-z0-9_]*product)[A-Za-z0-9_]*)\s*\(/gi;
    let match;
    while ((match = re.exec(source))) if (!names.includes(match[1])) names.push(match[1]);
  }
  return names.length === 1 ? names[0] : '';
}

function deriveProjectFacts(inspect = {}, currentFacts = {}, project = {}, decisions = []) {
  const facts = { ...normalizeFacts(currentFacts) };
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
    if (version) set('bricks_version', version, 'bricks-spec.detector');
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

  const wooActive = !!wp.woocommerce;
  const cptModels = detectCptProductModels(inspect);
  const decidedModel = productModelDecision(decisions);
  if (wooActive) set('commerce','woocommerce','wordpress-profile');
  else if (cptModels.length === 1) set('commerce','custom_cpt','retrieved-source');

  if (decidedModel) {
    set('product_model',decidedModel,'project-decision');
    if (!wooActive && decidedModel !== 'wc_product') set('commerce','custom_cpt','project-decision');
  } else if (wooActive && cptModels.length === 0) {
    set('product_model','wc_product','wordpress-profile');
  } else if (!wooActive && cptModels.length === 1) {
    set('product_model',cptModels[0],'retrieved-source');
  } else if (wooActive && cptModels.length) {
    const existing = String(currentFacts?.product_model || '');
    if (existing && existing !== 'wc_product' && existing !== 'mixed_unresolved' && cptModels.includes(existing)) {
      set('product_model',existing,'existing-confirmed-mixed-model');
    } else {
      set('product_model','mixed_unresolved','mixed-commerce-evidence');
    }
  } else if (cptModels.length > 1) {
    const existing = String(currentFacts?.product_model || '');
    if (existing && cptModels.includes(existing)) set('product_model',existing,'existing-confirmed-cpt-model');
    else set('product_model','mixed_unresolved','multiple-productish-cpts');
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
  const derived = deriveProjectFacts(inspect, current.facts, project, current.decisions);
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
  const facts = normalizeFacts(profile?.facts || {}), query = `${String(request || '').toLowerCase()} ${String(type || '').toLowerCase()}`;
  const keys = new Set(['cms','builder','commerce','product_model','child_theme']);
  if (/bricks|builder|template|element|control|header|footer|archive|single/.test(query)) ['bricks_version','child_theme_root','parent_theme'].forEach(key => keys.add(key));
  if (/css|style|font|layout|container|card|renderer|homepage|home/.test(query)) ['global_css_owner','page_css_pattern','shared_product_renderer','shared_post_renderer'].forEach(key => keys.add(key));
  if (/data|cpt|seed|migration|import|database|db|product/.test(query)) ['database','product_model','commerce'].forEach(key => keys.add(key));
  if (/production|deploy|ftp|sftp|hosting|live|cache/.test(query)) ['source','production_deploy','php_runtime'].forEach(key => keys.add(key));
  if (/php|lint|runtime/.test(query)) ['php_runtime','primary_language'].forEach(key => keys.add(key));
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
