const path = require('path');

const MAX_FILES = 900;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCES_PER_SYMBOL = 120;
const SOURCE_EXTS = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.vue','.svelte','.php','.py','.go','.rs','.java','.kt','.kts','.cs','.c','.h','.cpp','.hpp','.swift','.rb','.css','.scss','.sql','.sh','.ps1']);
const MANIFEST_NAMES = new Set(['package.json','composer.json','pyproject.toml','requirements.txt','go.mod','cargo.toml','gemfile','pubspec.yaml','pom.xml','build.gradle','build.gradle.kts']);
const LOCAL_EXTS = ['.js','.jsx','.ts','.tsx','.mjs','.cjs','.vue','.svelte','.php','.py','.go','.rs','.java','.kt','.kts','.cs','.css','.scss','.json'];

function norm(value){return String(value||'').replace(/\\/g,'/').replace(/^\.\//,'').replace(/^\/+/, '');}
function languageFor(file){
  const ext=path.posix.extname(norm(file)).toLowerCase();
  return ({'.js':'JavaScript','.jsx':'JavaScript JSX','.ts':'TypeScript','.tsx':'TypeScript JSX','.mjs':'JavaScript','.cjs':'JavaScript','.vue':'Vue','.svelte':'Svelte','.php':'PHP','.py':'Python','.go':'Go','.rs':'Rust','.java':'Java','.kt':'Kotlin','.kts':'Kotlin','.cs':'C#','.c':'C','.h':'C/C++ Header','.cpp':'C++','.hpp':'C++ Header','.swift':'Swift','.rb':'Ruby','.css':'CSS','.scss':'SCSS','.sql':'SQL','.sh':'Shell','.ps1':'PowerShell'})[ext]||'';
}
function isManifest(file){return MANIFEST_NAMES.has(path.posix.basename(norm(file)).toLowerCase())||/\.(csproj|fsproj|vbproj)$/i.test(file)}
function filePriority(file){const p=norm(file),base=path.posix.basename(p).toLowerCase(),depth=p.split('/').length;let score=100-depth*3;if(isManifest(p))score+=200;if(/^(index|main|app|server|bootstrap|functions|routes|router|entry)\.(js|jsx|ts|tsx|php|py|go|rs)$/i.test(base))score+=100;if(/(^|\/)(src|app|lib|routes|controllers|components)\//i.test(p))score+=25;return score}
function lineOf(text,index){let line=1;for(let i=0;i<index&&i<text.length;i++)if(text.charCodeAt(i)===10)line++;return line}
function cleanName(value){return String(value||'').trim().replace(/^[#$]+/,'').slice(0,160)}

function pushSymbol(out,seen,name,kind,line,exported=false){name=cleanName(name);if(!name||name.length<2)return;const key=`${kind}:${name}:${line}`;if(seen.has(key))return;seen.add(key);out.push({name,kind,line,exported:!!exported})}
function analyzeSymbols(file,text){
  const lang=languageFor(file),out=[],seen=new Set();
  const patterns=[];
  if(/JavaScript|TypeScript/.test(lang)||['Vue','Svelte'].includes(lang))patterns.push(
    [/\b(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,'function',2,1],
    [/\b(export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g,'class',2,1],
    [/\b(export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/g,'interface',2,1],
    [/\b(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g,'type',2,1],
    [/\b(export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/g,'enum',2,1],
    [/\b(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,'function',2,1]
  );
  else if(lang==='PHP')patterns.push(
    [/\b(?:final\s+|abstract\s+)?class\s+([A-Za-z_][\w]*)/gi,'class',1,0],
    [/\binterface\s+([A-Za-z_][\w]*)/gi,'interface',1,0],
    [/\btrait\s+([A-Za-z_][\w]*)/gi,'trait',1,0],
    [/\bfunction\s+&?\s*([A-Za-z_][\w]*)\s*\(/gi,'function',1,0]
  );
  else if(lang==='Python')patterns.push([/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/gm,'function',1,0],[/^\s*class\s+([A-Za-z_][\w]*)\b/gm,'class',1,0]);
  else if(lang==='Go')patterns.push([/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/gm,'function',1,0],[/^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/gm,'type',1,0]);
  else if(lang==='Rust')patterns.push([/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*[<(]/gm,'function',1,0],[/^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)\b/gm,'struct',1,0],[/^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)\b/gm,'enum',1,0],[/^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)\b/gm,'trait',1,0]);
  else if(['Java','Kotlin','C#'].includes(lang))patterns.push([/\b(?:class|interface|enum|record)\s+([A-Za-z_][\w]*)\b/g,'type',1,0],[/\b(?:public|private|protected|internal|static|virtual|override|suspend|async|final|open|abstract)\s+(?:[\w<>,?\[\].]+\s+)+([A-Za-z_][\w]*)\s*\(/g,'method',1,0]);
  else if(['C','C++','Swift','Ruby'].includes(lang))patterns.push([/\b(?:class|struct|enum|protocol|module)\s+([A-Za-z_][\w]*)\b/g,'type',1,0],[/\b(?:def|func)\s+([A-Za-z_][\w!?=]*)\s*[(:]/g,'function',1,0]);
  for(const [re,kind,nameGroup,exportGroup] of patterns){let m;while((m=re.exec(text))){pushSymbol(out,seen,m[nameGroup],kind,lineOf(text,m.index),exportGroup?!!m[exportGroup]:false);if(out.length>=500)break}}
  return out;
}

function analyzeImports(file,text){
  const lang=languageFor(file),items=[],seen=new Set();
  function add(spec,kind='import'){spec=String(spec||'').trim();if(!spec||seen.has(`${kind}:${spec}`))return;seen.add(`${kind}:${spec}`);items.push({spec,kind})}
  let m;
  if(/JavaScript|TypeScript/.test(lang)||['Vue','Svelte'].includes(lang)){
    const re=/(?:\bfrom\s*|\brequire\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]/g;while((m=re.exec(text)))add(m[1]);
    const side=/\bimport\s*['"]([^'"]+)['"]/g;while((m=side.exec(text)))add(m[1]);
  } else if(lang==='PHP'){
    const re=/\b(?:require|require_once|include|include_once)\s*(?:\(|)\s*['"]([^'"]+)['"]/gi;while((m=re.exec(text)))add(m[1],'include');
    const use=/^\s*use\s+([^;]+);/gmi;while((m=use.exec(text)))add(m[1].trim(),'namespace');
  } else if(lang==='Python'){
    const from=/^\s*from\s+([.\w]+)\s+import\s+/gm;while((m=from.exec(text)))add(m[1]);
    const imp=/^\s*import\s+([\w.]+)/gm;while((m=imp.exec(text)))add(m[1]);
  } else if(lang==='Go'){
    const one=/\bimport\s+"([^"]+)"/g;while((m=one.exec(text)))add(m[1]);
    const block=/\bimport\s*\(([\s\S]*?)\)/g;while((m=block.exec(text))){const q=/"([^"]+)"/g;let x;while((x=q.exec(m[1])))add(x[1])}
  } else if(lang==='Rust'){
    const use=/^\s*use\s+([^;]+);/gm;while((m=use.exec(text)))add(m[1].trim());
    const mod=/^\s*mod\s+([A-Za-z_][\w]*)\s*;/gm;while((m=mod.exec(text)))add(`./${m[1]}`,'module');
  } else if(['Java','Kotlin'].includes(lang)){
    const re=/^\s*import\s+([\w.*]+)\s*;?/gm;while((m=re.exec(text)))add(m[1]);
  } else if(lang==='C#'){
    const re=/^\s*using\s+([\w.]+)\s*;/gm;while((m=re.exec(text)))add(m[1]);
  } else if(['CSS','SCSS'].includes(lang)){
    const re=/@(?:use|import)\s+(?:url\()?['"]([^'"]+)['"]/g;while((m=re.exec(text)))add(m[1]);
  }
  return items.slice(0,250);
}

function resolveImport(source,spec,fileSet){
  source=norm(source);spec=String(spec||'').trim();if(!spec)return'';
  let base='';
  if(spec.startsWith('.')) base=path.posix.normalize(path.posix.join(path.posix.dirname(source),spec));
  else if(spec.startsWith('/')) base=norm(spec);
  else if(languageFor(source)==='Python'&&spec.startsWith('.')) base=path.posix.normalize(path.posix.join(path.posix.dirname(source),spec.replace(/^\.+/,'').replace(/\./g,'/')));
  else return'';
  base=norm(base).replace(/\?.*$/,'').replace(/#.*$/,'');
  const candidates=[base];
  if(!path.posix.extname(base))for(const ext of LOCAL_EXTS)candidates.push(base+ext);
  for(const ext of LOCAL_EXTS)candidates.push(path.posix.join(base,`index${ext}`));
  for(const candidate of candidates)if(fileSet.has(norm(candidate)))return norm(candidate);
  return'';
}

function packageInfo(text){try{const p=JSON.parse(text||'{}');return{deps:{...(p.dependencies||{}),...(p.devDependencies||{})},scripts:Object.keys(p.scripts||{}),name:p.name||''}}catch{return{deps:{},scripts:[],name:''}}}
function detectFrameworks(files,texts){
  const fileSet=new Set(files.map(x=>x.toLowerCase())),out=[],seen=new Set();
  const add=(name,evidence)=>{if(seen.has(name))return;seen.add(name);out.push({name,evidence})};
  const has=s=>[...fileSet].some(x=>x===s||x.startsWith(`${s}/`)||x.endsWith(`/${s}`));
  if(has('wp-config.php')||has('wp-admin')||has('wp-includes')||has('wp-content'))add('WordPress','Cấu trúc WordPress');
  if(fileSet.has('functions.php')&&fileSet.has('style.css'))add('WordPress Theme','functions.php + style.css');
  const pkg=packageInfo(texts.get('package.json'));
  const deps=pkg.deps;
  if(deps.next)add('Next.js','package.json: next');
  if(deps.nuxt)add('Nuxt','package.json: nuxt');
  if(deps.react)add('React','package.json: react');
  if(deps.vue)add('Vue','package.json: vue');
  if(deps.svelte)add('Svelte','package.json: svelte');
  if(deps.express)add('Express','package.json: express');
  if(deps.nestjs||deps['@nestjs/core'])add('NestJS','package.json: @nestjs/core');
  if(deps.vite)add('Vite','package.json: vite');
  const composer=(texts.get('composer.json')||'').toLowerCase();
  if(composer.includes('laravel/framework')||fileSet.has('artisan'))add('Laravel','composer/artisan');
  if(composer.includes('symfony/'))add('Symfony','composer.json');
  const req=`${texts.get('requirements.txt')||''}\n${texts.get('pyproject.toml')||''}`.toLowerCase();
  if(fileSet.has('manage.py')||req.includes('django'))add('Django','manage.py / Python dependencies');
  if(req.includes('fastapi'))add('FastAPI','Python dependencies');
  if(req.includes('flask'))add('Flask','Python dependencies');
  if(fileSet.has('go.mod'))add('Go Modules','go.mod');
  if(fileSet.has('cargo.toml'))add('Rust / Cargo','Cargo.toml');
  if([...fileSet].some(x=>x.endsWith('.csproj')))add('.NET','*.csproj');
  if(fileSet.has('pom.xml')||fileSet.has('build.gradle')||fileSet.has('build.gradle.kts'))add('JVM','Maven/Gradle');
  return out;
}

function likelyEntrypoints(files){
  const preferred=['package.json','composer.json','index.php','functions.php','artisan','manage.py','main.go','go.mod','cargo.toml','src/index.ts','src/index.tsx','src/index.js','src/main.ts','src/main.js','src/app.ts','src/app.tsx','app.js','server.js'];
  const set=new Set(files.map(norm)),out=[];for(const x of preferred)if(set.has(x))out.push(x);
  for(const file of files){if(out.length>=18)break;const base=path.posix.basename(file);if(/^(index|main|app|server|bootstrap|routes)\.(js|jsx|ts|tsx|php|py|go|rs)$/i.test(base)&&!out.includes(file))out.push(file)}
  return out.slice(0,18);
}

function createBrainService(store,projects,{onChanged}={}){
  const cache=new Map(),builds=new Map();
  const base=projects.toolApi;
  function emit(id){try{onChanged?.(status(id))}catch{}}
  function invalidate(ref){let id=String(ref||'');try{id=store.getProject(ref).id}catch{}const current=cache.get(id);if(current)current.dirty=true;emit(id)}
  function cleanup(ref){let id=String(ref||'');try{id=store.getProject(ref).id}catch{}cache.delete(id);builds.delete(id)}
  function shutdown(){cache.clear();builds.clear()}

  async function build(ref,force=false){
    const project=store.getProject(ref);if(builds.has(project.id))return builds.get(project.id);
    const job=(async()=>{
      const started=Date.now();
      const all=await base.listFiles(project.id,5000);const indexStatus=projects.status(project.id);
      const candidates=all.filter(file=>SOURCE_EXTS.has(path.posix.extname(norm(file)).toLowerCase())||isManifest(file)).sort((a,b)=>filePriority(b)-filePriority(a));
      const selected=candidates.slice(0,MAX_FILES),texts=new Map(),analyses=[],languages=new Map();let bytes=0,truncated=candidates.length>selected.length;
      for(const rel of selected){
        try{
          const read=await base.readFile(project.id,rel),text=String(read.content||''),size=Buffer.byteLength(text,'utf8');
          if(bytes+size>MAX_TOTAL_BYTES){truncated=true;break}bytes+=size;texts.set(norm(rel),text);
          const lang=languageFor(rel);if(lang)languages.set(lang,(languages.get(lang)||0)+1);
          if(SOURCE_EXTS.has(path.posix.extname(norm(rel)).toLowerCase()))analyses.push({path:norm(rel),language:lang,symbols:analyzeSymbols(rel,text),imports:analyzeImports(rel,text)});
        }catch{}
      }
      const fileSet=new Set(all.map(norm)),byPath=new Map(analyses.map(x=>[x.path,x])),reverse=new Map();let edges=0,externalImports=0;
      for(const analysis of analyses){analysis.localImports=[];analysis.externalImports=[];for(const item of analysis.imports){const resolved=resolveImport(analysis.path,item.spec,fileSet);if(resolved){analysis.localImports.push(resolved);edges++;if(!reverse.has(resolved))reverse.set(resolved,new Set());reverse.get(resolved).add(analysis.path)}else{analysis.externalImports.push(item.spec);externalImports++}}analysis.localImports=[...new Set(analysis.localImports)];analysis.externalImports=[...new Set(analysis.externalImports)].slice(0,40)}
      const symbols=[],defsByName=new Map();
      for(const analysis of analyses)for(const symbol of analysis.symbols){const item={...symbol,path:analysis.path,language:analysis.language};symbols.push(item);const key=symbol.name.toLowerCase();if(!defsByName.has(key))defsByName.set(key,[]);defsByName.get(key).push(item)}
      const references=new Map(),symbolKeys=new Set(defsByName.keys());let refCount=0;
      for(const [file,text] of texts){if(!SOURCE_EXTS.has(path.posix.extname(file).toLowerCase()))continue;const lines=text.split(/\r?\n/);for(let i=0;i<lines.length;i++){const tokens=lines[i].match(/[A-Za-z_$][\w$]{1,80}/g)||[];const unique=new Set(tokens.map(x=>x.toLowerCase()).filter(x=>symbolKeys.has(x)));for(const key of unique){if(refCount>25000)break;const arr=references.get(key)||[];if(arr.length>=MAX_REFERENCES_PER_SYMBOL)continue;const definition=(defsByName.get(key)||[]).some(d=>d.path===file&&d.line===i+1);arr.push({path:file,line:i+1,snippet:lines[i].trim().slice(0,260),definition});references.set(key,arr);refCount++}}}
      const hotspots=analyses.map(a=>({path:a.path,language:a.language,symbols:a.symbols.length,outgoing:a.localImports.length,incoming:reverse.get(a.path)?.size||0,score:a.symbols.length+(a.localImports.length*2)+((reverse.get(a.path)?.size||0)*2)})).sort((a,b)=>b.score-a.score).slice(0,30);
      const frameworks=detectFrameworks(all,texts),languageList=[...languages.entries()].map(([name,files])=>({name,files})).sort((a,b)=>b.files-a.files);
      const record={projectId:project.id,project:project.name,indexUpdatedAt:indexStatus.updatedAt||'',indexFileCount:indexStatus.fileCount||all.length,updatedAt:new Date().toISOString(),dirty:false,files:analyses,byPath,reverse,symbols,defsByName,references,frameworks,languages:languageList,entrypoints:likelyEntrypoints(all),hotspots,stats:{projectFiles:all.length,candidateFiles:candidates.length,analyzedFiles:analyses.length,symbols:symbols.length,dependencyEdges:edges,externalImports,referenceHits:refCount,bytesAnalyzed:bytes,buildMs:Date.now()-started,truncated}};
      cache.set(project.id,record);emit(project.id);return record;
    })();builds.set(project.id,job);try{return await job}finally{builds.delete(project.id)}
  }

  async function ensure(ref,force=false){
    const project=store.getProject(ref),current=cache.get(project.id);let idx;try{idx=projects.status(project.id)}catch{idx={updatedAt:'',fileCount:0,dirty:true}};
    if(!force&&current&&!current.dirty&&!idx.dirty&&current.indexUpdatedAt===idx.updatedAt&&current.indexFileCount===idx.fileCount)return current;
    return build(project.id,force);
  }
  function status(ref){
    const project=store.getProject(ref),r=cache.get(project.id);let idx;try{idx=projects.status(project.id)}catch{idx={updatedAt:'',fileCount:0,dirty:true}};
    return{projectId:project.id,project:project.name,ready:!!r,building:builds.has(project.id),dirty:!r||r.dirty||idx.dirty||r.indexUpdatedAt!==idx.updatedAt,updatedAt:r?.updatedAt||'',indexUpdatedAt:idx.updatedAt||'',stats:r?.stats||null,frameworks:r?.frameworks||[],languages:r?.languages||[]};
  }
  async function rebuild(ref){const r=await ensure(ref,true);return summaryRecord(r)}
  function summaryRecord(r){return{projectId:r.projectId,project:r.project,updatedAt:r.updatedAt,frameworks:r.frameworks,languages:r.languages,entrypoints:r.entrypoints,stats:r.stats,hotspots:r.hotspots.slice(0,20),topSymbols:r.symbols.filter(x=>x.exported).concat(r.symbols.filter(x=>!x.exported)).slice(0,80)}}
  async function projectBrain(ref){return summaryRecord(await ensure(ref))}
  async function findSymbols(ref,query='',kind='',limit=50){const r=await ensure(ref),q=String(query||'').trim().toLowerCase(),k=String(kind||'').trim().toLowerCase(),n=Math.min(100,Math.max(1,Number(limit)||50));return r.symbols.filter(x=>(!q||x.name.toLowerCase().includes(q)||x.path.toLowerCase().includes(q))&&(!k||x.kind.toLowerCase()===k)).sort((a,b)=>{const ae=a.name.toLowerCase()===q?1:0,be=b.name.toLowerCase()===q?1:0;return be-ae||a.path.localeCompare(b.path)||a.line-b.line}).slice(0,n)}
  async function findReferences(ref,symbol,limit=80){const r=await ensure(ref),key=String(symbol||'').trim().toLowerCase(),n=Math.min(160,Math.max(1,Number(limit)||80));if(!key)return{symbol:'',definitions:[],references:[]};const exact=r.defsByName.get(key)||[];const defs=exact.length?exact:r.symbols.filter(x=>x.name.toLowerCase().includes(key)).slice(0,20);const keys=exact.length?[key]:[...new Set(defs.map(x=>x.name.toLowerCase()))];const refs=[];for(const k of keys)for(const item of(r.references.get(k)||[]))if(!refs.some(x=>x.path===item.path&&x.line===item.line))refs.push(item);return{symbol,definitions:defs.slice(0,30),references:refs.filter(x=>!x.definition).slice(0,n),total:refs.filter(x=>!x.definition).length}}
  async function relatedFiles(ref,file,limit=20){const r=await ensure(ref),target=norm(file),n=Math.min(50,Math.max(1,Number(limit)||20)),scores=new Map();const add=(p,score,reason)=>{if(!p||p===target)return;const cur=scores.get(p)||{path:p,score:0,reasons:[]};cur.score+=score;if(!cur.reasons.includes(reason))cur.reasons.push(reason);scores.set(p,cur)};const a=r.byPath.get(target);for(const p of(a?.localImports||[]))add(p,9,'được file này import');for(const p of(r.reverse.get(target)||[]))add(p,9,'import file này');const dir=path.posix.dirname(target),stem=path.posix.basename(target,path.posix.extname(target)).toLowerCase();for(const x of r.files){if(path.posix.dirname(x.path)===dir)add(x.path,2,'cùng thư mục');if(path.posix.basename(x.path,path.posix.extname(x.path)).toLowerCase()===stem)add(x.path,4,'cùng tên module')}return[...scores.values()].sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)).slice(0,n)}
  async function projectContext(ref,query,limit=12){const r=await ensure(ref),q=String(query||'').trim().toLowerCase(),tokens=q.split(/[^a-z0-9_$.-]+/i).filter(x=>x.length>1).slice(0,10),n=Math.min(24,Math.max(3,Number(limit)||12));const ranked=r.files.map(f=>{let score=0;const lower=f.path.toLowerCase();for(const t of tokens){if(lower.includes(t))score+=5;for(const s of f.symbols)if(s.name.toLowerCase().includes(t))score+=7;for(const imp of f.imports)if(imp.spec.toLowerCase().includes(t))score+=2}score+=Math.min(5,(r.reverse.get(f.path)?.size||0));return{file:f,score}}).filter(x=>x.score>0||!tokens.length).sort((a,b)=>b.score-a.score||b.file.symbols.length-a.file.symbols.length).slice(0,n);return{project:r.project,query,frameworks:r.frameworks,languages:r.languages.slice(0,8),entrypoints:r.entrypoints.slice(0,12),files:ranked.map(({file,score})=>({path:file.path,language:file.language,score,symbols:file.symbols.slice(0,16),imports:file.localImports.slice(0,12),externalImports:file.externalImports.slice(0,8)})),stats:r.stats}}

  return{invalidate,cleanup,shutdown,status,rebuild,projectBrain,findSymbols,findReferences,relatedFiles,projectContext,toolApi:{projectBrain,findSymbols,findReferences,relatedFiles,projectContext}};
}

module.exports={createBrainService,analyzeSymbols,analyzeImports,resolveImport,detectFrameworks,languageFor};
