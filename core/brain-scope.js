const path = require('path');
const { classifyWordPressPath } = require('./wordpress-retrieval');

const WP_MAX_CONTENT_FILES = 320;
const WP_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const WP_MAX_BOOTSTRAP_FILES = 48;

function norm(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function isWordPressNoise(file) {
  const p = norm(file).toLowerCase();
  return /(^|\/)(?:node_modules|vendor|cache|caches|backup|backups|logs?)(\/|$)/i.test(p)
    || /^wp-content\/(?:uploads|languages|upgrade|cache|backups?)(\/|$)/i.test(p)
    || /\.min\.(?:js|css)$/i.test(p)
    || /(^|\/)(?:readme|changelog)(?:\.|$)/i.test(p);
}

function wordpressBootstrapFiles(files) {
  const normalized = (Array.isArray(files) ? files : []).map(norm);
  const themeStyles = normalized.filter(file => /^wp-content\/themes\/[^/]+\/style\.css$/i.test(file));
  const manifests = normalized.filter(file => {
    const lower = file.toLowerCase();
    return !lower.includes('/') && ['package.json', 'composer.json'].includes(lower);
  });
  return [...new Set([...themeStyles, ...manifests])].slice(0, WP_MAX_BOOTSTRAP_FILES);
}

function wordpressOwnedRoots(profile = {}) {
  return [
    ...(profile.childThemes || []).map(item => norm(item.root)).filter(Boolean),
    ...(profile.customPlugins || []).map(item => norm(item.root)).filter(Boolean),
    'wp-content/mu-plugins'
  ];
}

function isDefaultWordPressContent(file, profile = {}) {
  const p = norm(file);
  if (!p || isWordPressNoise(p)) return false;
  const role = classifyWordPressPath(p, profile);
  return role === 'child-theme' || role === 'custom-plugin' || role === 'wp-content-other';
}

function planWordPressBrainContent(candidates, profile = {}, rank = () => 0) {
  const source = Array.isArray(candidates) ? candidates : [];
  const owned = source
    .filter(file => isDefaultWordPressContent(file, profile))
    .sort((a, b) => Number(rank(b) || 0) - Number(rank(a) || 0));
  const selected = [...new Set(owned.map(norm))].slice(0, WP_MAX_CONTENT_FILES);
  return {
    selected,
    max_files:WP_MAX_CONTENT_FILES,
    max_bytes:WP_MAX_TOTAL_BYTES,
    scope:'wordpress-owned',
    primary_roots:wordpressOwnedRoots(profile),
    candidate_count:source.length,
    scoped_candidate_count:owned.length,
    excluded_by_scope:Math.max(0, source.length - owned.length),
    truncated:owned.length > selected.length,
    rule:'WordPress Brain indexes paths broadly but content-reads child themes/custom plugins/wp-content project code by default. Core/framework/vendor content stays metadata-only until an explicit task widens retrieval.'
  };
}

module.exports = {
  WP_MAX_CONTENT_FILES,
  WP_MAX_TOTAL_BYTES,
  WP_MAX_BOOTSTRAP_FILES,
  norm,
  isWordPressNoise,
  wordpressBootstrapFiles,
  wordpressOwnedRoots,
  isDefaultWordPressContent,
  planWordPressBrainContent
};
