const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills', 'wordpress-bricks', 'data', 'ui-guidelines.json');
const MAX_RESULTS = 3;
const STOPWORDS = new Set([
  'the','and','for','with','from','this','that','into','trong','cho','cua','của','voi','với','mot','một','cai','cái',
  'sua','sửa','them','thêm','lam','làm','phan','phần','trang','section','website','site'
]);

let cache = null;

function norm(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return [...new Set(norm(value).split(/\s+/).filter(token => token.length > 1 && !STOPWORDS.has(token)))];
}

function loadGuidelines() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

function projectEvidence(inspect) {
  const parts = [];
  for (const item of inspect?.relevant_files || []) parts.push(item?.path || item?.file || '');
  for (const item of inspect?.framework_names || []) parts.push(item || '');
  const target = inspect?.task_card?.target || inspect?.target || '';
  if (target) parts.push(target);
  return parts.join(' ');
}

function scoreGuideline(item, queryTokens, queryText, evidenceText) {
  const haystack = norm([
    item.id,
    item.category,
    item.title,
    ...(item.tags || []),
    ...(item.targets || []),
    item.rule,
    item.check
  ].join(' '));
  const tagSet = new Set(tokens([...(item.tags || []), ...(item.targets || [])].join(' ')));
  let score = Number(item.priority || 0) * 0.08;
  let matched = 0;

  for (const token of queryTokens) {
    if (!haystack.includes(token)) continue;
    matched += 1;
    score += tagSet.has(token) ? 3 : 1;
  }

  for (const phrase of item.phrases || []) {
    const p = norm(phrase);
    if (p && queryText.includes(p)) score += 5;
  }

  for (const target of item.targets || []) {
    const t = norm(target);
    if (t && (queryText.includes(t) || evidenceText.includes(t))) score += 2.5;
  }

  if (!matched && !(item.phrases || []).some(phrase => queryText.includes(norm(phrase)))) return 0;
  const coverage = queryTokens.length ? matched / queryTokens.length : 0;
  return score + Math.min(2, coverage * 2);
}

function searchUiKnowledge(query, inspect = null, limit = MAX_RESULTS) {
  const queryText = norm(query);
  const queryTokens = tokens(query);
  const evidenceText = norm(projectEvidence(inspect));
  const max = Math.max(1, Math.min(MAX_RESULTS, Number(limit) || MAX_RESULTS));

  return loadGuidelines()
    .map(item => ({ ...item, score:scoreGuideline(item, queryTokens, queryText, evidenceText) }))
    .filter(item => item.score > 0)
    .sort((a,b) => b.score - a.score || Number(b.priority || 0) - Number(a.priority || 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0, max)
    .map(item => ({
      id:item.id,
      category:item.category,
      title:item.title,
      rule:item.rule,
      check:item.check,
      score:Number(item.score.toFixed(2))
    }));
}

function formatUiKnowledge(results) {
  const items = Array.isArray(results) ? results : [];
  if (!items.length) return '';
  return [
    'Verified UI guidance for this task:',
    ...items.map(item => `- [${item.category}] ${item.title}: ${item.rule} Verify: ${item.check}`)
  ].join('\n');
}

function resetUiKnowledgeCache() { cache = null; }

module.exports = {
  DATA_FILE,
  MAX_RESULTS,
  norm,
  tokens,
  loadGuidelines,
  searchUiKnowledge,
  formatUiKnowledge,
  resetUiKnowledgeCache
};
