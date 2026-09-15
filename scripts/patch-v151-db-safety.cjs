const fs = require('fs');
function rep(file,before,after){let s=fs.readFileSync(file,'utf8');if(!s.includes(before))throw new Error(`${file}: marker missing`);fs.writeFileSync(file,s.replace(before,after));}

rep('core/database-runtime.js',
"const { chatError } = require('./errors');\nconst { deployChangedFiles, deleteOwnedRemoteFile } = require('./ftp-deploy');",
"const { chatError } = require('./errors');\nconst { validateBricksJson } = require('./bricks-validator');\nconst { deployChangedFiles, deleteOwnedRemoteFile } = require('./ftp-deploy');");
rep('core/database-runtime.js',
"const BRICKS_META_KEYS = new Set([\n  '_bricks_page_content_2','_bricks_page_header_2','_bricks_page_footer_2',\n  '_bricks_page_settings','_bricks_template_settings'\n]);",
"const BRICKS_TREE_META_KEYS = new Set(['_bricks_page_content_2','_bricks_page_header_2','_bricks_page_footer_2']);\nconst BRICKS_META_KEYS = new Set([...BRICKS_TREE_META_KEYS,'_bricks_page_settings','_bricks_template_settings']);");
rep('core/database-runtime.js',
"    return `${url.protocol}//${url.host}`;",
"    const pathname = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\\/+$/,'') : '';\n    return `${url.protocol}//${url.host}${pathname}`;");
rep('core/database-runtime.js',
"    if (op === 'bricks_update_meta' && !BRICKS_META_KEYS.has(String(data.key))) throw chatError('DATABASE_MUTATION_INVALID','Unsupported Bricks meta key.');\n  }",
`    if (op === 'bricks_update_meta' && !BRICKS_META_KEYS.has(String(data.key))) throw chatError('DATABASE_MUTATION_INVALID','Unsupported Bricks meta key.');
    if (op === 'bricks_update_meta' && !Object.prototype.hasOwnProperty.call(data,'expected_current')) throw chatError('DATABASE_CURRENT_STATE_REQUIRED','bricks_update_meta requires expected_current from the current task read.');
    if (op === 'bricks_update_meta' && BRICKS_TREE_META_KEYS.has(String(data.key))) {
      const validation = validateBricksJson(data.value, {}, { mode:'write' });
      if (!validation.recognized || !validation.ok) throw chatError('DATABASE_BRICKS_TREE_INVALID','Bricks persisted tree is not canonical/valid for write.', { errors:validation.errors?.slice?.(0,8) || [] });
    }
  }`);

rep('core/database-runtime.js',
"if ($op === 'update_meta' || $op === 'bricks_update_meta') {\n  $id = intval($p['post_id']); $key = (string)$p['key']; $exists = metadata_exists('post',$id,$key); $before = $exists ? get_post_meta($id,$key,true) : null;\n  $result = update_post_meta($id,$key,$p['value']);\n  cc_out(array('ok'=>$result !== false,'changed'=>$result !== false,'recovery'=>array('kind'=>'restore_meta','post_id'=>$id,'key'=>$key,'existed'=>$exists,'value'=>$before)), $result !== false ? 200 : 409);\n}",
`if ($op === 'update_meta' || $op === 'bricks_update_meta') {
  $id = intval($p['post_id']); $key = (string)$p['key']; $exists = metadata_exists('post',$id,$key); $before = $exists ? get_post_meta($id,$key,true) : null;
  if ($op === 'bricks_update_meta') {
    if (!array_key_exists('expected_current',$p)) cc_out(array('ok'=>false,'error'=>'current_state_required'),409);
    if (maybe_serialize($before) !== maybe_serialize($p['expected_current'])) cc_out(array('ok'=>false,'error'=>'current_state_mismatch'),409);
  }
  $result = update_post_meta($id,$key,$p['value']);
  $after = get_post_meta($id,$key,true);
  if (maybe_serialize($after) !== maybe_serialize($p['value'])) {
    if ($exists) update_post_meta($id,$key,$before); else delete_post_meta($id,$key);
    cc_out(array('ok'=>false,'error'=>'verify_failed'),409);
  }
  cc_out(array('ok'=>true,'changed'=>$result !== false || maybe_serialize($before) !== maybe_serialize($after),'read_back_verified'=>true,'recovery'=>array('kind'=>'restore_meta','post_id'=>$id,'key'=>$key,'existed'=>$exists,'value'=>$before)));
}`);
rep('core/database-runtime.js',
"if ($op === 'update_option') {\n  $key = (string)$p['key']; $sentinel = new stdClass(); $before = get_option($key,$sentinel); $exists = $before !== $sentinel;\n  $result = update_option($key,$p['value'],false);\n  cc_out(array('ok'=>true,'changed'=>(bool)$result,'recovery'=>array('kind'=>'restore_option','key'=>$key,'existed'=>$exists,'value'=>$exists?$before:null)));\n}",
`if ($op === 'update_option') {
  $key = (string)$p['key']; $sentinel = new stdClass(); $before = get_option($key,$sentinel); $exists = $before !== $sentinel;
  $result = update_option($key,$p['value'],false); $after = get_option($key,$sentinel);
  if ($after === $sentinel || maybe_serialize($after) !== maybe_serialize($p['value'])) {
    if ($exists) update_option($key,$before,false); else delete_option($key);
    cc_out(array('ok'=>false,'error'=>'verify_failed'),409);
  }
  cc_out(array('ok'=>true,'changed'=>(bool)$result,'read_back_verified'=>true,'recovery'=>array('kind'=>'restore_option','key'=>$key,'existed'=>$exists,'value'=>$exists?$before:null)));
}`);
rep('core/database-runtime.js',
"  $remaining = intval($wpdb->get_var($verifySql));\n  if ($op === 'wpdb_delete' && $remaining !== 0) { $wpdb->query('ROLLBACK'); cc_out(array('ok'=>false,'error'=>'verify_failed'),409); }\n  if ($op === 'wpdb_update' && $remaining !== $count) { $wpdb->query('ROLLBACK'); cc_out(array('ok'=>false,'error'=>'verify_failed'),409); }\n  $wpdb->query('COMMIT');",
`  $remaining = intval($wpdb->get_var($verifySql));
  if ($op === 'wpdb_delete' && $remaining !== 0) { $wpdb->query('ROLLBACK'); cc_out(array('ok'=>false,'error'=>'verify_failed'),409); }
  if ($op === 'wpdb_update' && $remaining !== $count) { $wpdb->query('ROLLBACK'); cc_out(array('ok'=>false,'error'=>'verify_failed'),409); }
  if ($op === 'wpdb_update') {
    $verifyRows = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$table} WHERE {$pk} IN ({$placeholders})", $ids), ARRAY_A);
    $byPk = array(); foreach ($verifyRows as $row) $byPk[(string)$row[$pk]] = $row;
    foreach ($rows as $beforeRow) foreach ($p['data'] as $col=>$expected) {
      $actualRow = isset($byPk[(string)$beforeRow[$pk]]) ? $byPk[(string)$beforeRow[$pk]] : null;
      if (!$actualRow || maybe_serialize($actualRow[$col]) !== maybe_serialize($expected)) { $wpdb->query('ROLLBACK'); cc_out(array('ok'=>false,'error'=>'verify_failed'),409); }
    }
  }
  $wpdb->query('COMMIT');`);

rep('core/database-runtime.js',
"  BRICKS_META_KEYS = new Set([",
"  BRICKS_META_KEYS = new Set([" ); // noop guard marker intentionally impossible below
