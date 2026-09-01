const OWNER_STATUS = Object.freeze({
  CONFIRMED:'confirmed',
  DETECTED:'detected',
  CANDIDATE:'candidate',
  UNKNOWN:'unknown'
});

function norm(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function text(value) { return String(value || '').trim().toLowerCase(); }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }

function requestFlags(request = '') {
  const q = text(request);
  return {
    globalStyle:/toàn\s+(?:site|trang|website)|global|site[-\s]?wide|entire\s+site|font\s+toàn/i.test(q),
    homepage:/homepage|home\s*page|trang\s+chủ|trang\s+chu|front[-\s]?page/i.test(q),
    header:/\bheader\b|đầu\s+trang|dau\s+trang/i.test(q),
    footer:/\bfooter\b|chân\s+trang|chan\s+trang/i.test(q),
    archive:/\barchive\b|taxonomy|danh\s+mục|danh\s+muc/i.test(q),
    single:/single(?:\s+product|\s+post)?|chi\s+tiết|chi\s+tiet/i.test(q),
    product:/product|sản\s*phẩm|san\s*pham/i.test(q),
    productCard:/product\s+card|card\s+sản\s*phẩm|card\s+san\s*pham|thẻ\s+sản\s*phẩm|the\s+san\s*pham|product\s+item/i.test(q),
    style:/\bcss\b|style|font|typography|spacing|padding|margin|width|container|responsive|layout|màu|mau/i.test(q),
    template:/\btemplate\b|bricks\s+template/i.test(q),
    builder:/bricks|builder|controls?|set_controls|repeater|custom\s+element|element/i.test(q),
    data:/\bcpt\b|custom\s+post\s+type|post[-\s]?type|database|\bdb\b|seed|migration|import|data|dữ\s+liệu|du\s+lieu/i.test(q),
    production:/ftp|sftp|deploy|production|hosting|live\s+(?:site|website|frontend)|server/i.test(q)
  };
}

function fileRows(inspect = {}) {
  return (inspect?.relevant_files || []).map((item,index) => ({
    item,
    index,
    path:norm(item?.path || item?.file || ''),
    lower:norm(item?.path || item?.file || '').toLowerCase(),
    symbols:Array.isArray(item?.symbols) ? item.symbols : []
  })).filter(row => row.path);
}

function symbols(inspect = {}) {
  const out = [];
  for (const row of fileRows(inspect)) {
    for (const symbol of row.symbols) out.push({ ...symbol, path:row.path });
  }
  for (const symbol of inspect?.top_symbols || []) {
    const ownerPath = norm(symbol?.path || symbol?.file || '');
    if (!symbol?.name || !ownerPath) continue;
    if (!out.some(item => item.name === symbol.name && item.path === ownerPath)) out.push({ ...symbol, path:ownerPath });
  }
  return out;
}

function evidenceEntry(kind, { path:ownerPath = '', symbol = '', status = OWNER_STATUS.DETECTED, confidence = 0.8, basis = [], source = 'inspection' } = {}) {
  const p = norm(ownerPath);
  if (!p && !symbol) return null;
  return {
    kind,
    status,
    path:p || null,
    symbol:symbol || null,
    confidence:Math.max(0, Math.min(1, Number(confidence) || 0)),
    source,
    evidence:unique(basis).slice(0,4)
  };
}

function exactFile(rows, ownerPath) {
  const p = norm(ownerPath).toLowerCase();
  return p ? rows.find(row => row.lower === p) || null : null;
}

function uniquePathMatch(rows, predicate) {
  const matches = rows.filter(row => predicate(row.lower, row));
  return matches.length === 1 ? matches[0] : null;
}

function firstPathMatch(rows, predicates = []) {
  for (const predicate of predicates) {
    const uniqueMatch = uniquePathMatch(rows, predicate);
    if (uniqueMatch) return uniqueMatch;
    const match = rows.find(row => predicate(row.lower, row));
    if (match) return match;
  }
  return null;
}

function findSymbolOwner(inspect, name) {
  const wanted = text(name);
  if (!wanted) return null;
  const matches = symbols(inspect).filter(item => text(item?.name) === wanted && item.path);
  if (matches.length === 1) return matches[0];
  return matches[0] || null;
}

function requestTokens(request) {
  const stop = new Set(['the','and','for','with','this','that','from','into','trong','cho','của','cua','với','voi','một','mot','phần','phan','sửa','sua','chỉnh','chinh','thêm','them','tạo','tao']);
  return unique(text(request).split(/[^a-z0-9À-ỹ_-]+/i).filter(token => token.length >= 3 && !stop.has(token))).slice(0,16);
}

function explicitUserPaths(request = '') {
  const source = String(request || '').replace(/`([^`]+)`/g, ' $1 ');
  const matches = source.match(/(?:[A-Za-z]:[\\/])?(?:[A-Za-z0-9_.@-]+[\\/])+[A-Za-z0-9_.@-]+\.[A-Za-z0-9]{1,12}/g) || [];
  return unique(matches.map(value => norm(value).replace(/[),.;:]+$/g, ''))).slice(0,8);
}

function componentOwner(rows, request) {
  const tokens = requestTokens(request).filter(token => !['bricks','builder','controls','control','section','template','product','products','sản','phẩm','san','pham'].includes(token));
  if (!tokens.length) return null;
  const ranked = rows.map(row => {
    let score = 0;
    for (const token of tokens) {
      if (row.lower.includes(token)) score += 5;
      for (const symbol of row.symbols) if (text(symbol?.name).includes(token)) score += 7;
    }
    if (/\/elements?\//.test(row.lower)) score += 3;
    return { row, score };
  }).filter(item => item.score > 0).sort((a,b) => b.score - a.score || a.row.index - b.row.index);
  return ranked[0]?.row || null;
}

function allowedKindsForTask(flags, primaryKind = '', taskType = '') {
  if (taskType === 'PRODUCTION') return ['deployment'];
  if (taskType === 'DATA') return ['data_model'];
  if (taskType === 'BRICKS_BUILDER') {
    if (flags.header && flags.footer && flags.template) return ['header_template','footer_template'];
    if (flags.header && flags.template) return ['header_template'];
    if (flags.footer && flags.template) return ['footer_template'];
    if (flags.archive && flags.single && flags.template) return ['archive_template','single_template'];
    if (flags.archive && flags.template) return ['archive_template'];
    if (flags.single && flags.template) return ['single_template'];
    return ['builder_component'];
  }
  if (taskType === 'FAST_UI') {
    if (flags.header && flags.style) return ['header_css','global_css'];
    if (flags.footer && flags.style) return ['footer_css','global_css'];
    if (flags.homepage && flags.style) return ['homepage_css','global_css'];
    if (flags.productCard && flags.style) return ['product_css','product_renderer'];
    if (flags.productCard) return ['product_renderer','product_css'];
    if (flags.globalStyle && flags.style) return ['global_css'];
    if (flags.product) return ['product_renderer','product_css'];
    if (flags.style) return ['global_css'];
    return primaryKind ? [primaryKind] : [];
  }
  if (flags.production) return ['deployment'];
  if (flags.data) return ['data_model'];
  if (flags.header && flags.footer && flags.template) return ['header_template','footer_template'];
  if (flags.header && flags.template) return ['header_template'];
  if (flags.footer && flags.template) return ['footer_template'];
  if (flags.archive && flags.single && flags.template) return ['archive_template','single_template'];
  if (flags.archive && flags.template) return ['archive_template'];
  if (flags.single && flags.template) return ['single_template'];
  if (flags.header && flags.style) return ['header_css','global_css'];
  if (flags.footer && flags.style) return ['footer_css','global_css'];
  if (flags.homepage && flags.style) return ['homepage_css','global_css'];
  if (flags.productCard && flags.style) return ['product_css','product_renderer'];
  if (flags.productCard) return ['product_renderer','product_css'];
  if (flags.builder) return ['builder_component'];
  if (flags.globalStyle && flags.style) return ['global_css'];
  if (flags.product) return ['product_renderer','product_css'];
  if (flags.style) return ['global_css'];
  return primaryKind ? [primaryKind] : [];
}

function ownershipMap({ request = '', inspect = {}, projectProfile = {}, fallbackCandidates = [], taskType = '' } = {}) {
  const flags = requestFlags(request), rows = fileRows(inspect), facts = projectProfile?.facts || {};
  const isDataTask = taskType === 'DATA';
  const isProductionTask = taskType === 'PRODUCTION';
  const isBuilderTask = taskType === 'BRICKS_BUILDER';
  const map = [];
  const add = entry => {
    if (!entry) return;
    const key = `${entry.kind}:${entry.path || ''}:${entry.symbol || ''}`;
    if (map.some(item => `${item.kind}:${item.path || ''}:${item.symbol || ''}` === key)) return;
    map.push(entry);
  };

  for (const explicitPath of explicitUserPaths(request)) {
    add(evidenceEntry('explicit_path', {
      path:explicitPath,
      status:OWNER_STATUS.CONFIRMED,
      confidence:1,
      source:'user-explicit-path',
      basis:['exact file path supplied by the user; no unrelated existing owner is required']
    }));
  }

  if (facts.global_css_owner) {
    const current = exactFile(rows, facts.global_css_owner);
    add(evidenceEntry('global_css', {
      path:facts.global_css_owner,
      status:current ? OWNER_STATUS.CONFIRMED : OWNER_STATUS.DETECTED,
      confidence:current ? 1 : 0.88,
      source:'project_profile.fact',
      basis:[current ? 'profile owner matches current source path' : 'profile owner from prior detected source']
    }));
  } else {
    const globalCss = firstPathMatch(rows, [
      lower => /(?:^|\/)assets\/css\/main\.css$/.test(lower),
      lower => /(?:^|\/)(?:main|global|base)\.css$/.test(lower)
    ]);
    if (globalCss) add(evidenceEntry('global_css', { path:globalCss.path, confidence:0.9, basis:['strong global CSS path convention'] }));
  }

  if (facts.shared_product_renderer) {
    const owner = findSymbolOwner(inspect, facts.shared_product_renderer);
    add(evidenceEntry('product_renderer', {
      path:owner?.path || '', symbol:facts.shared_product_renderer,
      status:owner ? OWNER_STATUS.CONFIRMED : OWNER_STATUS.DETECTED,
      confidence:owner ? 1 : 0.86,
      source:'project_profile.fact',
      basis:[owner ? 'profile renderer symbol matches current source symbol' : 'profile renderer symbol from prior detected source']
    }));
  }

  const homeCss = firstPathMatch(rows, [
    lower => /(?:^|\/)(?:home|homepage|front-page)\.(?:css|scss|sass|less)$/.test(lower),
    lower => /\/css\/(?:home|homepage|front-page)[-_.]/.test(lower)
  ]);
  if (homeCss) add(evidenceEntry('homepage_css', { path:homeCss.path, confidence:0.96, basis:['page-specific CSS path matches homepage target'] }));

  const headerCss = firstPathMatch(rows, [
    lower => /(?:^|\/)(?:header|header-footer)\.(?:css|scss|sass|less)$/.test(lower),
    lower => /\/css\/[^/]*header[^/]*\.(?:css|scss|sass|less)$/.test(lower)
  ]);
  if (headerCss) add(evidenceEntry('header_css', { path:headerCss.path, confidence:0.94, basis:['header-specific CSS owner path'] }));
  const footerCss = firstPathMatch(rows, [
    lower => /(?:^|\/)(?:footer|header-footer)\.(?:css|scss|sass|less)$/.test(lower),
    lower => /\/css\/[^/]*footer[^/]*\.(?:css|scss|sass|less)$/.test(lower)
  ]);
  if (footerCss) add(evidenceEntry('footer_css', { path:footerCss.path, confidence:0.94, basis:['footer-specific CSS owner path'] }));

  const headerTemplate = firstPathMatch(rows, [
    lower => /(?:^|\/)inc\/templates\/header\.php$/.test(lower),
    lower => /(?:^|\/)templates?\/header\.php$/.test(lower),
    lower => /(?:^|\/)header\.php$/.test(lower)
  ]);
  if (headerTemplate) add(evidenceEntry('header_template', { path:headerTemplate.path, confidence:0.96, basis:['header template path'] }));
  const footerTemplate = firstPathMatch(rows, [
    lower => /(?:^|\/)inc\/templates\/footer\.php$/.test(lower),
    lower => /(?:^|\/)templates?\/footer\.php$/.test(lower),
    lower => /(?:^|\/)footer\.php$/.test(lower)
  ]);
  if (footerTemplate) add(evidenceEntry('footer_template', { path:footerTemplate.path, confidence:0.96, basis:['footer template path'] }));

  const archiveTemplate = firstPathMatch(rows, [
    lower => /(?:^|\/)(?:archive|taxonomy)(?:-[^/]+)?\.php$/.test(lower),
    lower => /\/templates?\/[^/]*(?:archive|taxonomy)[^/]*\.php$/.test(lower)
  ]);
  if (archiveTemplate) add(evidenceEntry('archive_template', { path:archiveTemplate.path, confidence:0.9, basis:['archive/taxonomy template path'] }));
  const singleTemplate = firstPathMatch(rows, [
    lower => /(?:^|\/)single(?:-[^/]+)?\.php$/.test(lower),
    lower => /\/templates?\/[^/]*single[^/]*\.php$/.test(lower)
  ]);
  if (singleTemplate) add(evidenceEntry('single_template', { path:singleTemplate.path, confidence:0.9, basis:['single template path'] }));

  const productCss = firstPathMatch(rows, [
    lower => /\/css\/[^/]*(?:product|products|product-card|product-item)[^/]*\.(?:css|scss|sass|less)$/.test(lower),
    lower => /(?:^|\/)(?:products?|product-card|product-item)\.(?:css|scss|sass|less)$/.test(lower)
  ]);
  if (productCss) add(evidenceEntry('product_css', { path:productCss.path, confidence:0.88, basis:['product component CSS path'] }));

  if (flags.builder && (!taskType || isBuilderTask)) {
    const component = componentOwner(rows, request);
    if (component) add(evidenceEntry('builder_component', { path:component.path, confidence:0.84, basis:['request tokens match existing Builder/component source'] }));
  }

  if (isDataTask || (!taskType && flags.data)) {
    const dataOwner = firstPathMatch(rows, [
      lower => /(?:^|\/)(?:post-type|post_type|cpt)(?:[-_.][^/]*)?\.php$/.test(lower),
      lower => /\/(?:post-types?|cpt|content-types?)\//.test(lower),
      lower => /\/inc\/[^/]*(?:product|post)[^/]*\/(?:post-type|post_type|cpt)\.php$/.test(lower)
    ]);
    if (dataOwner) add(evidenceEntry('data_model', { path:dataOwner.path, confidence:0.92, basis:['CPT/data model owner path'] }));
  }

  if (isProductionTask || (!taskType && flags.production)) {
    const deployOwner = firstPathMatch(rows, [
      lower => /(?:^|\/)(?:deploy|deployment|ftp|sftp)[^/]*\.(?:js|cjs|mjs|ps1|sh|json|ya?ml)$/.test(lower),
      lower => /(?:^|\/)\.vscode\/sftp\.json$/.test(lower)
    ]);
    if (deployOwner) add(evidenceEntry('deployment', { path:deployOwner.path, confidence:0.9, basis:['deployment configuration/source path'] }));
  }

  const choose = kinds => {
    for (const kind of kinds) {
      const entry = map.find(item => item.kind === kind && item.path);
      if (entry) return entry;
    }
    return null;
  };

  let primary = choose(['explicit_path']);
  if (!primary && isProductionTask) primary = choose(['deployment']);
  else if (!primary && isDataTask) primary = choose(['data_model']);
  else if (!primary && isBuilderTask) {
    if (flags.header && flags.template) primary = choose(['header_template']);
    else if (flags.footer && flags.template) primary = choose(['footer_template']);
    else if (flags.archive && flags.template) primary = choose(['archive_template']);
    else if (flags.single && flags.template) primary = choose(['single_template']);
    else primary = choose(['builder_component']);
  } else if (!primary && taskType === 'FAST_UI') {
    if (flags.header && flags.style) primary = choose(['header_css','global_css']);
    else if (flags.footer && flags.style) primary = choose(['footer_css','global_css']);
    else if (flags.homepage && flags.style) primary = choose(['homepage_css','global_css']);
    else if (flags.productCard && flags.style) primary = choose(['product_css','product_renderer']);
    else if (flags.productCard) primary = choose(['product_renderer','product_css']);
    else if (flags.globalStyle && flags.style) primary = choose(['global_css']);
    else if (flags.product) primary = choose(['product_renderer','product_css']);
    else if (flags.style) primary = choose(['global_css']);
  } else if (!primary) {
    if (flags.production) primary = choose(['deployment']);
    else if (flags.data) primary = choose(['data_model']);
    else if (flags.header && flags.template) primary = choose(['header_template']);
    else if (flags.footer && flags.template) primary = choose(['footer_template']);
    else if (flags.archive && flags.template) primary = choose(['archive_template']);
    else if (flags.single && flags.template) primary = choose(['single_template']);
    else if (flags.header && flags.style) primary = choose(['header_css','global_css']);
    else if (flags.footer && flags.style) primary = choose(['footer_css','global_css']);
    else if (flags.homepage && flags.style) primary = choose(['homepage_css','global_css']);
    else if (flags.productCard && flags.style) primary = choose(['product_css','product_renderer']);
    else if (flags.productCard) primary = choose(['product_renderer','product_css']);
    else if (flags.builder) primary = choose(['builder_component']);
    else if (flags.globalStyle && flags.style) primary = choose(['global_css']);
  }

  if (!primary && taskType !== 'DATA' && flags.product) primary = choose(['product_renderer','product_css']);
  if (!primary && taskType !== 'DATA' && flags.style && !flags.homepage && !flags.header && !flags.footer) primary = choose(['global_css']);

  if (!primary) {
    const fallback = (fallbackCandidates || []).find(item => item?.path);
    if (fallback) {
      primary = evidenceEntry('ranked_candidate', {
        path:fallback.path,
        status:OWNER_STATUS.CANDIDATE,
        confidence:0.55,
        source:'task_ranking',
        basis:['highest ranked existing task-context file']
      });
      add(primary);
    }
  }

  const allowedKinds = new Set(allowedKindsForTask(flags, primary?.kind || '', taskType));
  if (primary) allowedKinds.add(primary.kind);
  const scoped = map.filter(item => allowedKinds.has(item.kind)).sort((a,b) => {
    if (primary && a.kind === primary.kind && a.path === primary.path) return -1;
    if (primary && b.kind === primary.kind && b.path === primary.path) return 1;
    return b.confidence - a.confidence;
  }).slice(0,8);

  const companionPaths = unique(scoped.filter(item => item.path && (!primary || item.path !== primary.path)).map(item => item.path)).slice(0,3);
  const enforcePaths = unique(scoped
    .filter(item => item.path && [OWNER_STATUS.CONFIRMED, OWNER_STATUS.DETECTED].includes(item.status))
    .map(item => item.path)
  ).slice(0,4);

  return {
    version:4,
    primary,
    entries:scoped,
    companion_paths:companionPaths,
    enforce_paths:enforcePaths,
    owner_set_mode:primary?.kind === 'explicit_path' ? 'explicit-user-path' : enforcePaths.length ? 'any-evidence-backed-owner' : 'candidate-advisory',
    task_type:taskType || null,
    fallback_used:primary?.status === OWNER_STATUS.CANDIDATE,
    requires_owner_read:!!(primary?.path && primary?.kind !== 'explicit_path' && !exactFile(rows, primary.path))
  };
}

module.exports = {
  OWNER_STATUS,
  requestFlags,
  explicitUserPaths,
  allowedKindsForTask,
  ownershipMap
};