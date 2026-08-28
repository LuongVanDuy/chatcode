const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills');
const MAX_ENTRY_CHARS = 9000;
const MAX_RESOURCE_CHARS = 16000;
const MAX_SKILL_CONTEXT_CHARS = 56000;
const CORE_RESOURCE = 'resources/core-checklist.md';
const WORDPRESS_BRICKS_SKILL_ID = 'wordpress-bricks';
const SUPPORT_RESOURCES = new Set(['resources/snippets.md', 'resources/patterns.md']);

function safeRead(file, maxChars) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return String(text || '').slice(0, maxChars);
  } catch {
    return '';
  }
}

function readManifest(skillId) {
  const dir = path.join(SKILL_ROOT, skillId);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    return { dir, manifest };
  } catch {
    return null;
  }
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
    parts.push(String(item?.source || item?.from || ''));
    parts.push(String(item?.target || item?.to || ''));
    parts.push(String(item?.kind || item?.type || ''));
  }
  return parts.join('\n').toLowerCase();
}

function shouldUseProjectEvidence(request) {
  const text = String(request || '').trim().toLowerCase();
  if (!text) return true;
  const explicitDomain = /frontend|giao\s+diện|layout|responsive|\bcss\b|style|typography|template|header|footer|archive|single|woocommerce|\bwoo\b|product|checkout|cart|database|\bdb\b|seed|migration|migrate|duplicate|builder\s+data|element\s+id|menu|ajax|rest\s+api|php|javascript|\bjs\b|enqueue|component|renderer|file|folder|refactor|tái\s+cấu\s+trúc|sản\s+phẩm|giỏ\s+hàng|thanh\s+toán|dữ\s+liệu/.test(text);
  if (explicitDomain) return false;
  if (text.length > 180) return false;
  return /sửa\s+tiếp|chỉnh\s+tiếp|làm\s+tiếp|tiếp\s+tục|phần\s+này|chỗ\s+này|cái\s+này|như\s+trên|same\s+(?:thing|part|section)|continue|this\s+(?:part|section|one)/.test(text);
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
  const themeEvidence = themes.some(theme => /\bbricks\b/i.test([
    theme?.slug,
    theme?.name,
    theme?.template,
    theme?.root
  ].filter(Boolean).join(' ')));
  const frameworkEvidence = (inspect?.frameworks || []).some(item => /\bbricks(?:\s+builder)?\b/i.test(`${item?.name || item || ''} ${item?.evidence || ''}`));
  const fileEvidence = (inspect?.relevant_files || []).some(item => /(?:^|\/)wp-content\/themes\/bricks(?:-child)?(?:\/|$)/i.test(String(item?.path || item?.file || item || '')));
  const bricks = themeEvidence || frameworkEvidence || fileEvidence || /(?:^|\/)wp-content\/themes\/bricks(?:-child)?(?:\/|$)/i.test(haystack);
  return { active:wordpress && bricks, wordpress, bricks, haystack };
}

function hasBricksEvidence(inspect) {
  return hasBricksProjectEvidence(inspect);
}

function requiredSkillsForProject(inspect) {
  return hasBricksProjectEvidence(inspect).active ? [WORDPRESS_BRICKS_SKILL_ID] : [];
}

function chooseResources(manifest, request, inspect = null) {
  const available = new Set((manifest?.resources || []).map(String));
  const chosen = new Set([CORE_RESOURCE]);
  const requestText = String(request || '').toLowerCase();
  const evidenceText = shouldUseProjectEvidence(request) ? routingEvidenceText(inspect) : '';
  const text = `${requestText}\n${evidenceText}`;

  const broadAudit = /audit|validate|validation|acceptance|regression|code\s+review|project\s+review|review\s+(?:the\s+)?(?:code|project|site|theme)|full\s+(?:check|audit|review)|check\s+(?:all|entire|whole)|scan\s+(?:all|entire|whole)|quét\s+(?:lại\s+)?toàn\s+bộ|rà\s+soát\s+toàn\s+bộ|kiểm\s+tra\s+toàn\s+bộ|refactor\s+(?:all|entire|whole)|tái\s+cấu\s+trúc\s+toàn\s+bộ/.test(requestText);
  const elementDelete = /(?:delete|remove|xóa|xoá)[^\n]{0,80}(?:element|phần tử)|(?:element|phần tử)[^\n]{0,80}(?:delete|remove|xóa|xoá)/.test(text);
  const generatedCssMaintenance = /(?:regenerate|generate|refresh|rebuild|clear)[^\n]{0,80}(?:bricks\s+)?css[^\n]{0,80}(?:file|cache)|(?:bricks\s+)?css[^\n]{0,80}(?:file|cache)[^\n]{0,80}(?:regenerate|generate|refresh|rebuild|clear)/.test(text);

  const uiTask = !generatedCssMaintenance && /frontend|giao\s+diện|layout|responsive|mobile|tablet|desktop|\bcss\b|\.scss\b|assets\/css|style|styling|font|typography|màu|color|spacing|khoảng\s+cách|padding|margin|radius|shadow|transition|shell|gutter|container|hero|breadcrumb|page\s*title|section\s*title|card|button|input|width|chiều\s+rộng|trang\s+mới|new\s+page/.test(text);
  const codeTask = /\bphp\b|javascript|\bjs\b|\bcss\b|\.scss\b|functions\.php|enqueue|filemtime|asset|module|component|helper|hook|function|class|file|folder|filename|path|inc\/|assets\/|child\s*theme|plugin|tên\s+file|thư\s+mục|refactor|tái\s+cấu\s+trúc/.test(text);
  const templateTask = /template|header|footer|archive|taxonomy|category|author|date\s+archive|single\s+(?:post|product)|post-title|post-content|related-posts|template\s+condition|mẫu\s+bricks|mẫu\s+giao\s+diện|wc_archive|wc_cart|wc_form_checkout|wc_thankyou/.test(text);
  const wooTask = /woocommerce|\bwoo\b|product|shop|cart|checkout|thank\s*you|order\s+received|mini\s*cart|upsell|cross-sell|variation|wc_archive|wc_cart|wc_form_checkout|wc_thankyou|sản\s+phẩm|giỏ\s+hàng|thanh\s+toán/.test(text);

  const evidenceDataFile = /(?:^|\/)(?:[^/]*-)?(?:seed|seeding|maintenance|repair|migration|migrations|installer|bootstrap)[^/]*\.(?:php|js|ts)\b/.test(evidenceText);
  const createData = /(?:create|tạo|seed|khởi\s+tạo)[^\n]{0,120}(?:template|wc_archive|wc_cart|wc_form_checkout|wc_thankyou|page|post|cpt|menu|sample|data|record|bài|trang|dữ\s+liệu)|(?:template|wc_archive|wc_cart|wc_form_checkout|wc_thankyou|page|post|cpt|menu|sample|data|record|bài|trang|dữ\s+liệu)[^\n]{0,120}(?:create|tạo|seed|khởi\s+tạo)/.test(text);
  const seedTask = createData || evidenceDataFile || /seed|reseed|generated\s+data|sample\s+data|default\s+data|wp_insert_post|add_option|duplicate|trùng\s+(?:dữ\s+liệu|template|bài|post)|semantic\s+(?:key|identity)|atomic\s+lock/.test(text);
  const migrationTask = elementDelete || evidenceDataFile || /migration|migrate|builder\s+data|database|\bdb\b|element\s+id|repair|cleanup|duplicate|trùng|rollback|compare-and-set|css\s+file|regenerate|cache|classic\s+shortcode|block\s*(?:cart|checkout)|sửa\s+dữ\s+liệu|dọn\s+dữ\s+liệu/.test(text);

  const snippetTask = elementDelete || /custom\s+element|ajax|rest\s+api|query|menu|nav|enqueue|filemtime|element\s+id|javascript|\bjs\b|\bcss\b|hook|helper|render|renderer|slider|accordion/.test(text);
  const patternTask = broadAudit || /architecture|kiến\s+trúc|build|implement|create|triển\s+khai|xây\s+dựng|tạo\s+mới|restructure|refactor|tái\s+cấu\s+trúc|custom\s+element|reusable|shared|dùng\s+chung/.test(text);

  if (codeTask) chosen.add('resources/code-organization.md');
  if (uiTask) chosen.add('resources/design-system.md');
  if (seedTask) chosen.add('resources/data-seeding.md');
  if (migrationTask) chosen.add('resources/migrations.md');
  if (templateTask) chosen.add('resources/templates.md');

  if (wooTask) {
    chosen.add('resources/woocommerce.md');
    if (/archive|single|template|shop|product|sản\s+phẩm|wc_archive|wc_cart|wc_form_checkout|wc_thankyou/.test(text)) chosen.add('resources/templates.md');
  }

  if (snippetTask) chosen.add('resources/snippets.md');
  if (patternTask) chosen.add('resources/patterns.md');
  if (broadAudit) chosen.add('resources/validation.md');

  return [...chosen].filter(file => available.has(file));
}

function loadResourcesWithBudget(dir, selected) {
  const required = selected.filter(relative => !SUPPORT_RESOURCES.has(relative));
  const support = selected.filter(relative => SUPPORT_RESOURCES.has(relative));
  const resources = [];
  const omitted = [];
  let usedChars = 0;

  const load = relative => {
    const content = safeRead(path.join(dir, relative), MAX_RESOURCE_CHARS);
    if (!content) return null;
    return { name:relative, content };
  };

  for (const relative of required) {
    const item = load(relative);
    if (!item) continue;
    resources.push(item);
    usedChars += item.content.length;
  }

  for (const relative of support) {
    const item = load(relative);
    if (!item) continue;
    if (usedChars + item.content.length > MAX_SKILL_CONTEXT_CHARS) {
      omitted.push(relative);
      continue;
    }
    resources.push(item);
    usedChars += item.content.length;
  }

  return {
    resources,
    budget:{
      soft_limit_chars:MAX_SKILL_CONTEXT_CHARS,
      used_chars:usedChars,
      exceeded_by_required_rules:usedChars > MAX_SKILL_CONTEXT_CHARS,
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
  const entryPath = path.join(dir, String(manifest.entry || 'SKILL.md'));
  const instructions = safeRead(entryPath, MAX_ENTRY_CHARS);
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
    resource_context:{
      selected,
      ...loadedResources.budget
    }
  };
}

function skillsForTask(inspect, request) {
  const skills = [];
  const wordpressBricks = loadWordPressBricksSkill(inspect, request);
  if (wordpressBricks) skills.push(wordpressBricks);
  return skills;
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
  chooseResources,
  loadResourcesWithBudget,
  loadWordPressBricksSkill,
  skillsForTask
};
