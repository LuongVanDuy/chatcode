const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills');
const MAX_ENTRY_CHARS = 6000;
const MAX_RESOURCE_CHARS = 7000;
const MAX_SKILL_CONTEXT_CHARS = 10000;
const CORE_RESOURCE = 'resources/core-checklist.md';
const WORDPRESS_BRICKS_SKILL_ID = 'wordpress-bricks';
const SUPPORT_RESOURCES = new Set(['resources/snippets.md', 'resources/patterns.md']);

function safeRead(file, maxChars) {
  try { return String(fs.readFileSync(file, 'utf8') || '').slice(0, maxChars); }
  catch { return ''; }
}

function readManifest(skillId) {
  const dir = path.join(SKILL_ROOT, skillId);
  try { return { dir, manifest:JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) }; }
  catch { return null; }
}

function inspectionHaystack(inspect, request = '') {
  const parts = [String(request || '')];
  for (const item of inspect?.framework_names || []) parts.push(String(item || ''));
  for (const item of inspect?.frameworks || []) parts.push(String(item?.name || item || ''), String(item?.evidence || ''));
  for (const item of inspect?.relevant_files || []) parts.push(String(item?.path || item?.file || item || ''));
  try { parts.push(JSON.stringify(inspect?.wordpress || {})); } catch {}
  return parts.join('\n').toLowerCase();
}

function routingEvidenceText(inspect) {
  if (!inspect) return '';
  const parts = [];
  for (const item of inspect?.relevant_files || []) {
    parts.push(String(item?.path || item?.file || item || ''));
    for (const reason of item?.reasons || []) parts.push(String(reason || ''));
    if (item?.role) parts.push(String(item.role));
  }
  for (const item of inspect?.relevant_relations || []) {
    parts.push(String(item?.source || item?.from || ''), String(item?.target || item?.to || ''), String(item?.kind || item?.type || ''));
  }
  return parts.join('\n').toLowerCase();
}

function shouldUseProjectEvidence(request) {
  const text = String(request || '').trim().toLowerCase();
  if (!text) return true;
  const explicitDomain = /frontend|giao\s+diện|layout|responsive|\bcss\b|style|template|header|footer|archive|single|woocommerce|\bwoo\b|checkout|cart|database|\bdb\b|seed|migration|builder\s+data|builder\s+control|custom\s+(?:bricks\s+)?element|media|image|ảnh|icon|ajax|php|javascript|enqueue|component|renderer|refactor|dữ\s+liệu/.test(text);
  if (explicitDomain || text.length > 180) return false;
  return /sửa\s+tiếp|chỉnh\s+tiếp|làm\s+tiếp|tiếp\s+tục|phần\s+này|chỗ\s+này|cái\s+này|như\s+trên|continue|this\s+(?:part|section|one)/.test(text);
}

function hasWordPressEvidence(inspect, haystack = '') {
  if (inspect?.wordpress?.isWordPress) return true;
  if ((inspect?.framework_names || []).some(name => /wordpress|woocommerce/i.test(String(name)))) return true;
  return /\bwordpress\b|\bwoocommerce\b|wp-content\//i.test(String(haystack || ''));
}

function hasBricksProjectEvidence(inspect) {
  const haystack = inspectionHaystack(inspect, '');
  const wordpress = hasWordPressEvidence(inspect, haystack);
  const profile = inspect?.wordpress || {};
  const themes = [...(profile.childThemes || []), ...(profile.parentThemes || [])];
  const themeEvidence = themes.some(theme => /\bbricks\b/i.test([theme?.slug,theme?.name,theme?.template,theme?.root].filter(Boolean).join(' ')));
  const frameworkEvidence = (inspect?.frameworks || []).some(item => /\bbricks(?:\s+builder)?\b/i.test(`${item?.name || item || ''} ${item?.evidence || ''}`));
  const fileEvidence = (inspect?.relevant_files || []).some(item => /(?:^|\/)wp-content\/themes\/bricks(?:-child)?(?:\/|$)/i.test(String(item?.path || item?.file || item || '')));
  const bricks = themeEvidence || frameworkEvidence || fileEvidence || /(?:^|\/)wp-content\/themes\/bricks(?:-child)?(?:\/|$)/i.test(haystack);
  return { active:wordpress && bricks, wordpress, bricks, haystack };
}

function hasBricksEvidence(inspect) { return hasBricksProjectEvidence(inspect); }
function requiredSkillsForProject(inspect) { return hasBricksProjectEvidence(inspect).active ? [WORDPRESS_BRICKS_SKILL_ID] : []; }

function hasWooCommerceProjectEvidence(inspect) {
  if (inspect?.wordpress?.woocommerce === true) return true;
  if ((inspect?.framework_names || []).some(name => /woocommerce/i.test(String(name)))) return true;
  return (inspect?.frameworks || []).some(item => /woocommerce/i.test(String(item?.name || item || '')));
}

function classifyWooCommerceTask(request, inspect = null) {
  const text = String(request || '').toLowerCase();
  const excluded = /\bnon[-\s]?(?:woocommerce|woo)\b|(?:không|khong|without|\bno\b|\bnot\b)[^\n]{0,50}(?:woocommerce|\bwoo\b)/.test(text);
  if (excluded) return false;
  const explicitWoo = /woocommerce|\bwoo\b|\bwc_(?:archive|cart|form_checkout|thankyou)\b|cart|checkout|thank\s*you|order\s+received|mini\s*cart|upsell|cross-sell|variation|giỏ\s+hàng|thanh\s+toán/.test(text);
  if (explicitWoo) return true;
  const genericProduct = /\bproducts?\b|shop|sản\s+phẩm/.test(text);
  return genericProduct && (inspect == null || hasWooCommerceProjectEvidence(inspect));
}

function chooseResources(manifest, request, inspect = null) {
  const available = new Set((manifest?.resources || []).map(String));
  const requestText = String(request || '').toLowerCase();
  const evidenceText = shouldUseProjectEvidence(request) ? routingEvidenceText(inspect) : '';
  const text = `${requestText}\n${evidenceText}`;

  const retrievalTask = /scope[-\s]?first|retrieval|fetch\s+(?:source|files?|content)|project\s+brain|wp-admin|wp-includes|bricks\s+(?:parent|core)|woocommerce\s+core|outside\s+wp-content|ngoài\s+wp-content/.test(requestText);
  const broadAudit = /audit|validation|acceptance|regression|code\s+review|full\s+(?:check|audit|review)|quét\s+(?:lại\s+)?toàn\s+bộ|rà\s+soát\s+toàn\s+bộ|kiểm\s+tra\s+toàn\s+bộ/.test(requestText);
  const migrationTask = /migration|migrate|builder\s+data|database|\bdb\b|element\s+id|repair|cleanup|rollback|compare-and-set|sửa\s+dữ\s+liệu|dọn\s+dữ\s+liệu/.test(text);
  const seedTask = /seed|reseed|wp_insert_post|add_option|generated\s+data|sample\s+data|bulk\s+import|import\s+(?:products?|posts?|media)|khởi\s+tạo\s+dữ\s+liệu/.test(text);
  const builderTask = /custom\s+(?:bricks\s+)?element|builder[-\s]?editable|builder\s+controls?|set_controls|repeater|shortcode\s+element|replace[^\n]{0,80}shortcode|chọn\s+(?:thủ\s+công\s+)?sản\s*phẩm|thêm[^\n]{0,40}xóa[^\n]{0,40}(?:tab|item)/.test(text);
  const mediaIconTask = /reference\s+(?:image|media)|ảnh\s+(?:mẫu|tham\s+khảo)|hình\s+ảnh\s+(?:mẫu|tham\s+khảo)|upload\s+(?:image|media)|media\s+library|attachment\s+id|source\s+url|duplicate\s+(?:image|media)|icon|svg|zalo|logo|chứng\s+nhận|bo\s+cong\s+thuong|bộ\s+công\s+thương/.test(text);
  const templateTask = /template|header|footer|archive|taxonomy|single\s+(?:post|product)|template\s+condition|mẫu\s+bricks|wc_archive|wc_cart|wc_form_checkout|wc_thankyou/.test(text);
  const codeTask = /\bphp\b|javascript|\bjs\b|functions\.php|enqueue|filemtime|asset|module|helper|hook|function|class|file|folder|filename|path|child\s*theme|plugin|prefix|namespace|refactor|tái\s+cấu\s+trúc/.test(text);
  const uiTask = /frontend|giao\s+diện|layout|responsive|mobile|tablet|desktop|\bcss\b|\.scss\b|style|font|typography|color|màu|spacing|padding|margin|radius|shadow|container|hero|breadcrumb|card|button|input|width|chiều\s+rộng/.test(text);
  const explicitWooBehavior = /woocommerce|\bwoo\b|cart|checkout|order|variation|mini\s*cart|thank\s*you|giỏ\s+hàng|thanh\s+toán/.test(requestText);
  const wooTask = classifyWooCommerceTask(requestText, inspect);

  let primary = null;
  if (retrievalTask) primary = 'resources/retrieval-scope.md';
  else if (migrationTask) primary = 'resources/migrations.md';
  else if (seedTask) primary = 'resources/data-seeding.md';
  else if (builderTask) primary = 'resources/builder-editability.md';
  else if (mediaIconTask) primary = 'resources/media-icons.md';
  else if (explicitWooBehavior && wooTask) primary = 'resources/woocommerce.md';
  else if (templateTask) primary = 'resources/templates.md';
  else if (codeTask) primary = 'resources/code-organization.md';
  else if (uiTask) primary = 'resources/design-system.md';
  else if (wooTask) primary = 'resources/woocommerce.md';
  else if (broadAudit) primary = 'resources/validation.md';

  return [CORE_RESOURCE, primary].filter((file,index,array) => file && available.has(file) && array.indexOf(file) === index);
}

function loadResourcesWithBudget(dir, selected) {
  const resources = [], omitted = [];
  let usedChars = 0;
  for (const relative of selected) {
    const remaining = MAX_SKILL_CONTEXT_CHARS - usedChars;
    if (remaining <= 0) { omitted.push(relative); continue; }
    const content = safeRead(path.join(dir, relative), Math.min(MAX_RESOURCE_CHARS, remaining));
    if (!content) continue;
    resources.push({ name:relative, content });
    usedChars += content.length;
  }
  return {
    resources,
    budget:{
      soft_limit_chars:MAX_SKILL_CONTEXT_CHARS,
      used_chars:usedChars,
      exceeded_by_required_rules:false,
      omitted_support_resources:omitted
    }
  };
}

function loadWordPressBricksSkill(inspect, request) {
  const evidence = hasBricksProjectEvidence(inspect);
  if (!evidence.active) return null;
  const loaded = readManifest(WORDPRESS_BRICKS_SKILL_ID);
  if (!loaded) return null;
  const { dir, manifest } = loaded;
  const instructions = safeRead(path.join(dir, String(manifest.entry || 'SKILL.md')), MAX_ENTRY_CHARS);
  if (!instructions) return null;
  const selected = chooseResources(manifest, request, inspect);
  const loadedResources = loadResourcesWithBudget(dir, selected);
  return {
    id:String(manifest.id || WORDPRESS_BRICKS_SKILL_ID),
    name:String(manifest.name || 'WordPress + Bricks'),
    version:Number(manifest.version || 1),
    activation:'mandatory-wordpress-bricks-project-policy',
    mandatory:true,
    instructions,
    resources:loadedResources.resources,
    resource_context:{ selected, ...loadedResources.budget }
  };
}

function skillsForTask(inspect, request) {
  const skill = loadWordPressBricksSkill(inspect, request);
  return skill ? [skill] : [];
}

module.exports = {
  SKILL_ROOT,
  CORE_RESOURCE,
  WORDPRESS_BRICKS_SKILL_ID,
  MAX_SKILL_CONTEXT_CHARS,
  SUPPORT_RESOURCES,
  routingEvidenceText,
  shouldUseProjectEvidence,
  hasWordPressEvidence,
  hasBricksProjectEvidence,
  hasBricksEvidence,
  requiredSkillsForProject,
  hasWooCommerceProjectEvidence,
  classifyWooCommerceTask,
  chooseResources,
  loadResourcesWithBudget,
  loadWordPressBricksSkill,
  skillsForTask
};
