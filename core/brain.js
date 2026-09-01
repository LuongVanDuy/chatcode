const path = require('path');
const wp = require('./wordpress');
const { wordpressBootstrapFiles, planWordPressBrainContent } = require('./brain-scope');

const MAX_FILES = 1400;
const MAX_TOTAL_BYTES = 28 * 1024 * 1024;
const MAX_REFERENCES_PER_SYMBOL = 140;
const SOURCE_EXTS = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.vue','.svelte','.php','.py','.go','.rs','.java','.kt','.kts','.cs','.c','.h','.cpp','.hpp','.swift','.rb','.css','.scss','.sql','.sh','.ps1','.html','.htm']);
const MANIFEST_NAMES = new Set(['package.json','composer.json','pyproject.toml','requirements.txt','go.mod','cargo.toml','gemfile','pubspec.yaml','pom.xml','build.gradle','build.gradle.kts']);
const LOCAL_EXTS = ['.js','.jsx','.ts','.tsx','.mjs','.cjs','.vue','.svelte','.php','.inc','.py','.go','.rs','.java','.kt','.kts','.cs','.css','.scss','.json','.html'];

function norm(value) { return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''); }
function languageFor(file) {
  const ext = path.posix.extname(norm(file)).toLowerCase();
  return ({'.js':'JavaScript','.jsx':'JavaScript JSX','.ts':'TypeScript','.tsx':'TypeScript JSX','.mjs':'JavaScript','.cjs':'JavaScript','.vue':'Vue','.svelte':'Svelte','.php':'PHP','.inc':'PHP','.py':'Python','.go':'Go','.rs':'Rust','.java':'Java','.kt':'Kotlin','.kts':'Kotlin','.cs':'C#','.c':'C','.h':'C/C++ Header','.cpp':'C++','.hpp':'C++ Header','.swift':'Swift','.rb':'Ruby','.css':'CSS','.scss':'SCSS','.sql':'SQL','.sh':'Shell','.ps1':'PowerShell','.html':'HTML','.htm':'HTML'})[ext] || '';
}
function isManifest(file) { return MANIFEST_NAMES.has(path.posix.basename(norm(file)).toLowerCase()) || /\.(csproj|fsproj|vbproj)$/i.test(file); }
function preliminaryWordPress(files) { const lower = files.map(x => norm(x).toLowerCase()); return lower.some(x => x === 'wp-config.php' || x === 'wp-settings.php' || x.startsWith('wp-content/') || x.startsWith('wp-includes/')); }
function filePriority(file, isWp = false) {
  const p = norm(file), base = path.posix.basename(p).toLowerCase(), depth = p.split('/').length; let score = 100 - depth * 3;
  if (isManifest(p)) score += 200;
  if (/^(index|main|app|server|bootstrap|functions|routes|router)\.(js|jsx|ts|tsx|php|py|go|rs)$/i.test(base)) score += 100;
  if (/(^|\/)(src|app|lib|routes|controllers|components)\//i.test(p)) score += 25;
  if (isWp) {
    if (/^wp-content\/themes\/[^/]*(?:child|custom)[^/]*\//i.test(p)) score += 230;
    else if (/^wp-content\/themes\//i.test(p)) score += 70;
    if (/^wp-content\/plugins\//i.test(p) && !/^wp-content\/plugins\/woocommerce\//i.test(p)) score += 170;
    if (/\/functions\.php$/i.test(p)) score += 220;
    if (/\/includes\/(?:init|bootstrap|loader)\.php$/i.test(p)) score += 210;
    else if (/\/includes\//i.test(p)) score += 80;
    if (/^(wp-admin|wp-includes)\//i.test(p)) score -= 100;
    if (/^wp-content\/plugins\/woocommerce\//i.test(p)) score -= 35;
    if (/(^|\/)vendor\//i.test(p)) score -= 130;
    if (/\.min\.(?:js|css)$/i.test(p)) score -= 120;
    if (/(^|\/)(readme|changelog)(\.|$)/i.test(p)) score -= 100;
  }
  return score;
}
function lineOf(text, index) { let line = 1; for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++; return line; }
function cleanName(value) { return String(value || '').trim().replace(/^[#$]+/, '').slice(0, 160); }
function pushSymbol(out, seen, name, kind, line, exported = false, extra = {}) { name = cleanName(name); if (!name || name.length < 2) return; const key = `${kind}:${name}:${line}:${extra.owner || ''}`; if (seen.has(key)) return; seen.add(key); out.push({ name, kind, line, exported: !!exported, ...extra }); }

function analyzeSymbols(file, text) {
  const lang = languageFor(file), out = [], seen = new Set();
  if (lang === 'PHP') return wp.analyzePhp(file, text).symbols;
  const patterns = [];
  if (/JavaScript|TypeScript/.test(lang) || ['Vue','Svelte'].includes(lang)) patterns.push(
    [/\b(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,'function',2,1],
    [/\b(export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g,'class',2,1],
    [/\b(export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/g,'interface',2,1],
    [/\b(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g,'type',2,1],
    [/\b(export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/g,'enum',2,1],
    [/\b(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,'function',2,1]
  );
  else if (lang === 'Python') patterns.push([/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/gm,'function',1,0],[/^\s*class\s+([A-Za-z_][\w]*)\b/gm,'class',1,0]);
  else if (lang === 'Go') patterns.push([/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/gm,'function',1,0],[/^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/gm,'type',1,0]);
  else if (lang === 'Rust') patterns.push([/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*[<(]/gm,'function',1,0],[/^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)\b/gm,'struct',1,0],[/^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)\b/gm,'enum',1,0],[/^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)\b/gm,'trait',1,0]);
  else if (['Java','Kotlin','C#'].includes(lang)) patterns.push([/\b(?:class|interface|enum|record)\s+([A-Za-z_][\w]*)\b/g,'type',1,0],[/\b(?:public|private|protected|internal|static|virtual|override|suspend|async|final|open|abstract)\s+(?:[\w<>,?\[\].]+\s+)+([A-Za-z_][\w]*)\s*\(/g,'method',1,0]);
  else if (['C','C++','Swift','Ruby'].includes(lang)) patterns.push([/\b(?:class|struct|enum|protocol|module)\s+([A-Za-z_][\w]*)\b/g,'type',1,0],[/\b(?:def|func)\s+([A-Za-z_][\w!?=]*)\s*[(:]/g,'function',1,0]);
  for (const [re, kind, nameGroup, exportGroup] of patterns) { let m; while ((m = re.exec(text))) { pushSymbol(out, seen, m[nameGroup], kind, lineOf(text, m.index), exportGroup ? !!m[exportGroup] : false); if (out.length >= 500) break; } }
  return out;
}

function analyzeImports(file, text) {
  const lang = languageFor(file), items = [], seen = new Set();
  const add = (spec, kind = 'import') => { spec = String(spec || '').trim(); if (!spec || seen.has(`${kind}:${spec}`)) return; seen.add(`${kind}:${spec}`); items.push({ spec, kind }); };
  let m;
  if (/JavaScript|TypeScript/.test(lang) || ['Vue','Svelte'].includes(lang)) {
    const re = /(?:\bfrom\s*|\brequire\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]/g; while ((m = re.exec(text))) add(m[1]);
    const side = /\bimport\s*['"]([^'"]+)['"]/g; while ((m = side.exec(text))) add(m[1]);
  } else if (lang === 'PHP') {
    const data = wp.analyzePhp(file, text); for (const item of data.includes) add(item.fragment, item.kind);
    const use = /^\s*use\s+([^;]+);/gmi; while ((m = use.exec(text))) add(m[1].trim(), 'namespace');
  } else if (lang === 'Python') {
    const from = /^\s*from\s+([.\w]+)\s+import\s+/gm; while ((m = from.exec(text))) add(m[1]);
    const imp = /^\s*import\s+([\w.]+)/gm; while ((m = imp.exec(text))) add(m[1]);
  } else if (lang === 'Go') {
    const one = /\bimport\s+"([^"]+)"/g; while ((m = one.exec(text))) add(m[1]);
    const block = /\bimport\s*\(([\s\S]*?)\)/g; while ((m = block.exec(m[1]))) { const q = /"([^"]+)"/g; let x; while ((x = q.exec(m[1]))) add(x[1]); }
  } else if (lang === 'Rust') {
    const use = /^\s*use\s+([^;]+);/gm; while ((m = use.exec(text))) add(m[1].trim());
    const mod = /^\s*mod\s+([A-Za-z_][\w]*)\s*;/gm; while ((m = mod.exec(text))) add(`./${m[1]}`, 'module');
  } else if (['Java','Kotlin'].includes(lang)) {
    const re = /^\s*import\s+([\w.*]+)\s*;?/gm; while ((m = re.exec(text))) add(m[1]);
  } else if (lang === 'C#') {
    const re = /^\s*using\s+([\w.]+)\s*;/gm; while ((m = re.exec(text))) add(m[1]);
  } else if (['CSS','SCSS'].includes(lang)) {
    const re = /@(?:use|import)\s+(?:url\()?['"]([^'"]+)['"]/g; while ((m = re.exec(text))) add(m[1]);
  }
  return items.slice(0, 250);
}

function resolveImport(source, spec, fileSet) {
  source = norm(source); spec = String(spec || '').trim(); if (!spec) return '';
  let base = '';
  if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(source), spec));
  else if (spec.startsWith('/')) base = norm(spec);
  else return '';
  base = norm(base).replace(/\?.*$/, '').replace(/#.*$/, '');
  const candidates = [base];
  if (!path.posix.extname(base)) for (const ext of LOCAL_EXTS) candidates.push(base + ext);
  for (const ext of LOCAL_EXTS) candidates.push(path.posix.join(base, `index${ext}`));
  for (const candidate of candidates) if (fileSet.has(norm(candidate))) return norm(candidate);
  return '';
}

function packageInfo(text) { try { const p = JSON.parse(text || '{}'); return { deps: { ...(p.dependencies || {}), ...(p.devDependencies || {}) }, scripts: Object.keys(p.scripts || {}), name: p.name || '' }; } catch { return { deps: {}, scripts: [], name: '' }; } }
function detectFrameworks(files, texts, profile) {
  const fileSet = new Set(files.map(x => x.toLowerCase())), out = [], seen = new Set();
  const add = (name, evidence) => { if (seen.has(name)) return; seen.add(name); out.push({ name, evidence }); };
  for (const item of profile?.frameworks || []) add(item.name, item.evidence);
  const pkg = packageInfo(texts.get('package.json')); const deps = pkg.deps;
  if (deps.next) add('Next.js','package.json: next'); if (deps.nuxt) add('Nuxt','package.json: nuxt'); if (deps.react) add('React','package.json: react'); if (deps.vue) add('Vue','package.json: vue'); if (deps.svelte) add('Svelte','package.json: svelte'); if (deps.express) add('Express','package.json: express'); if (deps['@nestjs/core']) add('NestJS','package.json: @nestjs/core'); if (deps.vite) add('Vite','package.json: vite');
  const composer = (texts.get('composer.json') || '').toLowerCase(); if (composer.includes('laravel/framework') || fileSet.has('artisan')) add('Laravel','composer/artisan'); if (composer.includes('symfony/')) add('Symfony','composer.json');
  const req = `${texts.get('requirements.txt') || ''}\n${texts.get('pyproject.toml') || ''}`.toLowerCase(); if (fileSet.has('manage.py') || req.includes('django')) add('Django','manage.py / Python dependencies'); if (req.includes('fastapi')) add('FastAPI','Python dependencies'); if (req.includes('flask')) add('Flask','Python dependencies');
  if (fileSet.has('go.mod')) add('Go Modules','go.mod'); if (fileSet.has('cargo.toml')) add('Rust / Cargo','Cargo.toml'); if ([...fileSet].some(x => x.endsWith('.csproj'))) add('.NET','*.csproj'); if (fileSet.has('pom.xml') || fileSet.has('build.gradle') || fileSet.has('build.gradle.kts')) add('JVM','Maven/Gradle');
  return out;
}

function likelyEntrypoints(files, profile) {
  const set = new Set(files.map(norm)), out = [], push = value => { if (set.has(value) && !out.includes(value)) out.push(value); };
  if (profile?.isWordPress) {
    for (const item of ['index.php','wp-blog-header.php','wp-load.php','wp-settings.php']) push(item);
    for (const theme of profile.childThemes || []) { push(`${theme.root}/functions.php`); push(`${theme.root}/includes/init.php`); push(`${theme.root}/includes/bootstrap.php`); }
    for (const plugin of profile.customPlugins || []) {
      const prefix = `${plugin.root}/`; const candidates = files.filter(file => norm(file).startsWith(prefix) && path.posix.dirname(norm(file)) === plugin.root && /\.php$/i.test(file));
      for (const candidate of candidates.slice(0, 2)) push(norm(candidate));
    }
  }
  const preferred = ['package.json','composer.json','artisan','manage.py','main.go','go.mod','cargo.toml','src/index.ts','src/index.tsx','src/index.js','src/main.ts','src/main.js','src/app.ts','src/app.tsx','app.js','server.js','functions.php'];
  for (const item of preferred) push(item);
  for (const file of files) { if (out.length >= 24) break; const base = path.posix.basename(file); if (/^(index|main|app|server|bootstrap|routes)\.(js|jsx|ts|tsx|php|py|go|rs)$/i.test(base)) push(norm(file)); }
  return out.slice(0, 24);
}

function createBrainService(store, projects, { onChanged } = {}) {
  const cache = new Map(), builds = new Map(); const base = projects.toolApi;
  function emit(id) { try { onChanged?.(status(id)); } catch {} }
  function invalidate(ref) { let id = String(ref || ''); try { id = store.getProject(ref).id; } catch {} const current = cache.get(id); if (current) current.dirty = true; emit(id); }
  function cleanup(ref) { let id = String(ref || ''); try { id = store.getProject(ref).id; } catch {} cache.delete(id); builds.delete(id); }
  function shutdown() { cache.clear(); builds.clear(); }

  async function build(ref, force = false) {
    const project = store.getProject(ref); if (builds.has(project.id)) return builds.get(project.id);
    const job = (async () => {
      const started = Date.now(); const all = await base.listFiles(project.id, 5000); const indexStatus = projects.status(project.id); const isWpPre = preliminaryWordPress(all);
      const candidates = all.filter(file => SOURCE_EXTS.has(path.posix.extname(norm(file)).toLowerCase()) || isManifest(file)).sort((a, b) => filePriority(b, isWpPre) - filePriority(a, isWpPre));
      const profileTexts = new Map(), physicalReads = new Set(); let bootstrapBytes = 0, contentBytes = 0, readAttempts = 0;
      if (isWpPre) {
        for (const rel of wordpressBootstrapFiles(all)) {
          try {
            readAttempts++;
            const read = await base.readFile(project.id, rel), text = String(read.content || ''), key = norm(rel);
            physicalReads.add(key); profileTexts.set(key, text); bootstrapBytes += Buffer.byteLength(text, 'utf8');
          } catch {}
        }
      }
      let profile = wp.detectWordPressProfile(all, profileTexts);
      const scopePlan = isWpPre
        ? planWordPressBrainContent(candidates, profile, file => filePriority(file, true) + wp.wordpressPriority(file, profile))
        : { selected:candidates.slice(0, MAX_FILES), max_files:MAX_FILES, max_bytes:MAX_TOTAL_BYTES, scope:'project-wide', primary_roots:[], candidate_count:candidates.length, scoped_candidate_count:candidates.length, excluded_by_scope:0, truncated:candidates.length > MAX_FILES };
      const selected = scopePlan.selected, texts = new Map(profileTexts), analysisTexts = new Map(), analyses = [], languages = new Map(); let truncated = !!scopePlan.truncated;
      for (const rel of selected) {
        try {
          const key = norm(rel); let text = texts.get(key);
          if (text == null) {
            readAttempts++;
            const read = await base.readFile(project.id, rel); text = String(read.content || ''); physicalReads.add(key); texts.set(key, text);
          }
          const size = Buffer.byteLength(text, 'utf8'); if (contentBytes + size > scopePlan.max_bytes) { truncated = true; break; }
          contentBytes += size; analysisTexts.set(key, text); const lang = languageFor(rel); if (lang) languages.set(lang, (languages.get(lang) || 0) + 1);
          if (SOURCE_EXTS.has(path.posix.extname(key).toLowerCase())) {
            const wordpress = lang === 'PHP' ? wp.analyzePhp(rel, text) : null;
            const selectors = wordpress?.selectors || (/JavaScript|TypeScript/.test(lang) ? wp.analyzeJsSelectors(text) : ['CSS','SCSS'].includes(lang) ? wp.analyzeCssSelectors(text) : []);
            analyses.push({ path:key, language:lang, symbols:wordpress?.symbols || analyzeSymbols(rel, text), imports:analyzeImports(rel, text), wordpress, selectors });
          }
        } catch {}
      }

      profile = wp.detectWordPressProfile(all, texts); const fileSet = new Set(all.map(norm)), byPath = new Map(analyses.map(x => [x.path, x])), reverse = new Map(); let edges = 0, externalImports = 0;
      const addEdge = (from, to) => { const analysis = byPath.get(from); if (!analysis || !to || from === to) return; if (!analysis.localImports.includes(to)) { analysis.localImports.push(to); edges++; } if (!reverse.has(to)) reverse.set(to, new Set()); reverse.get(to).add(from); };
      for (const analysis of analyses) {
        analysis.localImports = []; analysis.externalImports = [];
        for (const item of analysis.imports) { const resolved = resolveImport(analysis.path, item.spec, fileSet); if (resolved) addEdge(analysis.path, resolved); else { analysis.externalImports.push(item.spec); externalImports++; } }
        analysis.externalImports = [...new Set(analysis.externalImports)].slice(0, 40);
      }
      const relations = wp.buildWordPressRelations(analyses, fileSet, profile); for (const relation of relations) addEdge(relation.from, relation.to);

      const symbols = [], defsByName = new Map();
      for (const analysis of analyses) for (const symbol of analysis.symbols) { const item = { ...symbol, path: analysis.path, language: analysis.language }; symbols.push(item); const key = symbol.name.toLowerCase(); if (!defsByName.has(key)) defsByName.set(key, []); defsByName.get(key).push(item); }
      const references = new Map(), symbolKeys = new Set(defsByName.keys()); let refCount = 0;
      for (const [file, text] of analysisTexts) {
        if (!SOURCE_EXTS.has(path.posix.extname(file).toLowerCase())) continue; const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) { const tokens = lines[i].match(/[A-Za-z_$][\w$]{1,80}/g) || []; const unique = new Set(tokens.map(x => x.toLowerCase()).filter(x => symbolKeys.has(x))); for (const key of unique) { if (refCount > 30000) break; const arr = references.get(key) || []; if (arr.length >= MAX_REFERENCES_PER_SYMBOL) continue; const definition = (defsByName.get(key) || []).some(d => d.path === file && d.line === i + 1); arr.push({ path: file, line: i + 1, snippet: lines[i].trim().slice(0, 260), definition }); references.set(key, arr); refCount++; } }
      }

      const hotspots = analyses.map(a => ({ path: a.path, language: a.language, role: wp.pathRole(a.path, profile), symbols: a.symbols.length, outgoing: a.localImports.length, incoming: reverse.get(a.path)?.size || 0, score: a.symbols.length + a.localImports.length * 2 + (reverse.get(a.path)?.size || 0) * 2 + wp.wordpressPriority(a.path, profile) })).sort((a, b) => b.score - a.score).slice(0, 40);
      const frameworks = detectFrameworks(all, texts, profile), languageList = [...languages.entries()].map(([name, files]) => ({ name, files })).sort((a, b) => b.files - a.files);
      const primaryLanguage = profile.isWordPress && languages.has('PHP') ? 'PHP' : (languageList[0]?.name || 'Unknown');
      const hooks = analyses.flatMap(a => (a.wordpress?.hooks || []).map(item => ({ ...item, path: a.path }))).slice(0, 1200);
      const restRoutes = analyses.flatMap(a => (a.wordpress?.restRoutes || []).map(item => ({ ...item, path: a.path }))).slice(0, 500);
      const record = { projectId: project.id, project: project.name, indexUpdatedAt: indexStatus.updatedAt || '', indexFileCount: indexStatus.fileCount || all.length, updatedAt: new Date().toISOString(), dirty: false, files: analyses, byPath, reverse, symbols, defsByName, references, frameworks, languages: languageList, primaryLanguage, entrypoints: likelyEntrypoints(all, profile), hotspots, profile, relations, hooks, restRoutes, stats: { projectFiles: all.length, metadataFiles:all.length, candidateFiles: candidates.length, scopedCandidateFiles:scopePlan.scoped_candidate_count, excludedByScope:scopePlan.excluded_by_scope, contentScope:scopePlan.scope, primaryContentRoots:scopePlan.primary_roots, bootstrapFiles:profileTexts.size, contentReadAttempts:readAttempts, contentReadFiles:physicalReads.size, metadataOnlyFiles:Math.max(0, all.length - physicalReads.size), analyzedFiles: analyses.length, symbols: symbols.length, dependencyEdges: edges, crossLanguageEdges: relations.filter(r => /enqueue|localize|selector/.test(r.type)).length, wordpressHooks: hooks.length, restRoutes: restRoutes.length, externalImports, referenceHits: refCount, bytesAnalyzed:contentBytes, bootstrapBytes, buildMs: Date.now() - started, truncated } };
      cache.set(project.id, record); emit(project.id); return record;
    })();
    builds.set(project.id, job); try { return await job; } finally { builds.delete(project.id); }
  }

  async function ensure(ref, force = false) { const project = store.getProject(ref), current = cache.get(project.id); let idx; try { idx = projects.status(project.id); } catch { idx = { updatedAt:'', fileCount:0, dirty:true }; } if (!force && current && !current.dirty && !idx.dirty && current.indexUpdatedAt === idx.updatedAt && current.indexFileCount === idx.fileCount) return current; return build(project.id, force); }
  function status(ref) { const project = store.getProject(ref), r = cache.get(project.id); let idx; try { idx = projects.status(project.id); } catch { idx = { updatedAt:'', fileCount:0, dirty:true }; } return { projectId:project.id, project:project.name, ready:!!r, building:builds.has(project.id), dirty:!r || r.dirty || idx.dirty || r.indexUpdatedAt !== idx.updatedAt, updatedAt:r?.updatedAt || '', indexUpdatedAt:idx.updatedAt || '', stats:r?.stats || null, frameworks:r?.frameworks || [], languages:r?.languages || [], primary_language:r?.primaryLanguage || '' }; }
  async function rebuild(ref) { return summaryRecord(await ensure(ref, true)); }
  function summaryRecord(r) { return { projectId:r.projectId, project:r.project, updatedAt:r.updatedAt, frameworks:r.frameworks, framework_names:r.frameworks.map(x => x.name), primary_language:r.primaryLanguage, entrypoints:r.entrypoints, wordpress:wp.wordpressSummary(r.profile), stats:r.stats, hotspots:r.hotspots.slice(0, 25), wordpress_hooks:r.hooks.slice(0, 120), rest_routes:r.restRoutes.slice(0, 80), cross_language_relations:r.relations.slice(0, 120), topSymbols:r.symbols.filter(x => x.exported).concat(r.symbols.filter(x => !x.exported)).slice(0, 100) }; }
  async function projectBrain(ref) { return summaryRecord(await ensure(ref)); }
  async function findSymbols(ref, query = '', kind = '', limit = 50) { const r = await ensure(ref), q = String(query || '').trim().toLowerCase(), k = String(kind || '').trim().toLowerCase(), n = Math.min(100, Math.max(1, Number(limit) || 50)); return r.symbols.filter(x => (!q || x.name.toLowerCase().includes(q) || x.path.toLowerCase().includes(q) || String(x.owner || '').toLowerCase().includes(q)) && (!k || x.kind.toLowerCase() === k)).sort((a, b) => { const ae = a.name.toLowerCase() === q ? 1 : 0, be = b.name.toLowerCase() === q ? 1 : 0; return be - ae || a.path.localeCompare(b.path) || a.line - b.line; }).slice(0, n); }
  async function findReferences(ref, symbol, limit = 80) { const r = await ensure(ref), key = String(symbol || '').trim().toLowerCase(), n = Math.min(160, Math.max(1, Number(limit) || 80)); if (!key) return { symbol:'', definitions:[], references:[] }; const exact = r.defsByName.get(key) || []; const defs = exact.length ? exact : r.symbols.filter(x => x.name.toLowerCase().includes(key)).slice(0, 20); const keys = exact.length ? [key] : [...new Set(defs.map(x => x.name.toLowerCase()))]; const refs = []; for (const k of keys) for (const item of (r.references.get(k) || [])) if (!refs.some(x => x.path === item.path && x.line === item.line)) refs.push(item); return { symbol, definitions:defs.slice(0, 30), references:refs.filter(x => !x.definition).slice(0, n), total:refs.filter(x => !x.definition).length }; }
  async function relatedFiles(ref, file, limit = 20) {
    const r = await ensure(ref), target = norm(file), n = Math.min(50, Math.max(1, Number(limit) || 20)), scores = new Map();
    const add = (p, score, reason, relation = '') => { if (!p || p === target) return; const cur = scores.get(p) || { path:p, score:0, reasons:[], relations:[] }; cur.score += score; if (!cur.reasons.includes(reason)) cur.reasons.push(reason); if (relation && !cur.relations.includes(relation)) cur.relations.push(relation); scores.set(p, cur); };
    const a = r.byPath.get(target); for (const p of (a?.localImports || [])) add(p, 9, 'được file này phụ thuộc', 'outgoing'); for (const p of (r.reverse.get(target) || [])) add(p, 9, 'phụ thuộc file này', 'incoming');
    for (const relation of r.relations) { if (relation.from === target) add(relation.to, 14, relation.type, relation.type); else if (relation.to === target) add(relation.from, 14, relation.type, relation.type); }
    const dir = path.posix.dirname(target), stem = path.posix.basename(target, path.posix.extname(target)).toLowerCase(); for (const x of r.files) { if (path.posix.dirname(x.path) === dir) add(x.path, 2, 'cùng thư mục'); if (path.posix.basename(x.path, path.posix.extname(x.path)).toLowerCase() === stem) add(x.path, 4, 'cùng tên module'); }
    return [...scores.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, n);
  }
  async function projectContext(ref, query, limit = 12) {
    const r = await ensure(ref), q = String(query || '').trim().toLowerCase(), tokens = q.split(/[^\p{L}\p{N}_$.-]+/u).filter(x => x.length > 1).slice(0, 12), n = Math.min(24, Math.max(3, Number(limit) || 12));
    const ranked = r.files.map(file => { let score = wp.contextBoost(file.path, q, r.profile); const lower = file.path.toLowerCase(); for (const token of tokens) { if (lower.includes(token)) score += 5; for (const symbol of file.symbols) if (symbol.name.toLowerCase().includes(token) || String(symbol.owner || '').toLowerCase().includes(token)) score += 8; for (const imp of file.imports) if (imp.spec.toLowerCase().includes(token)) score += 2; for (const hook of file.wordpress?.hooks || []) if (hook.hook.toLowerCase().includes(token) || hook.callback.toLowerCase().includes(token)) score += 9; } score += Math.min(7, r.reverse.get(file.path)?.size || 0); return { file, score }; }).filter(x => x.score > 0 || !tokens.length).sort((a, b) => b.score - a.score || wp.wordpressPriority(b.file.path, r.profile) - wp.wordpressPriority(a.file.path, r.profile) || b.file.symbols.length - a.file.symbols.length).slice(0, n);
    const selected = new Set(ranked.map(x => x.file.path)); const relations = r.relations.filter(rel => selected.has(rel.from) || selected.has(rel.to)).slice(0, 100);
    return { project:r.project, query, frameworks:r.frameworks, framework_names:r.frameworks.map(x => x.name), primary_language:r.primaryLanguage, wordpress:wp.wordpressSummary(r.profile), entrypoints:r.entrypoints.slice(0, 16), files:ranked.map(({ file, score }) => ({ path:file.path, role:wp.pathRole(file.path, r.profile), language:file.language, score, symbols:file.symbols.slice(0, 20), imports:file.localImports.slice(0, 16), externalImports:file.externalImports.slice(0, 8), wordpress:file.wordpress ? { hooks:file.wordpress.hooks.slice(0, 20), rest_routes:file.wordpress.restRoutes.slice(0, 12), enqueued_assets:file.wordpress.assets.slice(0, 12), localized_scripts:file.wordpress.localize.slice(0, 12) } : undefined })), relations, stats:r.stats };
  }

  return { invalidate, cleanup, shutdown, status, rebuild, ensure, projectBrain, findSymbols, findReferences, relatedFiles, projectContext, toolApi:{ projectBrain, findSymbols, findReferences, relatedFiles, projectContext } };
}

module.exports = { createBrainService, analyzeSymbols, analyzeImports, resolveImport, detectFrameworks, languageFor };
