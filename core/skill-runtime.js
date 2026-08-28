const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills');
const MAX_ENTRY_CHARS = 9000;
const MAX_RESOURCE_CHARS = 16000;
const CORE_RESOURCE = 'resources/core-checklist.md';

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

function inspectionHaystack(inspect, request) {
  const parts = [String(request || '')];
  for (const item of inspect?.framework_names || []) parts.push(String(item || ''));
  for (const item of inspect?.frameworks || []) parts.push(String(item?.name || item || ''), String(item?.evidence || ''));
  for (const item of inspect?.relevant_files || []) parts.push(String(item?.path || item?.file || item || ''));
  try { parts.push(JSON.stringify(inspect?.wordpress || {})); } catch {}
  return parts.join('\n').toLowerCase();
}

function hasWordPressEvidence(inspect, haystack) {
  if (inspect?.wordpress?.isWordPress) return true;
  if ((inspect?.framework_names || []).some(name => /wordpress|woocommerce/i.test(String(name)))) return true;
  return /\bwordpress\b|\bwoocommerce\b|wp-content\//i.test(haystack);
}

function hasBricksEvidence(inspect, request) {
  const haystack = inspectionHaystack(inspect, request);
  const wordpress = hasWordPressEvidence(inspect, haystack);
  const bricks = /\bbricks(?:\s+builder)?\b|\/themes\/bricks(?:-child)?\b|template\s*:\s*bricks\b/i.test(haystack);
  return { active: wordpress && bricks, haystack };
}

function chooseResources(manifest, request) {
  const available = new Set((manifest?.resources || []).map(String));
  const chosen = new Set([CORE_RESOURCE]);
  const text = String(request || '').toLowerCase();

  const broadAudit = /audit|validate|validation|acceptance|regression|code\s+review|review\s+(?:this|code|project|implementation|all|entire|whole)|full\s+(?:check|audit|review)|check\s+(?:all|entire|whole)|scan\s+(?:all|entire|whole)|quét\s+(?:lại\s+)?toàn\s+bộ|rà\s+soát\s+toàn\s+bộ|kiểm\s+tra\s+toàn\s+bộ|refactor\s+(?:all|entire|whole)|tái\s+cấu\s+trúc\s+toàn\s+bộ/.test(text);
  const elementDelete = /(?:delete|remove|xóa|xoá)[^\n]{0,80}(?:element|phần tử)|(?:element|phần tử)[^\n]{0,80}(?:delete|remove|xóa|xoá)/.test(text);
  const generatedCssMaintenance = /(?:regenerate|generate|rebuild|refresh)[^\n]{0,60}(?:bricks\s+)?css|(?:bricks\s+)?css[^\n]{0,60}(?:file\s+cache|generated\s+file|regenerate|generate|rebuild)|generate_post_css_file/.test(text);

  const explicitUiTask = /frontend|giao\s+diện|layout|responsive|mobile|tablet|desktop|font|typography|màu|color|spacing|khoảng\s+cách|padding|margin|radius|shadow|transition|shell|gutter|container|hero|breadcrumb|page\s*title|section\s*title|card|button|input|width|chiều\s+rộng|trang\s+mới|new\s+page/.test(text);
  const cssStylingTask = !generatedCssMaintenance && /\bcss\b|style|styling/.test(text);
  const uiTask = explicitUiTask || cssStylingTask;

  const fileStructureTask = /(?:create|rename|move|organize|refactor|tạo|đổi\s+tên|di\s+chuyển|sắp\s+xếp)[^\n]{0,80}(?:file|folder|filename|path|tệp|thư\s+mục)|(?:file|folder|filename|path|tệp|thư\s+mục)[^\n]{0,80}(?:create|rename|move|organize|refactor|tạo|đổi\s+tên|di\s+chuyển|sắp\s+xếp)/.test(text);
  const codeTask = /\bphp\b|javascript|\bjs\b|functions\.php|enqueue|filemtime|asset|module|component|helper|hook|function|class|inc\/|assets\/|child\s*theme|plugin|tên\s+file|thư\s+mục|refactor|tái\s+cấu\s+trúc/.test(text) || fileStructureTask || (!generatedCssMaintenance && /\bcss\b/.test(text));

  const templateTask = /template|header|footer|archive|taxonomy|category|author|date\s+archive|single\s+(?:post|product)|post-title|post-content|related-posts|template\s+condition|mẫu\s+bricks|mẫu\s+giao\s+diện/.test(text);
  const wooTask = /woocommerce|\bwoo\b|product|shop|cart|checkout|thank\s*you|order\s+received|mini\s*cart|upsell|cross-sell|variation|wc_archive|wc_cart|wc_form_checkout|wc_thankyou|sản\s+phẩm|giỏ\s+hàng|thanh\s+toán/.test(text);

  const creationVerb = /create|build|implement|tạo|xây\s+dựng|khởi\s+tạo|triển\s+khai/.test(text);
  const createData = /(?:create|tạo|seed|khởi\s+tạo)[^\n]{0,100}(?:template|page|post|cpt|menu|sample|data|record|bài|trang|dữ\s+liệu)|(?:template|page|post|cpt|menu|sample|data|record|bài|trang|dữ\s+liệu)[^\n]{0,100}(?:create|tạo|seed|khởi\s+tạo)/.test(text);
  const seedTask = createData || (creationVerb && templateTask) || /seed|reseed|generated\s+data|sample\s+data|default\s+data|wp_insert_post|add_option|duplicate|trùng\s+(?:dữ\s+liệu|template|bài|post)|semantic\s+(?:key|identity)|atomic\s+lock/.test(text);
  const migrationTask = elementDelete || /migration|migrate|builder\s+data|database|\bdb\b|element\s+id|repair|cleanup|duplicate|trùng|rollback|compare-and-set|css\s+file|regenerate|cache|classic\s+shortcode|block\s*(?:cart|checkout)|sửa\s+dữ\s+liệu|dọn\s+dữ\s+liệu/.test(text);

  const snippetTask = elementDelete || /custom\s+element|ajax|rest\s+api|query|menu|nav|enqueue|filemtime|element\s+id|javascript|\bjs\b|\bcss\b|hook|helper|render|renderer|slider|accordion/.test(text);
  const patternTask = broadAudit || /architecture|kiến\s+trúc|build|implement|create|triển\s+khai|xây\s+dựng|tạo\s+mới|restructure|refactor|tái\s+cấu\s+trúc|custom\s+element|reusable|shared|dùng\s+chung/.test(text);

  if (codeTask) chosen.add('resources/code-organization.md');
  if (uiTask) chosen.add('resources/design-system.md');
  if (seedTask) chosen.add('resources/data-seeding.md');
  if (migrationTask) chosen.add('resources/migrations.md');
  if (templateTask) chosen.add('resources/templates.md');

  if (wooTask) {
    chosen.add('resources/woocommerce.md');
    if (/archive|single|template|shop|product|sản\s+phẩm/.test(text)) chosen.add('resources/templates.md');
  }

  if (snippetTask) chosen.add('resources/snippets.md');
  if (patternTask) chosen.add('resources/patterns.md');
  if (broadAudit) chosen.add('resources/validation.md');

  return [...chosen].filter(file => available.has(file));
}

function loadWordPressBricksSkill(inspect, request) {
  const evidence = hasBricksEvidence(inspect, request);
  if (!evidence.active) return null;

  const loaded = readManifest('wordpress-bricks');
  if (!loaded) return null;
  const { dir, manifest } = loaded;
  const entryPath = path.join(dir, String(manifest.entry || 'SKILL.md'));
  const instructions = safeRead(entryPath, MAX_ENTRY_CHARS);
  if (!instructions) return null;

  const resources = chooseResources(manifest, request).map(relative => ({
    name:relative,
    content:safeRead(path.join(dir, relative), MAX_RESOURCE_CHARS)
  })).filter(item => item.content);

  return {
    id:String(manifest.id || 'wordpress-bricks'),
    name:String(manifest.name || 'WordPress + Bricks'),
    version:Number(manifest.version || 1),
    activation:'wordpress+bricks-evidence',
    instructions,
    resources
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
  hasBricksEvidence,
  chooseResources,
  loadWordPressBricksSkill,
  skillsForTask
};
