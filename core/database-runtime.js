const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chatError } = require('./errors');
const { deployChangedFiles, deleteOwnedRemoteFile } = require('./ftp-deploy');

const MAX_QUERY_ROWS = 200;
const MAX_MUTATION_ROWS = 100;
const MAX_RECOVERY_POINTS = 100;
const HELPER_TTL_SEC = 300;
const HELPER_RE = /^wp-content\/chatcode-db-once-[a-f0-9]{24}\.php$/;
const READ_SQL_RE = /^\s*(?:SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i;
const SAFE_COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRICKS_META_KEYS = new Set([
  '_bricks_page_content_2','_bricks_page_header_2','_bricks_page_footer_2',
  '_bricks_page_settings','_bricks_template_settings'
]);

function normalizeRel(value) {
  return String(value || '').replace(/\\/g,'/').replace(/^\.\//,'').replace(/^\/+/, '');
}

function classifyDbHost(value) {
  const host = String(value || '').trim().toLowerCase();
  if (!host) return 'unknown';
  const base = host.replace(/^\[/,'').replace(/\]$/,'').split(':')[0];
  if (['localhost','127.0.0.1','::1'].includes(base) || host.startsWith('localhost:') || /^\/.+\.sock$/.test(host)) return 'server-local';
  if (/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) return 'remote-or-dns';
  return 'unknown';
}

function parseWpConfig(content = '') {
  const source = String(content || '');
  const value = name => {
    const match = source.match(new RegExp(`define\\s*\\(\\s*['\"]${name}['\"]\\s*,\\s*['\"]([^'\"]*)['\"]\\s*\\)`, 'i'));
    return match?.[1] || '';
  };
  const prefix = source.match(/\$table_prefix\s*=\s*['\"]([^'\"]+)['\"]/i)?.[1] || '';
  return { db_host:value('DB_HOST'), table_prefix:prefix };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return null; }
}

function normalizeBaseUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return '';
    return `${url.protocol}//${url.host}`;
  } catch { return ''; }
}

function siteUrlCandidates(project = {}, ftp = null) {
  const out = [];
  const add = value => { const normalized = normalizeBaseUrl(value); if (normalized && !out.includes(normalized)) out.push(normalized); };
  const bridge = ftp?.chatcodeDatabase || ftp?.chatcode_database || {};
  add(bridge.siteUrl || bridge.site_url);
  add(ftp?.siteUrl || ftp?.websiteUrl || ftp?.webUrl || ftp?.url || ftp?.domain);
  add(project?.siteUrl || project?.site_url || project?.url || project?.domain);
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(String(project?.name || ''))) add(project.name);
  const ftpHost = String(ftp?.host || '').replace(/^(?:ftp|sftp)\./i,'');
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(ftpHost)) add(ftpHost);
  return out.slice(0,4);
}

function bridgeConfig(ftp = null) {
  const raw = ftp?.chatcodeDatabase || ftp?.chatcode_database || {};
  const url = normalizeBaseUrl(raw.url || raw.endpoint || '');
  const pathName = String(raw.path || '/wp-json/chatcode/v1/database').trim();
  const token = String(raw.token || raw.bearerToken || raw.bearer_token || '').trim();
  if (!url || !token) return null;
  return { url:`${url}${pathName.startsWith('/') ? pathName : `/${pathName}`}`, token };
}

function validateReadSql(sql) {
  const text = String(sql || '').trim();
  if (!text || text.length > 32000) throw chatError('DATABASE_QUERY_INVALID','SQL read query is empty or too large.');
  if (!READ_SQL_RE.test(text)) throw chatError('DATABASE_QUERY_READ_ONLY','database.query only accepts SELECT/SHOW/DESCRIBE/EXPLAIN.');
  if (/;\s*\S/.test(text) || /\b(?:INTO\s+OUTFILE|LOAD_FILE|SLEEP|BENCHMARK)\s*\(/i.test(text)) {
    throw chatError('DATABASE_QUERY_READ_ONLY','Multiple statements and unsafe read functions are not allowed.');
  }
  return text;
}

function ensureRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw chatError('DATABASE_MUTATION_INVALID', `${label} must be an object.`);
  return value;
}

function validateMutation(operation, payload = {}, maxRows = MAX_MUTATION_ROWS) {
  const op = String(operation || '').trim();
  const data = ensureRecord(payload,'payload');
  const max = Math.min(MAX_MUTATION_ROWS, Math.max(1, Number(maxRows) || MAX_MUTATION_ROWS));
  const allowed = new Set(['insert_post','update_meta','update_option','wpdb_insert','wpdb_update','wpdb_delete','bricks_update_meta']);
  if (!allowed.has(op)) throw chatError('DATABASE_MUTATION_INVALID', `Unsupported database mutation operation: ${op}`);
  if (op === 'insert_post') {
    if (!String(data.post_type || '').match(/^[a-z0-9_-]{1,40}$/i)) throw chatError('DATABASE_MUTATION_INVALID','insert_post requires a valid post_type.');
    if (data.idempotency_key && String(data.idempotency_key).length > 180) throw chatError('DATABASE_MUTATION_INVALID','idempotency_key is too long.');
  }
  if (op === 'update_meta' || op === 'bricks_update_meta') {
    if (!Number.isInteger(Number(data.post_id)) || Number(data.post_id) < 1) throw chatError('DATABASE_MUTATION_INVALID','post_id must be a positive integer.');
    if (!String(data.key || '').match(/^[A-Za-z0-9_.:-]{1,190}$/)) throw chatError('DATABASE_MUTATION_INVALID','meta key is invalid.');
    if (op === 'bricks_update_meta' && !BRICKS_META_KEYS.has(String(data.key))) throw chatError('DATABASE_MUTATION_INVALID','Unsupported Bricks meta key.');
  }
  if (op === 'update_option' && !String(data.key || '').match(/^[A-Za-z0-9_.:-]{1,190}$/)) throw chatError('DATABASE_MUTATION_INVALID','option key is invalid.');
  if (op.startsWith('wpdb_')) {
    if (!String(data.table || '').trim()) throw chatError('DATABASE_MUTATION_INVALID','wpdb operation requires table.');
    if (op !== 'wpdb_insert') ensureRecord(data.where,'where');
    ensureRecord(data.data || {},'data');
    for (const key of [...Object.keys(data.data || {}), ...Object.keys(data.where || {})]) if (!SAFE_COLUMN_RE.test(key)) throw chatError('DATABASE_MUTATION_INVALID',`Unsafe column name: ${key}`);
    if (op === 'wpdb_delete' && data.confirm_destructive !== true) throw chatError('DATABASE_DESTRUCTIVE_CONFIRMATION_REQUIRED','wpdb_delete requires confirm_destructive=true after affected-set review.');
  }
  return { operation:op, payload:data, max_rows:max };
}

function escapeDiffLine(value) { return String(value || '').replace(/\r/g,''); }
function createFilePatch(rel, content) {
  const lines = escapeDiffLine(content).split('\n');
  return `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}\n`;
}
function deleteFilePatch(rel, content) {
  const lines = escapeDiffLine(content).split('\n');
  return `--- a/${rel}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${lines.map(line => `-${line}`).join('\n')}\n`;
}

function phpLiteral(value) {
  return `'${String(value || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}'`;
}

function buildOneShotHelper(token, expiresAt) {
  return `<?php
// ChatCode bounded one-shot database helper. Auto-deletes after an authenticated request.
$cc_token = ${phpLiteral(token)};
$cc_expires = ${Number(expiresAt)};
if (time() > $cc_expires) { @unlink(__FILE__); http_response_code(410); exit; }
$cc_given = isset($_SERVER['HTTP_X_CHATCODE_TOKEN']) ? (string) $_SERVER['HTTP_X_CHATCODE_TOKEN'] : '';
if (!$cc_given || !hash_equals($cc_token, $cc_given)) { http_response_code(401); exit; }
register_shutdown_function(function () { @unlink(__FILE__); });
require_once dirname(__DIR__) . '/wp-load.php';
header('Content-Type: application/json; charset=utf-8');
function cc_out($data, $status = 200) { http_response_code($status); echo wp_json_encode($data); exit; }
function cc_alias($name) {
  global $wpdb;
  $map = array(
    '{posts}' => $wpdb->posts, '{postmeta}' => $wpdb->postmeta, '{terms}' => $wpdb->terms,
    '{term_taxonomy}' => $wpdb->term_taxonomy, '{term_relationships}' => $wpdb->term_relationships,
    '{options}' => $wpdb->options, '{users}' => $wpdb->users, '{usermeta}' => $wpdb->usermeta,
    '{comments}' => $wpdb->comments, '{commentmeta}' => $wpdb->commentmeta
  );
  return isset($map[$name]) ? $map[$name] : $name;
}
function cc_table($name) {
  global $wpdb;
  $table = cc_alias((string) $name);
  if (!preg_match('/^[A-Za-z0-9_]+$/', $table) || strpos($table, $wpdb->prefix) !== 0) cc_out(array('ok'=>false,'error'=>'table_not_allowed'), 400);
  return $table;
}
function cc_columns($data) {
  if (!is_array($data)) cc_out(array('ok'=>false,'error'=>'invalid_record'), 400);
  foreach (array_keys($data) as $key) if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', (string) $key)) cc_out(array('ok'=>false,'error'=>'invalid_column'), 400);
  return $data;
}
function cc_where_sql($where, &$values) {
  $where = cc_columns($where); $parts = array(); $values = array();
  foreach ($where as $key => $value) {
    if (is_null($value)) $parts[] = $key . ' IS NULL';
    else { $parts[] = $key . ' = %s'; $values[] = maybe_serialize($value); }
  }
  if (!$parts) cc_out(array('ok'=>false,'error'=>'empty_where'), 400);
  return implode(' AND ', $parts);
}
function cc_primary_key($table) {
  global $wpdb;
  $rows = $wpdb->get_results("SHOW KEYS FROM {$table} WHERE Key_name='PRIMARY'", ARRAY_A);
  return !empty($rows[0]['Column_name']) ? (string) $rows[0]['Column_name'] : '';
}
function cc_snapshot($table, $where, $max) {
  global $wpdb; $values = array(); $whereSql = cc_where_sql($where, $values);
  $sql = "SELECT * FROM {$table} WHERE {$whereSql} LIMIT " . (intval($max) + 1);
  if ($values) $sql = $wpdb->prepare($sql, $values);
  $rows = $wpdb->get_results($sql, ARRAY_A);
  if (count($rows) > intval($max)) cc_out(array('ok'=>false,'error'=>'affected_set_too_large','affected_count'=>count($rows),'max_rows'=>intval($max)), 409);
  return $rows;
}
function cc_restore($recovery) {
  global $wpdb;
  $kind = isset($recovery['kind']) ? (string) $recovery['kind'] : '';
  if ($kind === 'delete_post') return (bool) wp_delete_post(intval($recovery['post_id']), true);
  if ($kind === 'restore_meta') {
    $id = intval($recovery['post_id']); $key = (string) $recovery['key'];
    return !empty($recovery['existed']) ? (bool) update_post_meta($id, $key, $recovery['value']) : (bool) delete_post_meta($id, $key);
  }
  if ($kind === 'restore_option') {
    $key = (string) $recovery['key'];
    return !empty($recovery['existed']) ? (bool) update_option($key, $recovery['value'], false) : (bool) delete_option($key);
  }
  if ($kind === 'restore_rows') {
    $table = cc_table($recovery['table']); $rows = isset($recovery['rows']) && is_array($recovery['rows']) ? $recovery['rows'] : array();
    foreach ($rows as $row) { if ($wpdb->replace($table, cc_columns($row)) === false) return false; }
    return true;
  }
  if ($kind === 'delete_row') {
    $table = cc_table($recovery['table']); $pk = (string) $recovery['primary_key'];
    if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $pk)) return false;
    return $wpdb->delete($table, array($pk => $recovery['value'])) !== false;
  }
  return false;
}
$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!is_array($req)) cc_out(array('ok'=>false,'error'=>'invalid_json'), 400);
$action = isset($req['action']) ? (string) $req['action'] : '';
global $wpdb;
if ($action === 'inspect') {
  $tables = $wpdb->get_col('SHOW TABLES');
  cc_out(array('ok'=>true,'driver'=>'wpdb','wordpress'=>true,'prefix'=>$wpdb->prefix,'tables'=>array_slice($tables,0,200)));
}
if ($action === 'query') {
  $sql = isset($req['sql']) ? trim((string) $req['sql']) : '';
  if (!preg_match('/^(SELECT|SHOW|DESCRIBE|EXPLAIN)\\b/i', $sql) || preg_match('/;\\s*\\S/', $sql)) cc_out(array('ok'=>false,'error'=>'read_only_sql_required'), 400);
  foreach (array('{posts}','{postmeta}','{terms}','{term_taxonomy}','{term_relationships}','{options}','{users}','{usermeta}','{comments}','{commentmeta}') as $alias) $sql = str_replace($alias, cc_alias($alias), $sql);
  $params = isset($req['params']) && is_array($req['params']) ? $req['params'] : array();
  if ($params) $sql = $wpdb->prepare($sql, $params);
  $rows = $wpdb->get_results($sql, ARRAY_A); $max = min(200, max(1, intval(isset($req['max_rows']) ? $req['max_rows'] : 100)));
  if (count($rows) > $max) $rows = array_slice($rows, 0, $max);
  cc_out(array('ok'=>true,'rows'=>$rows,'row_count'=>count($rows),'last_error'=>$wpdb->last_error ? 'query_failed' : ''));
}
if ($action === 'rollback') {
  $ok = cc_restore(isset($req['recovery']) ? $req['recovery'] : array());
  cc_out(array('ok'=>$ok,'rolled_back'=>$ok), $ok ? 200 : 409);
}
if ($action !== 'mutate') cc_out(array('ok'=>false,'error'=>'unsupported_action'), 400);
$op = isset($req['operation']) ? (string) $req['operation'] : '';
$p = isset($req['payload']) && is_array($req['payload']) ? $req['payload'] : array();
$max = min(100, max(1, intval(isset($req['max_rows']) ? $req['max_rows'] : 100)));
if ($op === 'insert_post') {
  $seed = isset($p['idempotency_key']) ? (string) $p['idempotency_key'] : '';
  if ($seed !== '') {
    $existing = get_posts(array('post_type'=>(string)$p['post_type'],'post_status'=>'any','meta_key'=>'_chatcode_seed_key','meta_value'=>$seed,'fields'=>'ids','posts_per_page'=>1));
    if ($existing) cc_out(array('ok'=>true,'changed'=>false,'no_op'=>true,'post_id'=>intval($existing[0])));
  }
  $postarr = array('post_type'=>(string)$p['post_type'],'post_status'=>isset($p['post_status'])?(string)$p['post_status']:'publish','post_title'=>isset($p['post_title'])?(string)$p['post_title']:'','post_content'=>isset($p['post_content'])?(string)$p['post_content']:'','post_excerpt'=>isset($p['post_excerpt'])?(string)$p['post_excerpt']:'');
  $id = wp_insert_post($postarr, true); if (is_wp_error($id)) cc_out(array('ok'=>false,'error'=>'wp_insert_post_failed'), 409);
  if ($seed !== '') update_post_meta($id, '_chatcode_seed_key', $seed);
  if (!empty($p['meta']) && is_array($p['meta'])) foreach ($p['meta'] as $key=>$value) update_post_meta($id, (string)$key, $value);
  cc_out(array('ok'=>true,'changed'=>true,'post_id'=>intval($id),'recovery'=>array('kind'=>'delete_post','post_id'=>intval($id))));
}
if ($op === 'update_meta' || $op === 'bricks_update_meta') {
  $id = intval($p['post_id']); $key = (string)$p['key']; $exists = metadata_exists('post',$id,$key); $before = $exists ? get_post_meta($id,$key,true) : null;
  $result = update_post_meta($id,$key,$p['value']);
  cc_out(array('ok'=>$result !== false,'changed'=>$result !== false,'recovery'=>array('kind'=>'restore_meta','post_id'=>$id,'key'=>$key,'existed'=>$exists,'value'=>$before)), $result !== false ? 200 : 409);
}
if ($op === 'update_option') {
  $key = (string)$p['key']; $sentinel = new stdClass(); $before = get_option($key,$sentinel); $exists = $before !== $sentinel;
  $result = update_option($key,$p['value'],false);
  cc_out(array('ok'=>true,'changed'=>(bool)$result,'recovery'=>array('kind'=>'restore_option','key'=>$key,'existed'=>$exists,'value'=>$exists?$before:null)));
}
if ($op === 'wpdb_insert') {
  $table = cc_table($p['table']); $data = cc_columns($p['data']); $pk = cc_primary_key($table);
  $wpdb->query('START TRANSACTION');
  $ok = $wpdb->insert($table,$data) !== false; $insertId = intval($wpdb->insert_id);
  if (!$ok) { $wpdb->query('ROLLBACK'); cc_out(array('ok'=>false,'error'=>'insert_failed'),409); }
  $wpdb->query('COMMIT');
  $recovery = ($pk && $insertId) ? array('kind'=>'delete_row','table'=>$table,'primary_key'=>$pk,'value'=>$insertId) : null;
  cc_out(array('ok'=>true,'changed'=>true,'insert_id'=>$insertId,'recovery'=>$recovery));
}
if ($op === 'wpdb_update' || $op === 'wpdb_delete') {
  $table = cc_table($p['table']); $where = cc_columns($p['where']); $rows = cc_snapshot($table,$where,$max); $count = count($rows);
  if (!$count) cc_out(array('ok'=>true,'changed'=>false,'no_op'=>true,'affected_count'=>0));
  $pk = cc_primary_key($table); if (!$pk) cc_out(array('ok'=>false,'error'=>'primary_key_required_for_recovery'),409);
  $wpdb->query('START TRANSACTION');
  $result = $op === 'wpdb_update' ? $wpdb->update($table,cc_columns($p['data']),$where) : $wpdb->delete($table,$where);
  if ($result === false) { $wpdb->query('ROLLBACK'); cc_out(array('ok'=>false,'error'=>'mutation_failed'),409); }
  $ids = array_values(array_map(function($row) use($pk){ return $row[$pk]; }, $rows));
  $placeholders = implode(',', array_fill(0,count($ids),'%s'));
  $verifySql = $wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE {$pk} IN ({$placeholders})", $ids);
  $remaining = intval($wpdb->get_var($verifySql));
  if ($op === 'wpdb_delete' && $remaining !== 0) { $wpdb->query('ROLLBACK'); cc_out(array('ok'=>false,'error'=>'verify_failed'),409); }
  if ($op === 'wpdb_update' && $remaining !== $count) { $wpdb->query('ROLLBACK'); cc_out(array('ok'=>false,'error'=>'verify_failed'),409); }
  $wpdb->query('COMMIT');
  cc_out(array('ok'=>true,'changed'=>true,'affected_count'=>$count,'recovery'=>array('kind'=>'restore_rows','table'=>$table,'rows'=>$rows)));
}
cc_out(array('ok'=>false,'error'=>'unsupported_mutation'),400);
`;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok || !body || body.ok === false) {
    throw chatError('DATABASE_REMOTE_FAILED', `Server-side database operation failed (HTTP ${response.status}).`, { status:response.status, error:body?.error || 'invalid_response' });
  }
  return body;
}

function createDatabaseApi(api, store, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const deployImpl = options.deployChangedFilesImpl || deployChangedFiles;
  const deleteRemoteImpl = options.deleteOwnedRemoteFileImpl || deleteOwnedRemoteFile;
  const recoveries = new Map();

  function projectOf(ref) { return store?.getProject ? store.getProject(ref) : null; }
  function topology(ref) {
    const project = projectOf(ref);
    if (!project) throw chatError('FILE_NOT_FOUND',`Project not found: ${ref}`);
    const root = String(project.root || '');
    const has = rel => !!root && fs.existsSync(path.join(root,...rel.split('/')));
    const wpConfigPath = path.join(root,'wp-config.php');
    const config = fs.existsSync(wpConfigPath) ? parseWpConfig(fs.readFileSync(wpConfigPath,'utf8')) : { db_host:'',table_prefix:'' };
    const ftp = readJson(path.join(root,'.vscode','sftp.json'));
    const fullLocalWordPress = has('wp-includes/version.php') && has('wp-admin/includes/upgrade.php');
    const mirror = has('wp-config.php') && has('wp-load.php') && has('wp-settings.php') && !fullLocalWordPress;
    const dbHostClass = classifyDbHost(config.db_host);
    const persistent = bridgeConfig(ftp);
    return {
      project, root, ftp, persistent,
      public:{
        wordpress_files_present:has('wp-config.php') && has('wp-load.php'),
        full_local_wordpress:fullLocalWordPress,
        ftp_mirror:mirror,
        db_host_class:dbHostClass,
        table_prefix:config.table_prefix || null,
        local_wp_cli_reliable:fullLocalWordPress,
        direct_local_mysql_recommended:dbHostClass === 'remote-or-dns',
        persistent_bridge_configured:!!persistent,
        site_url_candidates:siteUrlCandidates(project,ftp),
        preferred_path:persistent ? 'authenticated_server_bridge' : mirror ? 'guarded_one_shot_server_helper' : fullLocalWordPress ? 'local_wordpress_runtime' : 'capability_required'
      }
    };
  }

  async function verifyTask(ref, taskId) {
    const id = String(taskId || '').trim();
    if (!id) throw chatError('DATABASE_TASK_REQUIRED','This database path needs the current task_id.');
    const status = await api.workStatus(id);
    const project = projectOf(ref);
    if (!status || status.status !== 'active') throw chatError('DATABASE_TASK_REQUIRED','Database mutation requires an active task.');
    if (String(status.project_id || status.project || '') !== String(project.id)) throw chatError('PROJECT_SCOPE_VIOLATION','Database task belongs to another project.');
    return { id, status, project };
  }

  async function probeSite(candidates) {
    for (const base of candidates.slice(0,3)) {
      try {
        const response = await fetchImpl(`${base}/wp-json/`, { method:'GET', redirect:'manual', signal:AbortSignal.timeout(4500), headers:{ accept:'application/json' } });
        if (response.ok) return base;
      } catch {}
    }
    return '';
  }

  async function callPersistent(config, body) {
    const response = await fetchImpl(config.url, {
      method:'POST', redirect:'manual', signal:AbortSignal.timeout(15000),
      headers:{ 'content-type':'application/json','authorization':`Bearer ${config.token}` },
      body:JSON.stringify(body)
    });
    return parseJsonResponse(response);
  }

  function rememberRecovery(taskId, projectId, descriptor) {
    if (!descriptor || typeof descriptor !== 'object') return null;
    const id = crypto.randomUUID();
    recoveries.set(id,{ task_id:String(taskId), project_id:String(projectId), descriptor, created_at:Date.now() });
    while (recoveries.size > MAX_RECOVERY_POINTS) recoveries.delete(recoveries.keys().next().value);
    return id;
  }

  async function oneShot(ref, taskId, body, siteUrl = '') {
    const { id, project } = await verifyTask(ref,taskId);
    const topo = topology(ref);
    if (!topo.ftp) throw chatError('DATABASE_SERVER_PATH_UNAVAILABLE','No FTP configuration is available for the guarded one-shot server helper.');
    const base = siteUrl || await probeSite(topo.public.site_url_candidates);
    if (!base) throw chatError('DATABASE_SITE_URL_UNRESOLVED','Could not verify a WordPress site URL for this FTP mirror.', { candidates:topo.public.site_url_candidates, next_action:'Add siteUrl/websiteUrl to .vscode/sftp.json or configure chatcodeDatabase bridge.' });
    const nonce = crypto.randomBytes(12).toString('hex');
    const token = crypto.randomBytes(32).toString('hex');
    const rel = `wp-content/chatcode-db-once-${nonce}.php`;
    const helper = buildOneShotHelper(token, Math.floor(Date.now()/1000) + HELPER_TTL_SEC);
    const createPatch = createFilePatch(rel,helper);
    const deletePatch = deleteFilePatch(rel,helper);
    let localCreated = false;
    try {
      await api.applyPatch(project.id,createPatch,id);
      localCreated = true;
      const deployed = await deployImpl(api,store,project.id,[rel],id,{ explicit:true, owned_helper:true });
      if (deployed?.ok !== true) throw chatError('DATABASE_SERVER_PATH_UNAVAILABLE','Could not deploy guarded database helper.', { ftp_deploy:deployed });
      const response = await fetchImpl(`${base}/${rel}`, {
        method:'POST', redirect:'manual', signal:AbortSignal.timeout(20000),
        headers:{ 'content-type':'application/json','x-chatcode-token':token }, body:JSON.stringify(body)
      });
      const result = await parseJsonResponse(response);
      return { ...result, transport:'guarded_one_shot_server_helper', site_url:base };
    } finally {
      try { await deleteRemoteImpl(api,store,project.id,rel,id); } catch {}
      if (localCreated) try { await api.applyPatch(project.id,deletePatch,id); } catch {}
    }
  }

  async function callBestPath(ref, taskId, body) {
    const topo = topology(ref);
    if (topo.persistent) {
      try {
        const result = await callPersistent(topo.persistent,body);
        return { ...result, transport:'authenticated_server_bridge' };
      } catch (error) {
        if (!taskId) throw error;
      }
    }
    return oneShot(ref,taskId,body);
  }

  async function databaseOp(ref, input = {}) {
    const action = String(input.action || 'inspect').trim().toLowerCase();
    if (action === 'inspect') {
      const topo = topology(ref);
      let verifiedSite = '';
      if (input.probe_remote === true) verifiedSite = await probeSite(topo.public.site_url_candidates);
      return { ok:true, action:'inspect', ...topo.public, verified_site_url:verifiedSite || null, fallback_order:['authenticated_server_bridge','remote_wp_cli_if_configured','direct_remote_mysql_if_reachable','wordpress_rest_for_objects','guarded_one_shot_server_helper'] };
    }
    if (action === 'query') {
      const sql = validateReadSql(input.sql);
      const maxRows = Math.min(MAX_QUERY_ROWS,Math.max(1,Number(input.max_rows)||100));
      const result = await callBestPath(ref,input.task_id,{ action:'query', sql, params:Array.isArray(input.params)?input.params.slice(0,50):[], max_rows:maxRows });
      return { ok:true, action:'query', rows:result.rows || [], row_count:Number(result.row_count||0), transport:result.transport, site_url:result.site_url || null };
    }
    if (action === 'mutate') {
      const task = await verifyTask(ref,input.task_id);
      const validated = validateMutation(input.operation,input.payload,input.max_rows);
      const result = await callBestPath(ref,task.id,{ action:'mutate', operation:validated.operation, payload:validated.payload, max_rows:validated.max_rows });
      const recoveryId = rememberRecovery(task.id,task.project.id,result.recovery);
      return { ok:true, action:'mutate', operation:validated.operation, changed:result.changed !== false, no_op:!!result.no_op, affected_count:result.affected_count ?? null, post_id:result.post_id ?? null, insert_id:result.insert_id ?? null, recovery_id:recoveryId, transport:result.transport, site_url:result.site_url || null };
    }
    if (action === 'rollback') {
      const task = await verifyTask(ref,input.task_id);
      const recoveryId = String(input.recovery_id || '');
      const item = recoveries.get(recoveryId);
      if (!item || item.task_id !== task.id || item.project_id !== String(task.project.id)) throw chatError('DATABASE_RECOVERY_NOT_FOUND','Recovery point is missing, expired, or belongs to another task/project.');
      const result = await callBestPath(ref,task.id,{ action:'rollback', recovery:item.descriptor });
      if (result.rolled_back) recoveries.delete(recoveryId);
      return { ok:!!result.rolled_back, action:'rollback', recovery_id:recoveryId, rolled_back:!!result.rolled_back, transport:result.transport, site_url:result.site_url || null };
    }
    throw chatError('DATABASE_ACTION_INVALID',`Unsupported database action: ${action}`);
  }

  return { databaseOp, topology, recoveries };
}

function installDatabaseRuntimePatches() {
  const safety = require('./safety-tools');
  if (safety.__databaseRuntimePatched) return;
  safety.__databaseRuntimePatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function databaseAwareSafeToolApi(projects,store,approvals,backups,options) {
    const api = previousCreate(projects,store,approvals,backups,options);
    const runtime = createDatabaseApi(api,store);
    api.databaseOp = (ref,input) => runtime.databaseOp(ref,input);
    return api;
  };
}

module.exports = {
  MAX_QUERY_ROWS,
  MAX_MUTATION_ROWS,
  HELPER_TTL_SEC,
  HELPER_RE,
  classifyDbHost,
  parseWpConfig,
  siteUrlCandidates,
  bridgeConfig,
  validateReadSql,
  validateMutation,
  createFilePatch,
  deleteFilePatch,
  buildOneShotHelper,
  createDatabaseApi,
  installDatabaseRuntimePatches
};
