const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills');
const MAX_ENTRY_CHARS = 18000;
const MAX_RESOURCE_CHARS = 14000;

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
  const chosen = new Set(['resources/patterns.md', 'resources/validation.md']);
  const text = String(request || '').toLowerCase();

  if (/seed|reseed|migration|migrate|element\s+id|template\s+condition|builder\s+data|database|css\s+file|regenerate|cache/.test(text)) {
    chosen.add('resources/migrations.md');
  }
  if (/custom\s+element|ajax|query|menu|header|footer|woocommerce|product|cart|checkout|thank|mini\s*cart|responsive|css|javascript|js/.test(text)) {
    chosen.add('resources/snippets.md');
  }

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
  hasBricksEvidence,
  chooseResources,
  loadWordPressBricksSkill,
  skillsForTask
};
