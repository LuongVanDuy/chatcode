const path = require('path');
const { hasBricksProjectEvidence } = require('./skill-runtime');

function themeHeader(source, key) {
  const match = String(source || '').match(new RegExp(`^\\s*\\*?\\s*${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*:\\s*([^\\r\\n]+)`, 'mi'));
  return String(match?.[1] || '').trim();
}

function addFramework(list, item) {
  const out = Array.isArray(list) ? [...list] : [];
  const name = String(item?.name || '');
  if (!out.some(entry => String(entry?.name || entry || '').toLowerCase() === name.toLowerCase())) out.push(item);
  return out;
}

function augmentThemeRootInspection(inspect, styleContent, projectRef = '') {
  const name = themeHeader(styleContent, 'Theme Name');
  const template = themeHeader(styleContent, 'Template');
  const version = themeHeader(styleContent, 'Version');
  const isBricksParent = /\bbricks\b/i.test(name) && !template;
  const isBricksChild = /\bbricks\b/i.test(template);
  if (!isBricksParent && !isBricksChild) return inspect;

  const project = inspect?.project || {};
  const slug = String(project?.name || projectRef || 'bricks-theme').trim();
  const theme = { slug, name:name || slug, template, version, root:'.' };
  const wp = { ...(inspect?.wordpress || {}), isWordPress:true };
  wp.childThemes = Array.isArray(wp.childThemes) ? [...wp.childThemes] : [];
  wp.parentThemes = Array.isArray(wp.parentThemes) ? [...wp.parentThemes] : [];

  if (isBricksChild && !wp.childThemes.some(item => String(item?.root || '') === '.')) wp.childThemes.unshift(theme);
  if (isBricksParent && !wp.parentThemes.some(item => /\bbricks\b/i.test(`${item?.slug || ''} ${item?.name || ''}`))) {
    wp.parentThemes.unshift({ ...theme, slug:'bricks', template:'' });
    wp.bricksVersion = version || wp.bricksVersion || '';
    wp.bricks_version = version || wp.bricks_version || '';
  }

  let frameworks = addFramework(inspect?.frameworks, { name:'WordPress', evidence:'Theme root style.css metadata' });
  frameworks = addFramework(frameworks, {
    name:'Bricks Builder',
    ...(isBricksParent && version ? { version } : {}),
    evidence:isBricksParent ? `Theme root is Bricks${version ? ` ${version}` : ''}` : 'Child theme style.css declares Template: bricks'
  });

  const relevant = Array.isArray(inspect?.relevant_files) ? [...inspect.relevant_files] : [];
  if (!relevant.some(item => String(item?.path || item?.file || '').replace(/\\/g,'/') === 'style.css')) {
    relevant.unshift({ path:'style.css', role:isBricksParent ? 'parent-theme' : 'child-theme', content:String(styleContent || '').slice(0,16000), reasons:['theme-root Bricks detection'] });
  }

  return {
    ...inspect,
    wordpress:wp,
    frameworks,
    framework_names:[...new Set([...(inspect?.framework_names || []), 'WordPress', 'Bricks Builder'])],
    relevant_files:relevant,
    bricks_detection:{ source:'theme-root-style-header', parent:isBricksParent, child:isBricksChild, template:template || null, version:isBricksParent ? version || null : null }
  };
}

function createBricksProjectDetectionApi(api) {
  if (!api || api.__bricksProjectDetectionWrapped || typeof api.inspectProject !== 'function') return api;
  api.__bricksProjectDetectionWrapped = true;
  const inspectProject = api.inspectProject.bind(api);
  const readFile = typeof api.readFile === 'function' ? api.readFile.bind(api) : null;

  api.inspectProject = async (ref, query, limit) => {
    const inspect = await inspectProject(ref, query, limit);
    if (hasBricksProjectEvidence(inspect).active || !readFile) return inspect;
    try {
      const style = await readFile(ref, 'style.css');
      return augmentThemeRootInspection(inspect, style?.content || '', ref);
    } catch {
      return inspect;
    }
  };
  return api;
}

function installBricksProjectDetectionPatches() {
  const safety = require('./safety-tools');
  if (safety.__bricksProjectDetectionPatched) return;
  safety.__bricksProjectDetectionPatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function bricksDetectionSafeToolApi(...args) {
    return createBricksProjectDetectionApi(previousCreate(...args));
  };
}

module.exports = {
  themeHeader,
  augmentThemeRootInspection,
  createBricksProjectDetectionApi,
  installBricksProjectDetectionPatches
};
