const fs = require('fs');
const path = require('path');

const SPEC_PATH = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills', 'wordpress-bricks', 'data', 'bricks-spec-2.3.6.json');
let bundledCache = null;

function readBundledSpec() {
  if (bundledCache) return bundledCache;
  try { bundledCache = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8')); }
  catch { bundledCache = null; }
  return bundledCache;
}

function normalizeVersion(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3] || 0)}` : '';
}

function versionParts(value) {
  const normalized = normalizeVersion(value);
  return normalized ? normalized.split('.').map(Number) : [];
}

function detectBricksVersion(inspect = {}) {
  const direct = [
    inspect?.project_profile?.facts?.bricks_version,
    inspect?.projectProfile?.facts?.bricks_version,
    inspect?.bricks_version,
    inspect?.bricks?.version,
    inspect?.wordpress?.bricks_version
  ].map(normalizeVersion).find(Boolean);
  if (direct) return direct;

  const themes = [...(inspect?.wordpress?.childThemes || []), ...(inspect?.wordpress?.parentThemes || [])];
  for (const theme of themes) {
    if (!/bricks/i.test(`${theme?.slug || ''} ${theme?.name || ''} ${theme?.template || ''}`)) continue;
    const version = normalizeVersion(theme?.version);
    if (version) return version;
  }

  const frameworkText = [
    ...(inspect?.framework_names || []),
    ...(inspect?.frameworks || []).flatMap(item => [item?.name || item || '', item?.version || '', item?.evidence || ''])
  ].join('\n');
  const explicit = frameworkText.match(/\bBricks(?:\s+Builder)?[^\d]{0,24}(\d+\.\d+(?:\.\d+)?)/i);
  return normalizeVersion(explicit?.[1]);
}

function normalizeLocalSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!raw.node || !raw.settings || !raw.elements) return null;
  return raw;
}

function resolveBricksSpec(inspect = {}) {
  const bundled = readBundledSpec();
  const local = normalizeLocalSpec(inspect?.bricks_spec || inspect?.bricks?.spec || inspect?.wordpress?.bricks_spec);
  const detectedVersion = detectBricksVersion(inspect);

  if (local) {
    return {
      spec:local,
      source:'local-project-evidence',
      detected_version:detectedVersion || normalizeVersion(local.bricks_version),
      spec_version:normalizeVersion(local.bricks_version),
      status:'local',
      confidence:1,
      exact_shapes:true,
      source_required:false
    };
  }

  if (!bundled) {
    return { spec:null, source:'none', detected_version:detectedVersion, spec_version:'', status:'missing', confidence:0, exact_shapes:false, source_required:true };
  }

  const specVersion = normalizeVersion(bundled.bricks_version);
  const [dm, dn, dp] = versionParts(detectedVersion);
  const [sm, sn, sp] = versionParts(specVersion);

  if (detectedVersion && dm === sm && dn === sn && dp === sp) {
    return { spec:bundled, source:'bundled-source-verified', detected_version:detectedVersion, spec_version:specVersion, status:'exact', confidence:0.98, exact_shapes:true, source_required:false };
  }
  if (detectedVersion && dm === sm && dn === sn) {
    return { spec:bundled, source:'bundled-compatible-minor', detected_version:detectedVersion, spec_version:specVersion, status:'compatible', confidence:0.84, exact_shapes:true, source_required:false };
  }
  if (detectedVersion) {
    return { spec:bundled, source:'bundled-invariants-only', detected_version:detectedVersion, spec_version:specVersion, status:'version-mismatch', confidence:0.45, exact_shapes:false, source_required:true };
  }
  return { spec:bundled, source:'bundled-invariants-only', detected_version:'', spec_version:specVersion, status:'version-unknown', confidence:0.5, exact_shapes:false, source_required:true };
}

function tokenize(value) {
  const stop = new Set(['the','and','for','with','from','this','that','into','trong','cho','cua','của','voi','với','sua','sửa','them','thêm','tao','tạo','lam','làm','phần','phan']);
  return [...new Set(String(value || '').toLowerCase().split(/[^a-z0-9À-ỹ_-]+/i).filter(token => token.length >= 2 && !stop.has(token)))].slice(0,24);
}

function searchBricksKnowledge(request, resolution, limit = 3) {
  const spec = resolution?.spec;
  if (!spec || !Array.isArray(spec.facts)) return [];
  const query = String(request || '').toLowerCase();
  const tokens = tokenize(query);
  const allowVersionBound = !!resolution?.exact_shapes;
  const rows = [];

  for (const fact of spec.facts) {
    if (!allowVersionBound && fact?.stability !== 'invariant') continue;
    const haystack = `${fact?.id || ''} ${(fact?.keywords || []).join(' ')} ${fact?.text || ''}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if ((fact?.keywords || []).some(keyword => String(keyword).toLowerCase() === token)) score += 8;
      else if ((fact?.keywords || []).some(keyword => String(keyword).toLowerCase().includes(token))) score += 5;
      if (String(fact?.id || '').toLowerCase().includes(token)) score += 4;
      if (haystack.includes(token)) score += 1;
    }
    if (query.includes(String(fact?.id || '').replace(/-/g,' '))) score += 6;
    if (score > 0) rows.push({ ...fact, score });
  }

  return rows.sort((a,b) => b.score - a.score || String(a.id).localeCompare(String(b.id))).slice(0, Math.max(1, Math.min(5, Number(limit) || 3)));
}

function formatBricksKnowledge(results, resolution) {
  if (!Array.isArray(results) || !results.length) {
    if (resolution?.source_required) return `Bricks spec: ${resolution.status}; inspect local Bricks source/version before relying on version-specific JSON shapes.`;
    return '';
  }
  const header = `Bricks spec ${resolution?.detected_version || 'unknown'} via ${resolution?.source || 'unknown'} (${resolution?.status || 'unknown'}).`;
  const lines = results.map(item => `- ${item.id}: ${item.text}`);
  if (resolution?.source_required) lines.push('- Version-specific shapes are not trusted until local Bricks evidence confirms compatibility.');
  return [header, ...lines].join('\n');
}

function allKnownElements(spec) {
  const groups = spec?.elements || {};
  const values = [];
  for (const [key, list] of Object.entries(groups)) {
    if (key === 'legacy_avoid' || !Array.isArray(list)) continue;
    values.push(...list.map(String));
  }
  return new Set(values);
}

module.exports = {
  SPEC_PATH,
  readBundledSpec,
  normalizeVersion,
  detectBricksVersion,
  resolveBricksSpec,
  searchBricksKnowledge,
  formatBricksKnowledge,
  allKnownElements
};
