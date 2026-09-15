const fs = require('fs');
const path = require('path');

const SPEC_DIR = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills', 'wordpress-bricks', 'data');
const SPEC_REGISTRY = Object.freeze({
  '2.3.6':path.join(SPEC_DIR, 'bricks-spec-2.3.6.json'),
  '2.3.13':path.join(SPEC_DIR, 'bricks-spec-2.3.13.json')
});
// Backward-compatible export: legacy tests/tools expect SPEC_PATH/readBundledSpec() to
// resolve the original baseline. Runtime resolution below selects the exact version.
const SPEC_PATH = SPEC_REGISTRY['2.3.6'];
const CURRENT_STABLE_SPEC_VERSION = '2.3.13';
const bundledCache = new Map();

function normalizeVersion(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3] || 0)}` : '';
}

function versionParts(value) {
  const normalized = normalizeVersion(value);
  return normalized ? normalized.split('.').map(Number) : [];
}

function readSpecFile(file) {
  if (!file) return null;
  if (bundledCache.has(file)) return bundledCache.get(file);
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    bundledCache.set(file, value);
    return value;
  } catch {
    bundledCache.set(file, null);
    return null;
  }
}

function readBundledSpec(version = '2.3.6') {
  const normalized = normalizeVersion(version) || '2.3.6';
  return readSpecFile(SPEC_REGISTRY[normalized]);
}

function availableBundledSpecs() {
  return Object.keys(SPEC_REGISTRY).filter(version => !!readBundledSpec(version));
}

function relevantSourceText(inspect = {}) {
  return (inspect?.relevant_files || [])
    .map(item => `${item?.path || item?.file || ''}\n${item?.content || ''}`)
    .join('\n')
    .slice(0, 1200000);
}

function bricksParentThemeVersion(inspect = {}) {
  const wp = inspect?.wordpress || {};
  const parents = [...(wp.parentThemes || []), ...(wp.parent_themes || [])];
  for (const theme of parents) {
    const identity = `${theme?.slug || ''} ${theme?.name || ''} ${theme?.root || ''}`;
    if (!/(?:^|\s|\/)bricks(?:\s|\/|$)/i.test(identity)) continue;
    const version = normalizeVersion(theme?.version);
    if (version) return version;
  }
  return '';
}

function frameworkBricksVersion(inspect = {}) {
  for (const item of inspect?.frameworks || []) {
    if (!/\bbricks(?:\s+builder)?\b/i.test(String(item?.name || item || ''))) continue;
    const version = normalizeVersion(item?.version);
    if (version) return version;
    const evidenceVersion = normalizeVersion(item?.evidence);
    if (evidenceVersion) return evidenceVersion;
  }
  return '';
}

function sourceBricksVersion(inspect = {}) {
  const source = relevantSourceText(inspect);
  const constant = source.match(/\bBRICKS_VERSION\b[^\n]{0,80}['"](\d+\.\d+(?:\.\d+)?)['"]/i);
  if (constant) return normalizeVersion(constant[1]);

  for (const item of inspect?.relevant_files || []) {
    const file = String(item?.path || item?.file || '').replace(/\\/g,'/');
    if (!/(?:^|\/)bricks\/style\.css$/i.test(file) && !/(?:^|\/)wp-content\/themes\/bricks\/style\.css$/i.test(file)) continue;
    const version = String(item?.content || '').match(/^\s*Version\s*:\s*(\d+\.\d+(?:\.\d+)?)/mi);
    if (version) return normalizeVersion(version[1]);
  }
  return '';
}

function suspiciousChildThemeProfileVersion(inspect = {}, profileVersion = '') {
  if (!profileVersion) return false;
  const wp = inspect?.wordpress || {};
  const children = [...(wp.childThemes || []), ...(wp.child_themes || [])];
  return children.some(theme => {
    if (!/\bbricks\b/i.test(String(theme?.template || ''))) return false;
    return normalizeVersion(theme?.version) === profileVersion;
  });
}

function detectBricksVersion(inspect = {}) {
  const direct = [
    inspect?.bricks_version,
    inspect?.bricks?.version,
    inspect?.wordpress?.bricksVersion,
    inspect?.wordpress?.bricks_version
  ].map(normalizeVersion).find(Boolean);
  if (direct) return direct;

  const parent = bricksParentThemeVersion(inspect);
  if (parent) return parent;

  const framework = frameworkBricksVersion(inspect);
  if (framework) return framework;

  const source = sourceBricksVersion(inspect);
  if (source) return source;

  const profile = normalizeVersion(inspect?.project_profile?.facts?.bricks_version || inspect?.projectProfile?.facts?.bricks_version);
  if (profile && !suspiciousChildThemeProfileVersion(inspect, profile)) return profile;
  return '';
}

function normalizeLocalSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!raw.node || !raw.settings || !raw.elements) return null;
  return raw;
}

function closestBundledSpec(detectedVersion = '') {
  const detected = versionParts(detectedVersion);
  const versions = availableBundledSpecs();
  if (!versions.length) return { version:'', spec:null };
  if (!detected.length) {
    const version = versions.includes(CURRENT_STABLE_SPEC_VERSION) ? CURRENT_STABLE_SPEC_VERSION : versions[versions.length - 1];
    return { version, spec:readBundledSpec(version) };
  }
  const sameMinor = versions.filter(version => {
    const [major,minor] = versionParts(version);
    return major === detected[0] && minor === detected[1];
  });
  const pool = sameMinor.length ? sameMinor : versions;
  const version = pool.sort((a,b) => {
    const aa=versionParts(a), bb=versionParts(b);
    return (bb[0]-aa[0]) || (bb[1]-aa[1]) || (bb[2]-aa[2]);
  })[0];
  return { version, spec:readBundledSpec(version) };
}

function resolveBricksSpec(inspect = {}) {
  const local = normalizeLocalSpec(inspect?.bricks_spec || inspect?.bricks?.spec || inspect?.wordpress?.bricks_spec);
  const detectedVersion = detectBricksVersion(inspect);

  if (local) {
    return {
      spec:local,
      source:'local-project-evidence',
      detected_version:detectedVersion || normalizeVersion(local.bricks_version),
      spec_version:normalizeVersion(local.bricks_version),
      status:'local', confidence:1, exact_shapes:true, source_required:false
    };
  }

  if (detectedVersion && SPEC_REGISTRY[detectedVersion]) {
    const spec = readBundledSpec(detectedVersion);
    if (spec) {
      return {
        spec, source:'bundled-source-verified', detected_version:detectedVersion,
        spec_version:detectedVersion, status:'exact', confidence:0.995,
        exact_shapes:true, source_required:false
      };
    }
  }

  const fallback = closestBundledSpec(detectedVersion);
  if (!fallback.spec) {
    return { spec:null, source:'none', detected_version:detectedVersion, spec_version:'', status:'missing', confidence:0, exact_shapes:false, source_required:true };
  }

  const specVersion = normalizeVersion(fallback.spec.bricks_version || fallback.version);
  const [dm,dn] = versionParts(detectedVersion);
  const [sm,sn] = versionParts(specVersion);
  if (detectedVersion && dm === sm && dn === sn) {
    return { spec:fallback.spec, source:'bundled-invariants-only', detected_version:detectedVersion, spec_version:specVersion, status:'compatible-version-different-patch', confidence:0.76, exact_shapes:false, source_required:true };
  }
  if (detectedVersion) {
    return { spec:fallback.spec, source:'bundled-invariants-only', detected_version:detectedVersion, spec_version:specVersion, status:'version-mismatch', confidence:0.45, exact_shapes:false, source_required:true };
  }
  return { spec:fallback.spec, source:'bundled-invariants-only', detected_version:'', spec_version:specVersion, status:'version-unknown', confidence:0.5, exact_shapes:false, source_required:true };
}

function tokenize(value) {
  const stop = new Set(['the','and','for','with','from','this','that','into','trong','cho','cua','của','voi','với','sua','sửa','them','thêm','tao','tạo','lam','làm','phần','phan']);
  return [...new Set(String(value || '').toLowerCase().split(/[^a-z0-9À-ỹ_-]+/i).filter(token => token.length >= 2 && !stop.has(token)))].slice(0,28);
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
  for (const list of Object.values(groups)) if (Array.isArray(list)) values.push(...list.map(String));
  if (Array.isArray(spec?.legacy_avoid)) values.push(...spec.legacy_avoid.map(String));
  if (Array.isArray(spec?.legacy_prefer_nested)) values.push(...spec.legacy_prefer_nested.map(String));
  return new Set(values);
}

module.exports = {
  SPEC_DIR,
  SPEC_REGISTRY,
  SPEC_PATH,
  CURRENT_STABLE_SPEC_VERSION,
  readBundledSpec,
  availableBundledSpecs,
  normalizeVersion,
  detectBricksVersion,
  resolveBricksSpec,
  searchBricksKnowledge,
  formatBricksKnowledge,
  allKnownElements
};
