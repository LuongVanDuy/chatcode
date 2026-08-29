function norm(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function startsIn(path, root) {
  const p = norm(path).toLowerCase();
  const r = norm(root).toLowerCase();
  return !!r && (p === r || p.startsWith(`${r}/`));
}

function queryFlags(query) {
  const text = String(query || '').toLowerCase();
  return {
    wordpressCore:/\bwp-admin\b|\bwp-includes\b|\bwp-settings\.php\b|\bwp-load\.php\b|wordpress\s+core|core\s+wordpress|wordpress\s+bootstrap|request\s+bootstrap/.test(text),
    bricksParent:/bricks\s+parent|parent\s+bricks|bricks\s+core|native\s+bricks[^\n]{0,80}(?:class|api|hook|control|source)|verify[^\n]{0,80}bricks[^\n]{0,80}(?:class|api|hook|control|implementation)/.test(text),
    wooCore:/woocommerce\s+core|woo\s+core|verify[^\n]{0,80}(?:woocommerce|woo)[^\n]{0,80}(?:class|api|hook|implementation)|(?:woocommerce|woo)[^\n]{0,80}core\s+source/.test(text),
    outsideWpContent:/\bwp-config\.php\b|\.htaccess|robots\.txt|xmlrpc\.php|wp-cron\.php|composer\.json|package\.json|outside\s+wp-content|ngoài\s+wp-content/.test(text)
  };
}

function classifyWordPressPath(file, profile = {}) {
  const path = norm(file);
  const lower = path.toLowerCase();
  for (const theme of profile.childThemes || []) if (startsIn(path, theme.root)) return 'child-theme';
  if (lower.startsWith('wp-content/plugins/woocommerce/')) return 'woocommerce-core';
  for (const plugin of profile.customPlugins || []) if (startsIn(path, plugin.root)) return 'custom-plugin';
  for (const theme of profile.parentThemes || []) if (startsIn(path, theme.root)) return 'parent-theme';
  if (/^(wp-admin|wp-includes)(\/|$)/i.test(path) || /^wp-(?:settings|load|blog-header|cron|login|config)\.php$/i.test(path)) return 'wordpress-core';
  if (/^wp-content\/uploads\//i.test(path)) return 'uploads';
  if (/(^|\/)(?:node_modules|vendor|cache|caches|backup|backups|logs?)(\/|$)/i.test(path) || /\.min\.(?:js|css)$/i.test(path)) return 'noise';
  if (lower.startsWith('wp-content/')) return 'wp-content-other';
  return 'project-root';
}

function countRoles(items, profile) {
  const counts = {};
  for (const item of items) {
    const role = classifyWordPressPath(item?.path || item?.file || item, profile);
    counts[role] = (counts[role] || 0) + 1;
  }
  return counts;
}

function planWordPressRetrieval(files, profile = {}, query = '', limit = 6) {
  const candidates = Array.isArray(files) ? files : [];
  const requested = Math.max(1, Number(limit) || 6);
  if (!profile?.isWordPress) {
    return {
      files:candidates.slice(0, requested),
      scope:{ strategy:'project-ranked', content_limit:requested, search_before_read:true, broad_index_allowed:true, expanded_to:[] }
    };
  }

  const cap = Math.min(6, requested);
  const flags = queryFlags(query);
  const buckets = {
    'child-theme':[], 'custom-plugin':[], 'wp-content-other':[], 'parent-theme':[],
    'woocommerce-core':[], 'wordpress-core':[], 'project-root':[], uploads:[], noise:[]
  };
  for (const item of candidates) {
    const role = classifyWordPressPath(item?.path || item?.file || item, profile);
    (buckets[role] || buckets['project-root']).push(item);
  }

  const selected = [];
  const expandedTo = [];
  const add = (items, role) => {
    for (const item of items) {
      if (selected.length >= cap) break;
      if (selected.some(existing => norm(existing?.path || existing?.file || existing) === norm(item?.path || item?.file || item))) continue;
      selected.push({ ...item, retrieval_role:role });
    }
  };

  // Brain ranking is already relevance evidence. Prefer project-owned wp-content code only.
  add(buckets['child-theme'], 'child-theme');
  add(buckets['custom-plugin'], 'custom-plugin');
  add(buckets['wp-content-other'], 'wp-content-other');

  // Explicit source/API verification may widen one reference tier. Never widen merely to fill the quota.
  if (flags.bricksParent) { add(buckets['parent-theme'], 'parent-theme-reference'); if (buckets['parent-theme'].length) expandedTo.push('parent-theme'); }
  if (flags.wooCore) { add(buckets['woocommerce-core'], 'woocommerce-core-reference'); if (buckets['woocommerce-core'].length) expandedTo.push('woocommerce-core'); }
  if (flags.wordpressCore) { add(buckets['wordpress-core'], 'wordpress-core-reference'); if (buckets['wordpress-core'].length) expandedTo.push('wordpress-core'); }
  if (flags.outsideWpContent) { add(buckets['project-root'], 'project-root-reference'); if (buckets['project-root'].length) expandedTo.push('project-root'); }

  // If scoped project-owned code yielded nothing, allow one ranked reference tier as evidence-driven fallback,
  // but never auto-open WordPress core, uploads, vendor/cache, or arbitrary root files.
  if (!selected.length) {
    const fallback = candidates.find(item => {
      const role = classifyWordPressPath(item?.path || item?.file || item, profile);
      return role === 'parent-theme' || role === 'woocommerce-core';
    });
    if (fallback) {
      const role = classifyWordPressPath(fallback?.path || fallback?.file || fallback, profile);
      selected.push({ ...fallback, retrieval_role:`${role}-fallback` });
      expandedTo.push(`${role}:no-scoped-candidate`);
    }
  }

  const roots = [
    ...(profile.childThemes || []).map(item => item.root).filter(Boolean),
    ...(profile.customPlugins || []).map(item => item.root).filter(Boolean)
  ];

  return {
    files:selected,
    scope:{
      strategy:'wordpress-scope-first',
      content_limit:cap,
      search_before_read:true,
      broad_index_allowed:true,
      primary_roots:roots,
      expanded_to:[...new Set(expandedTo)],
      candidate_roles:countRoles(candidates, profile),
      selected_roles:countRoles(selected, profile),
      omitted_count:Math.max(0, candidates.length - selected.length),
      rule:'Index broadly; fetch narrowly. Do not pad context with WordPress/Bricks/Woo core files.'
    }
  };
}

module.exports = { norm, queryFlags, classifyWordPressPath, planWordPressRetrieval };
