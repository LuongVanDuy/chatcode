const path = require('path');

function norm(value) { return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''); }
function lineOf(text, index) { let line = 1; for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++; return line; }
function unique(items, key = value => JSON.stringify(value)) { const seen = new Set(); return items.filter(item => { const k = key(item); if (seen.has(k)) return false; seen.add(k); return true; }); }
function quotedStrings(value) { const out = []; const re = /(['"])(.*?)\1/g; let m; while ((m = re.exec(String(value || '')))) out.push(m[2]); return out; }

function classRanges(text) {
  const ranges = []; const re = /\b(?:final\s+|abstract\s+)?class\s+([A-Za-z_][\w]*)[^\{]*\{/gi; let m;
  while ((m = re.exec(text))) {
    let depth = 1, i = re.lastIndex, quote = '';
    for (; i < text.length && depth; i++) {
      const ch = text[i], prev = text[i - 1];
      if (quote) { if (ch === quote && prev !== '\\') quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '{') depth++; else if (ch === '}') depth--;
    }
    ranges.push({ name:m[1], start:m.index, bodyStart:re.lastIndex, end:i }); if (ranges.length >= 120) break;
  }
  return ranges;
}

function analyzePhp(file, text) {
  const symbols = [], hooks = [], restRoutes = [], includes = [], assets = [], localize = [], selectors = [];
  const classes = classRanges(text), seenSymbols = new Set();
  const addSymbol = (name, kind, index, extra = {}) => { name = String(name || '').trim(); if (!name) return; const key = `${kind}:${name}:${lineOf(text,index)}:${extra.owner || ''}`; if (seenSymbols.has(key)) return; seenSymbols.add(key); symbols.push({ name, kind, line:lineOf(text,index), exported:false, ...extra }); };
  const addSynthetic = (name, kind, line, extra = {}) => { name = String(name || '').trim(); if (!name) return; const key = `${kind}:${name}:${line}:${extra.owner || ''}`; if (seenSymbols.has(key)) return; seenSymbols.add(key); symbols.push({ name, kind, line, exported:false, ...extra }); };

  let m;
  const classRe = /\b(?:final\s+|abstract\s+)?class\s+([A-Za-z_][\w]*)/gi; while ((m = classRe.exec(text))) addSymbol(m[1], 'class', m.index);
  const interfaceRe = /\binterface\s+([A-Za-z_][\w]*)/gi; while ((m = interfaceRe.exec(text))) addSymbol(m[1], 'interface', m.index);
  const traitRe = /\btrait\s+([A-Za-z_][\w]*)/gi; while ((m = traitRe.exec(text))) addSymbol(m[1], 'trait', m.index);
  const fnRe = /\bfunction\s+&?\s*([A-Za-z_][\w]*)\s*\(/gi;
  while ((m = fnRe.exec(text))) { const owner = classes.find(range => m.index > range.bodyStart && m.index < range.end); addSymbol(m[1], owner ? 'method' : 'function', m.index, owner ? { owner:owner.name } : {}); }

  const includeRe = /\b(require_once|require|include_once|include)\s*(?:\(|)\s*([^;]+);/gi;
  while ((m = includeRe.exec(text))) {
    const expr = m[2], strings = quotedStrings(expr); if (!strings.length) continue; const fragment = strings.find(value => /\.(php|inc)$/i.test(value)) || strings[strings.length - 1]; let base = 'source';
    if (/\bABSPATH\b/.test(expr)) base = 'root'; else if (/\bWP_CONTENT_DIR\b/.test(expr)) base = 'wp-content'; else if (/get_(?:stylesheet|template)_directory\s*\(/i.test(expr)) base = 'theme';
    includes.push({ kind:m[1].toLowerCase(), fragment, expression:expr.trim().slice(0,260), base, line:lineOf(text,m.index) });
  }

  const hookRe = /\b(add_action|add_filter)\s*\(\s*(['"])([^'"]+)\2\s*,\s*([^,\)]+)/gi;
  while ((m = hookRe.exec(text))) {
    const hook = m[3], callbackExpr = m[4].trim(), callbackStrings = quotedStrings(callbackExpr), callback = callbackStrings[callbackStrings.length - 1] || callbackExpr.replace(/[^A-Za-z0-9_:>$-]/g, '').slice(0,120);
    hooks.push({ type:m[1].toLowerCase(), hook, callback, line:lineOf(text,m.index), ajax:/^wp_ajax_(?:nopriv_)?/i.test(hook), woocommerce:/^(?:woocommerce|wc_)/i.test(hook) });
  }

  const restRe = /\bregister_rest_route\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3/gi;
  while ((m = restRe.exec(text))) restRoutes.push({ namespace:m[2], route:m[4], line:lineOf(text,m.index) });

  const enqueueRe = /\b(wp_enqueue_script|wp_enqueue_style)\s*\(([^;]+)\);?/gi;
  while ((m = enqueueRe.exec(text))) {
    const args = m[2], strings = quotedStrings(args), handle = strings[0] || '', asset = strings.find(value => /\.(?:js|css)(?:\?|$)/i.test(value)) || ''; let base = 'source';
    if (/get_(?:stylesheet|template)_directory_uri\s*\(/i.test(args)) base = 'theme';
    assets.push({ type:/script/i.test(m[1]) ? 'script' : 'style', handle, asset, base, line:lineOf(text,m.index) });
  }

  const localizeRe = /\bwp_localize_script\s*\(([^;]+)\);?/gi;
  while ((m = localizeRe.exec(text))) { const strings = quotedStrings(m[1]); localize.push({ handle:strings[0] || '', global:strings[1] || '', line:lineOf(text,m.index) }); }

  const selectorRe = /\b(class|id)\s*=\s*(['"])(.*?)\2/gi;
  while ((m = selectorRe.exec(text))) { const values = m[1].toLowerCase() === 'class' ? m[3].split(/\s+/) : [m[3]]; for (const value of values) if (/^[A-Za-z_][\w-]{1,80}$/.test(value)) selectors.push({ selector:`${m[1].toLowerCase() === 'class' ? '.' : '#'}${value}`, line:lineOf(text,m.index), kind:'markup' }); }

  for (const item of hooks) addSynthetic(item.hook, item.ajax ? 'wp-ajax-hook' : item.woocommerce ? 'woocommerce-hook' : 'wp-hook', item.line, { callback:item.callback, hook_type:item.type });
  for (const item of restRoutes) addSynthetic(`${item.namespace}${item.route}`, 'wp-rest-route', item.line, { namespace:item.namespace, route:item.route });
  for (const item of assets) if (item.handle) addSynthetic(item.handle, item.type === 'script' ? 'wp-script' : 'wp-style', item.line, { asset:item.asset });
  for (const item of localize) if (item.global) addSynthetic(item.global, 'wp-localized-global', item.line, { handle:item.handle });

  return { symbols, hooks:unique(hooks,x=>`${x.type}:${x.hook}:${x.callback}:${x.line}`), restRoutes, includes, assets, localize, selectors:unique(selectors,x=>x.selector) };
}

function analyzeJsSelectors(text) {
  const out = []; let m; const re = /(?:querySelector(?:All)?|matches|closest|\$)\s*\(\s*(['"])([^'"]+)\1/g;
  while ((m = re.exec(text))) { const parts = m[2].match(/(?:\.[A-Za-z_][\w-]*|#[A-Za-z_][\w-]*)/g) || []; for (const selector of parts) out.push({ selector, line:lineOf(text,m.index), kind:'js' }); }
  const idRe = /getElementById\s*\(\s*(['"])([^'"]+)\1/g; while ((m = idRe.exec(text))) out.push({ selector:`#${m[2]}`, line:lineOf(text,m.index), kind:'js' });
  return unique(out, x => `${x.selector}:${x.line}`);
}

function analyzeCssSelectors(text) {
  const out = []; let m; const re = /(^|\}|,)\s*([^@\{\}]{1,260})\{/gm;
  while ((m = re.exec(text))) { const parts = m[2].match(/(?:\.[A-Za-z_][\w-]*|#[A-Za-z_][\w-]*)/g) || []; for (const selector of parts.slice(0,20)) out.push({ selector, line:lineOf(text,m.index), kind:'css' }); if (out.length > 1200) break; }
  return unique(out, x => `${x.selector}:${x.line}`);
}

function detectWordPressProfile(files, texts) {
  const normalized = files.map(norm), lower = normalized.map(x => x.toLowerCase()); const has = part => lower.some(x => x === part || x.startsWith(`${part}/`) || x.endsWith(`/${part}`)); const isWordPress = has('wp-content') || has('wp-includes') || has('wp-admin') || lower.includes('wp-config.php') || lower.includes('wp-settings.php');
  if (!isWordPress) return { isWordPress:false, frameworks:[], childThemes:[], customPlugins:[], parentThemes:[], bricksVersion:'' };
  const childThemes = [], parentThemes = [], customPlugins = [];
  for (const file of normalized) {
    const theme = file.match(/^wp-content\/themes\/([^/]+)\/style\.css$/i);
    if (theme) {
      const source = String(texts.get(file) || '');
      const template = source.match(/^\s*Template\s*:\s*([^\r\n]+)/mi)?.[1]?.trim() || '';
      const name = source.match(/^\s*Theme Name\s*:\s*([^\r\n]+)/mi)?.[1]?.trim() || theme[1];
      const version = source.match(/^\s*Version\s*:\s*([^\r\n]+)/mi)?.[1]?.trim() || '';
      const item = { slug:theme[1], name, template, version, root:`wp-content/themes/${theme[1]}` };
      if (template) childThemes.push(item); else parentThemes.push(item);
    }
    const plugin = file.match(/^wp-content\/plugins\/([^/]+)\/([^/]+\.php)$/i);
    if (plugin && plugin[1].toLowerCase() !== 'woocommerce' && !customPlugins.some(x => x.slug === plugin[1])) {
      const source = String(texts.get(file) || '');
      const name = source.match(/^\s*Plugin Name\s*:\s*([^\r\n]+)/mi)?.[1]?.trim() || plugin[1];
      const version = source.match(/^\s*Version\s*:\s*([^\r\n]+)/mi)?.[1]?.trim() || '';
      customPlugins.push({ slug:plugin[1], name, version, root:`wp-content/plugins/${plugin[1]}` });
    }
  }
  const joined = [...texts.values()].join('\n').slice(0,4*1024*1024); const woocommerce = lower.some(x => x.startsWith('wp-content/plugins/woocommerce/')) || /woocommerce_|\bWC_[A-Za-z_]/.test(joined); const flatsomeChild = childThemes.find(theme => /flatsome/i.test(theme.template) || /flatsome/i.test(theme.slug) || /flatsome/i.test(theme.name));
  const bricksMeta = [...parentThemes, ...childThemes, ...customPlugins].find(item => item.version && /\bbricks\b/i.test(`${item.slug || ''} ${item.name || ''} ${item.template || ''}`));
  const bricksVersion = bricksMeta?.version || '';
  const frameworks = [{ name:'WordPress', evidence:'Cấu trúc WordPress' }]; if (woocommerce) frameworks.push({ name:'WooCommerce', evidence:'WooCommerce plugin/hooks' });
  for (const theme of childThemes.slice(0,6)) frameworks.push({ name:/child/i.test(theme.name) ? theme.name : `${theme.name || theme.slug} Child Theme`, evidence:`${theme.root}/style.css${theme.template ? ` · Template: ${theme.template}` : ''}` });
  if (bricksVersion) frameworks.push({ name:'Bricks Builder', version:bricksVersion, evidence:`local theme/plugin metadata · ${bricksVersion}` });
  if (flatsomeChild && !frameworks.some(x => /Flatsome Child Theme/i.test(x.name))) frameworks.push({ name:'Flatsome Child Theme', evidence:flatsomeChild.root });
  return { isWordPress, woocommerce, flatsomeChild:flatsomeChild || null, childThemes, parentThemes, customPlugins, bricksVersion, frameworks };
}

function pathRole(file, profile) {
  const p = norm(file), lower = p.toLowerCase(); if (!profile?.isWordPress) return 'project';
  if (/^wp-content\/themes\/[^/]+\//i.test(p)) { const child = profile.childThemes.find(theme => lower.startsWith(`${theme.root.toLowerCase()}/`)); return child ? 'child-theme' : 'parent-theme'; }
  if (/^wp-content\/plugins\/woocommerce\//i.test(p)) return 'woocommerce-core'; if (/^wp-content\/plugins\//i.test(p)) return 'custom-plugin'; if (/^(wp-admin|wp-includes)\//i.test(p) || /^(wp-settings|wp-load|wp-blog-header)\.php$/i.test(p)) return 'wordpress-core'; if (/(^|\/)vendor\//i.test(p)) return 'vendor'; return 'project';
}

function wordpressPriority(file, profile) {
  if (!profile?.isWordPress) return 0; const p = norm(file), lower = p.toLowerCase(), role = pathRole(p, profile); let score = 0;
  if (role === 'child-theme') score += 160; else if (role === 'custom-plugin') score += 145; else if (role === 'project') score += 45; else if (role === 'woocommerce-core') score -= 20; else if (role === 'parent-theme') score -= 35; else if (role === 'wordpress-core') score -= 65; else if (role === 'vendor') score -= 100;
  if (/\/functions\.php$/i.test(p)) score += 140; if (/\/includes\/(?:init|bootstrap|loader)\.php$/i.test(p)) score += 130; if (/\/includes\//i.test(p)) score += 45; if (/\.(?:min\.js|min\.css)$/i.test(lower)) score -= 90; if (/(^|\/)(readme|changelog)(\.|$)/i.test(lower)) score -= 80; return score;
}

function contextBoost(file, query, profile) {
  if (!profile?.isWordPress) return 0; const p = norm(file), lower = p.toLowerCase(), q = String(query || '').toLowerCase(), role = pathRole(p, profile); let score = wordpressPriority(p, profile); const bootstrap = /bootstrap|request flow|khởi tạo|khoi tao|initiali[sz]|startup|entrypoint/.test(q);
  if (bootstrap) {
    const exact = { 'index.php':320, 'wp-blog-header.php':300, 'wp-load.php':280, 'wp-settings.php':260 }; score += exact[lower] || 0;
    if (/\/functions\.php$/i.test(p)) score += 190; if (/\/includes\/(?:init|bootstrap|loader)\.php$/i.test(p)) score += 180;
    if (/\.(?:js|css|scss)$/i.test(p) && !/bootstrap/i.test(lower)) score -= 90;
  }
  if (/checkout|address|địa chỉ|dia chi|billing|shipping/.test(q)) { if (/wp-content\/themes\/.*\/(woocommerce|includes)\//i.test(p)) score += 160; if (/\/functions\.php$/i.test(p)) score += 120; if (/checkout|address|billing|shipping/i.test(lower)) score += 120; if (/wp-content\/plugins\/woocommerce\//i.test(p)) score += 10; }

  const styleIntent = /\bcss\b|stylesheet|style|font|typography|spacing|padding|margin|responsive|layout|khoảng\s+cách|màu|mau/i.test(q);
  if (styleIntent) {
    const isStyleAsset = /\.(?:css|scss|sass|less)$/i.test(lower);
    if (role === 'child-theme' && isStyleAsset) score += 220;
    if (/product\s+card|card\s+sản\s*phẩm|card\s+san\s*pham|product\s+item/i.test(q) && /product[-_.]?(?:card|item)|(?:card|item)[-_.]?product/i.test(lower)) score += 240;
    if (/single\s+product|chi\s+tiết\s+sản\s*phẩm|chi\s+tiet\s+san\s*pham/i.test(q) && /single[-_.]?product|product[-_.]?single/i.test(lower)) score += 260;
    if (/\/functions\.php$/i.test(p) && !/enqueue|register|handle|functions\.php|bootstrap/i.test(q)) score -= 150;
    if (role === 'custom-plugin' && !/plugin|extension|module/i.test(q)) score -= 80;
  }

  const bricksIntent = /\bbricks\b|bricks[-\s]?child|custom\s+(?:bricks\s+)?elements?|builder\s+setup|home(?:page)?\s+(?:setup|element|builder)|(?:setup|elements?)[^\n]{0,40}home(?:page)?/i.test(q);
  if (bricksIntent) {
    const pluginMentioned = (profile.customPlugins || []).some(plugin => {
      const values = [plugin?.slug, plugin?.name].filter(Boolean).map(value => String(value).toLowerCase());
      return values.some(value => value.length >= 3 && q.includes(value));
    });
    if (role === 'child-theme') score += 260;
    if (role === 'child-theme' && /\/functions\.php$/i.test(p)) score += 220;
    if (role === 'child-theme' && /\/inc\/(?:setup|templates?)\//i.test(p)) score += 210;
    if (role === 'child-theme' && /\/elements?\//i.test(p)) score += 240;
    if (role === 'child-theme' && /\/assets\/(?:css|js)\//i.test(p)) score += 90;
    if (/home|homepage|front-page/i.test(q) && /(?:^|\/)(?:home|homepage|front-page)(?:[\/._-]|$)/i.test(lower)) score += 220;
    if (role === 'custom-plugin' && !pluginMentioned) score -= 260;
  }
  return score;
}

function resolveFragment(source, fragment, base, fileSet, profile) {
  source = norm(source); fragment = String(fragment || '').replace(/[?#].*$/,''); if (!fragment) return ''; const sourceDir = path.posix.dirname(source), clean = fragment.replace(/^\/+/,''), candidates = [];
  if (base === 'root') candidates.push(clean); else if (base === 'wp-content') candidates.push(path.posix.join('wp-content',clean)); else if (base === 'theme') candidates.push(path.posix.join(sourceDir,clean)); else candidates.push(path.posix.normalize(path.posix.join(sourceDir,fragment)));
  if (profile?.childThemes?.length && base === 'theme') for (const theme of profile.childThemes) candidates.push(path.posix.join(theme.root,clean)); for (const candidate of candidates.map(norm)) if (fileSet.has(candidate)) return candidate; return '';
}

function buildWordPressRelations(analyses, fileSet, profile) {
  const relations = [], enqueueByHandle = new Map(), selectorFiles = new Map(); const add = (from,to,type,meta={}) => { if (!from || !to || from === to) return; relations.push({ from,to,type,...meta }); };
  for (const analysis of analyses) {
    for (const include of analysis.wordpress?.includes || []) { const target = resolveFragment(analysis.path,include.fragment,include.base,fileSet,profile); if (target) add(analysis.path,target,'php-include',{ line:include.line, kind:include.kind }); }
    for (const asset of analysis.wordpress?.assets || []) { if (!asset.asset) continue; const target = resolveFragment(analysis.path,asset.asset,asset.base,fileSet,profile); if (target) { add(analysis.path,target,asset.type === 'script' ? 'wp-enqueue-script' : 'wp-enqueue-style',{ handle:asset.handle,line:asset.line }); if (asset.handle) enqueueByHandle.set(asset.handle,target); } }
    for (const item of analysis.selectors || []) { if (!selectorFiles.has(item.selector)) selectorFiles.set(item.selector,[]); selectorFiles.get(item.selector).push({ path:analysis.path,language:analysis.language,line:item.line,kind:item.kind }); }
  }
  for (const analysis of analyses) for (const item of analysis.wordpress?.localize || []) { const target = enqueueByHandle.get(item.handle); if (target) add(analysis.path,target,'wp-localize-script',{ handle:item.handle,global:item.global,line:item.line }); }
  for (const [selector,refs] of selectorFiles) { const markup = refs.filter(x=>x.kind==='markup'), js = refs.filter(x=>x.kind==='js'), css = refs.filter(x=>x.kind==='css'); for (const source of markup) for (const target of js.slice(0,12)) add(source.path,target.path,'selector-js',{ selector }); for (const source of markup) for (const target of css.slice(0,12)) add(source.path,target.path,'selector-css',{ selector }); }
  return unique(relations,x=>`${x.from}:${x.to}:${x.type}:${x.selector || x.handle || ''}`);
}

function wordpressSummary(profile) { if (!profile?.isWordPress) return null; return { is_wordpress:true, woocommerce:!!profile.woocommerce, bricks_version:profile.bricksVersion || '', child_themes:profile.childThemes, parent_themes:profile.parentThemes, custom_plugins:profile.customPlugins, flatsome_child_theme:profile.flatsomeChild || null }; }

module.exports = { analyzePhp, analyzeJsSelectors, analyzeCssSelectors, detectWordPressProfile, wordpressPriority, contextBoost, pathRole, resolveFragment, buildWordPressRelations, wordpressSummary };