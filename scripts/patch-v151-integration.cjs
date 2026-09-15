const fs = require('fs');
function patch(file,fn){let s=fs.readFileSync(file,'utf8');const out=fn(s);if(out===s)throw new Error(`${file}: no change made`);fs.writeFileSync(file,out);}
function replaceAllChecked(s,before,after,label){if(!s.includes(before))throw new Error(`missing ${label}`);return s.split(before).join(after);}

// DB helper stays in existing wp-content directory and explicit DB operations may deploy even when uploadOnSave=false.
patch('core/database-runtime.js',s=>s
  .replace("const HELPER_RE = /^wp-content\\/mu-plugins\\/chatcode-db-once-[a-f0-9]{24}\\.php$/;","const HELPER_RE = /^wp-content\\/chatcode-db-once-[a-f0-9]{24}\\.php$/;")
  .replace("const rel = `wp-content/mu-plugins/chatcode-db-once-${nonce}.php`;","const rel = `wp-content/chatcode-db-once-${nonce}.php`;")
  .replace("require_once dirname(__DIR__, 2) . '/wp-load.php';","require_once dirname(__DIR__) . '/wp-load.php';")
  .replace("const deployed = await deployImpl(api,store,project.id,[rel],id);","const deployed = await deployImpl(api,store,project.id,[rel],id,{ explicit:true, owned_helper:true });"));
patch('core/ftp-deploy.js',s=>s.replace("const OWNED_DB_HELPER_RE = /^wp-content\\/mu-plugins\\/chatcode-db-once-[a-f0-9]{24}\\.php$/;","const OWNED_DB_HELPER_RE = /^wp-content\\/chatcode-db-once-[a-f0-9]{24}\\.php$/;"));
patch('tools/deploy-ftp.ps1',s=>replaceAllChecked(s,'wp-content/mu-plugins/chatcode-db-once-','wp-content/chatcode-db-once-','owned helper prefix'));

// Single MCP database tool.
require('./patch-v151-mcp.cjs');

// Package syntax/test chain.
patch('package.json',s=>{
  s=replaceAllChecked(s,"node --check core/bricks-evidence.js && node --check core/ftp-deploy.js","node --check core/bricks-evidence.js && node --check core/database-runtime.js && node --check core/ftp-deploy.js",'syntax db');
  s=replaceAllChecked(s,"node scripts/smoke-wordpress-bricks-hardening.cjs && node scripts/smoke-ftp-deploy.cjs","node scripts/smoke-wordpress-bricks-hardening.cjs && node scripts/smoke-database-runtime.cjs && node scripts/smoke-ftp-deploy.cjs",'skill db test');
  if(!s.includes('"test:database"')) s=s.replace('"test:ftp-deploy":', '"test:database": "node scripts/smoke-database-runtime.cjs",\n    "test:ftp-deploy":');
  return s;
});

// Full skill suite always runs for database/runtime changes.
patch('.github/workflows/test-chatcode-gpt-skills.yml',s=>{
  s=replaceAllChecked(s,"      - 'core/bricks-evidence.js'\n      - 'core/project-scope.js'","      - 'core/bricks-evidence.js'\n      - 'core/database-runtime.js'\n      - 'core/ftp-deploy.js'\n      - 'tools/deploy-ftp.ps1'\n      - 'core/project-scope.js'",'workflow paths');
  s=replaceAllChecked(s,"      - 'scripts/smoke-wordpress-bricks-hardening.cjs'\n      - 'scripts/smoke-bricks-spec.cjs'","      - 'scripts/smoke-wordpress-bricks-hardening.cjs'\n      - 'scripts/smoke-database-runtime.cjs'\n      - 'scripts/smoke-bricks-spec.cjs'",'workflow test paths');
  s=s.replace("          node --check core/bricks-evidence.js\n          node --check core/project-scope.js","          node --check core/bricks-evidence.js\n          node --check core/database-runtime.js\n          node --check core/ftp-deploy.js\n          node --check core/project-scope.js");
  s=s.replace("          node --check scripts/smoke-wordpress-bricks-hardening.cjs\n          node --check scripts/smoke-bricks-spec.cjs","          node --check scripts/smoke-wordpress-bricks-hardening.cjs\n          node --check scripts/smoke-database-runtime.cjs\n          node --check scripts/smoke-bricks-spec.cjs");
  s=s.replace("      - name: Bricks Spec Engine and deterministic validator\n        run: npm run test:bricks-spec","      - name: WordPress database topology and bounded fallback\n        run: npm run test:database\n      - name: Bricks Spec Engine and deterministic validator\n        run: npm run test:bricks-spec");
  return s;
});

patch('.github/workflows/test-wordpress-bricks-v6.yml',s=>{
  s=replaceAllChecked(s,"      - 'core/bricks-evidence.js'\n      - 'core/bricks-spec.js'","      - 'core/bricks-evidence.js'\n      - 'core/database-runtime.js'\n      - 'core/ftp-deploy.js'\n      - 'tools/deploy-ftp.ps1'\n      - 'core/bricks-spec.js'",'v6 db paths');
  s=replaceAllChecked(s,"      - 'scripts/smoke-wordpress-bricks-hardening.cjs'\n      - 'package.json'","      - 'scripts/smoke-wordpress-bricks-hardening.cjs'\n      - 'scripts/smoke-database-runtime.cjs'\n      - 'package.json'",'v6 db smoke path');
  s=s.replace("          node --check core/bricks-evidence.js\n          node --check core/bricks-spec.js","          node --check core/bricks-evidence.js\n          node --check core/database-runtime.js\n          node --check core/ftp-deploy.js\n          node --check core/bricks-spec.js");
  s=s.replace("          node --check scripts/smoke-wordpress-bricks-hardening.cjs","          node --check scripts/smoke-wordpress-bricks-hardening.cjs\n          node --check scripts/smoke-database-runtime.cjs");
  s=s.replace("      - name: Existing WordPress Bricks regression suite\n        run: npm run test:wordpress-bricks-skill","      - name: Database topology and bounded fallback regression\n        run: npm run test:database\n      - name: Existing WordPress Bricks regression suite\n        run: npm run test:wordpress-bricks-skill");
  return s;
});

// DB runtime is broad enough that PR Windows gate should run all existing smoke groups.
patch('.github/workflows/build-windows.yml',s=>s.replace("            'core/store.js'\n          ))","            'core/store.js',\n            'core/database-runtime.js',\n            'core/ftp-deploy.js',\n            'tools/deploy-ftp.ps1',\n            'scripts/smoke-database-runtime.cjs'\n          ))"));

console.log('v1.0.51 database/MCP/test integration staged');
