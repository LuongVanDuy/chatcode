const fs = require('fs');
const file='scripts/smoke-database-runtime.cjs';
let s=fs.readFileSync(file,'utf8');
function rep(a,b){if(!s.includes(a))throw new Error(`smoke marker missing: ${a.slice(0,100)}`);s=s.replace(a,b);}
rep("  classifyDbHost, parseWpConfig, validateReadSql, validateMutation,\n  createDatabaseApi, HELPER_RE",
"  classifyDbHost, parseWpConfig, siteUrlCandidates, validateReadSql, validateMutation,\n  buildOneShotHelper, createDatabaseApi, HELPER_RE");
rep("assert.ok(HELPER_RE.test('wp-content/chatcode-db-once-0123456789abcdef01234567.php'));",
`assert.ok(HELPER_RE.test('wp-content/chatcode-db-once-0123456789abcdef01234567.php'));
assert.equal(siteUrlCandidates({ siteUrl:'https://example.com/subdir/' })[0], 'https://example.com/subdir', 'subdirectory WordPress URLs must be preserved');
const helperSource = buildOneShotHelper('token',Math.floor(Date.now()/1000)+60);
assert.ok(helperSource.includes("dirname(__DIR__) . '/wp-load.php'"),'one-shot helper must bootstrap WordPress from wp-content');
assert.match(helperSource,/current_state_mismatch/,'Bricks meta helper must compare current state before write');
assert.match(helperSource,/read_back_verified/,'meta/option writes must report read-back verification');
assert.throws(()=>validateMutation('bricks_update_meta',{ post_id:7,key:'_bricks_page_content_2',value:[] },10), error=>error?.code==='DATABASE_CURRENT_STATE_REQUIRED');
const canonicalTree = [{ id:'a1b2c3',name:'section',parent:0,children:[],settings:{} }];
assert.doesNotThrow(()=>validateMutation('bricks_update_meta',{ post_id:7,key:'_bricks_page_content_2',expected_current:[],value:canonicalTree },10));
assert.throws(()=>validateMutation('bricks_update_meta',{ post_id:7,key:'_bricks_page_content_2',expected_current:[],value:[{ id:'bad',name:'section' }] },10), error=>error?.code==='DATABASE_BRICKS_TREE_INVALID');`);
fs.writeFileSync(file,s);
console.log('Bricks DB safety smoke additions staged');
