'use strict';

// Reinstall in the existing site's database. No second database, user reset,
// DROP DATABASE, or execution of the old site's PHP is required.
function buildReinstallBootstrap() {
  return String.raw`
function cc_reinstall_plan_file() { return cc_transfer_root().'/reinstall.php'; }
function cc_reinstall_read_plan() {
  $file=cc_reinstall_plan_file();
  if (!is_file($file)) return null;
  if (is_link($file)) cc_fail('Kế hoạch cài đè không hợp lệ.',409,'REINSTALL_PLAN_INVALID');
  $raw=(string)file_get_contents($file); $header="<?php exit; ?>\n";
  $plan=strncmp($raw,$header,strlen($header))===0 ? json_decode(substr($raw,strlen($header)),true) : null;
  if (!is_array($plan) || ($plan['install_id'] ?? '')!==CC_INSTALL_ID) cc_fail('Kế hoạch cài đè không thuộc task này.',409,'REINSTALL_PLAN_INVALID');
  return $plan;
}
function cc_reinstall_save_plan($plan) {
  $root=cc_transfer_root();
  if (!is_dir($root) && !@mkdir($root,0700,true)) throw new Exception('Không lưu được kế hoạch cài đè.');
  @file_put_contents($root.'/.htaccess',"Require all denied\n");
  $file=cc_reinstall_plan_file(); $temporary=$file.'.tmp.php';
  if (file_put_contents($temporary,"<?php exit; ?>\n".json_encode($plan,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),LOCK_EX)===false) throw new Exception('Không ghi được kế hoạch cài đè.');
  @chmod($temporary,0600);
  if (!rename($temporary,$file)) throw new Exception('Không chốt được kế hoạch cài đè.');
}
function cc_config_literal($token) {
  if (!is_array($token) || $token[0]!==T_CONSTANT_ENCAPSED_STRING) return null;
  $quoted=$token[1]; $body=substr($quoted,1,-1);
  if ($quoted[0]==="'") return str_replace(array("\\'",'\\\\'),array("'",'\\'),$body);
  return preg_replace_callback('/\\\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|[nrtvef\\\\$"])/',function($m) {
    $map=array('n'=>"\n",'r'=>"\r",'t'=>"\t",'v'=>"\v",'e'=>chr(27),'f'=>"\f",'\\'=>'\\','$'=>'$','"'=>'"');
    if (isset($map[$m[1]])) return $map[$m[1]];
    return $m[1][0]==='x' ? chr(hexdec(substr($m[1],1))) : chr(octdec($m[1]) & 255);
  },$body);
}
function cc_reinstall_config($file) {
  if (is_link($file)) cc_fail('Không cài đè qua wp-config.php là liên kết ngoài.',409,'REINSTALL_CONFIG_UNSUPPORTED');
  $source=file_get_contents($file);
  if ($source===false) cc_fail('Không đọc được wp-config.php hiện tại.',409,'REINSTALL_CONFIG_UNREADABLE');
  $tokens=array_values(array_filter(token_get_all($source),function($t) { return !is_array($t) || !in_array($t[0],array(T_WHITESPACE,T_COMMENT,T_DOC_COMMENT,T_OPEN_TAG),true); }));
  $values=array(); $wanted=array('DB_NAME','DB_USER','DB_PASSWORD','DB_HOST','MULTISITE','CUSTOM_USER_TABLE','CUSTOM_USER_META_TABLE');
  for ($i=0,$n=count($tokens);$i<$n;$i++) {
    $t=$tokens[$i];
    if (is_array($t) && $t[0]===T_STRING && strtolower($t[1])==='define' && ($tokens[$i+1] ?? '')==='(') {
      $key=cc_config_literal($tokens[$i+2] ?? null);
      if (!in_array($key,$wanted,true)) continue;
      if (array_key_exists($key,$values) || ($tokens[$i+3] ?? '')!==',') cc_fail('wp-config.php có cấu hình động/trùng; chưa thể xác định đúng database.',409,'REINSTALL_CONFIG_UNSUPPORTED');
      $literal=cc_config_literal($tokens[$i+4] ?? null);
      if ($key==='MULTISITE' && is_array($tokens[$i+4] ?? null)) $literal=strtolower($tokens[$i+4][1]);
      if ($literal===null || !in_array($tokens[$i+5] ?? '',array(')',','),true)) cc_fail('Cần giá trị database trực tiếp trong wp-config.php để cài đè; không chạy mã PHP cũ.',409,'REINSTALL_CONFIG_UNSUPPORTED');
      $values[$key]=$literal;
    }
    if (is_array($t) && $t[0]===T_VARIABLE && $t[1]==='$table_prefix' && ($tokens[$i+1] ?? '')==='=') {
      if (isset($values['prefix'])) cc_fail('Có nhiều table_prefix trong wp-config.php.',409,'REINSTALL_CONFIG_UNSUPPORTED');
      $values['prefix']=cc_config_literal($tokens[$i+2] ?? null);
      if (($tokens[$i+3] ?? '')!==';') $values['prefix']=null;
    }
  }
  foreach (array('DB_NAME','DB_USER','DB_PASSWORD','DB_HOST','prefix') as $key) {
    if (!isset($values[$key]) || ($key!=='DB_PASSWORD' && $values[$key]==='')) cc_fail('Không xác định đủ database và table_prefix từ wp-config.php.',409,'REINSTALL_CONFIG_UNSUPPORTED');
  }
  if (!preg_match('/^[A-Za-z0-9_]{1,50}$/D',$values['prefix'])) cc_fail('Table prefix cũ không hợp lệ.',409,'REINSTALL_CONFIG_UNSUPPORTED');
  if (!in_array($values['MULTISITE'] ?? 'false',array('false','0',''),true) || isset($values['CUSTOM_USER_TABLE']) || isset($values['CUSTOM_USER_META_TABLE'])) cc_fail('Không tự cài đè multisite hoặc bảng user dùng chung.',409,'REINSTALL_SHARED_DATABASE');
  return array('name'=>$values['DB_NAME'],'user'=>$values['DB_USER'],'password'=>$values['DB_PASSWORD'],'host'=>$values['DB_HOST'],'prefix'=>$values['prefix']);
}
function cc_db_identifier($name) { return chr(96).str_replace(chr(96),chr(96).chr(96),$name).chr(96); }
function cc_reinstall_site_key($url) {
  $parts=parse_url((string)$url);
  return strtolower(preg_replace('/^www\./i','',(string)($parts['host'] ?? ''))).':'.(string)($parts['port'] ?? '').'/'.trim((string)($parts['path'] ?? ''),'/');
}
function cc_reinstall_tables($db,$candidate,$data) {
  $result=$db->query('SHOW FULL TABLES');
  if (!$result) cc_fail('Không đọc được danh sách bảng cũ.',409,'REINSTALL_TABLES_UNREADABLE');
  $all=array(); while ($row=$result->fetch_row()) $all[$row[0]]=$row[1];
  $old=$candidate['prefix']; $new=(string)$data['tablePrefix'];
  if ($old===$new) cc_fail('Tiền tố bản mới trùng bản đang chạy.',409,'REINSTALL_PREFIX_CONFLICT');
  foreach ($all as $name=>$type) if (strncmp($name,$new,strlen($new))===0) cc_fail('Tiền tố bản mới đã có bảng; không ghi đè ngoài kế hoạch.',409,'REINSTALL_PREFIX_CONFLICT');
  if (!isset($all[$old.'options'])) cc_fail('Không tìm thấy bảng options của WordPress cũ.',409,'REINSTALL_SITE_UNCONFIRMED');
  $options=$db->query('SELECT option_value FROM '.cc_db_identifier($old.'options')." WHERE option_name='siteurl' LIMIT 1");
  $row=$options ? $options->fetch_row() : null;
  if (!$row || cc_reinstall_site_key($row[0])!==cc_reinstall_site_key($data['siteUrl'])) cc_fail('Database trong wp-config.php không khớp website cần cài đè.',409,'REINSTALL_SITE_UNCONFIRMED');
  // A database may contain another site's prefix nested under wp_. Exclude it.
  $foreign=array();
  foreach ($all as $name=>$type) {
    if ($name===$old.'options' || substr($name,-7)!=='options') continue;
    $prefix=substr($name,0,-7);
    $other=@$db->query('SELECT option_value FROM '.cc_db_identifier($name)." WHERE option_name='siteurl' LIMIT 1");
    if ($other && $other->fetch_row()) $foreign[]=$prefix;
  }
  $owned=array();
  foreach ($all as $name=>$type) {
    if (strncmp($name,$old,strlen($old))!==0) continue;
    $skip=false; foreach ($foreign as $prefix) if (strncmp($name,$prefix,strlen($prefix))===0) $skip=true;
    if (!$skip) $owned[]=array('name'=>$name,'type'=>$type==='VIEW'?'VIEW':'TABLE');
  }
  return $owned;
}
function cc_reinstall_resolve($data) {
  $plan=cc_reinstall_read_plan();
  $config=__DIR__.'/wp-config.php';
  if (!$plan && !is_file($config)) {
    if (is_file(__DIR__.'/wp-includes/version.php')) cc_fail('Website cũ thiếu wp-config.php; cần khôi phục file đó để dùng đúng database. Không tạo thêm database.',409,'REINSTALL_CONFIG_MISSING');
    return $data;
  }
  if (empty($data['clearRemote'])) cc_fail('Cài đè sẽ xóa dữ liệu WordPress cũ; cần xác nhận cài đè.',409,'SITE_NOT_EMPTY');
  if (!$plan) {
    $candidate=cc_reinstall_config($config);
    $opened=cc_db_open($candidate);
    if (!$opened['db']) cc_fail('Không kết nối được database hiện tại từ wp-config.php; giữ nguyên website và không tạo database khác.',409,'DB_REUSE_CONNECT_FAILED',array('mysqlErrno'=>$opened['errno']));
    $tables=cc_reinstall_tables($opened['db'],$candidate,$data); $opened['db']->close();
    $plan=array('install_id'=>CC_INSTALL_ID,'new_prefix'=>$data['tablePrefix'],'candidate'=>$candidate,'tables'=>$tables,'state'=>'preparing','site_url'=>$data['siteUrl']);
    cc_reinstall_save_plan($plan);
  }
  if (($plan['new_prefix'] ?? '')!==$data['tablePrefix'] || cc_reinstall_site_key($plan['site_url'])!==cc_reinstall_site_key($data['siteUrl'])) cc_fail('Task không khớp kế hoạch database đã lưu.',409,'REINSTALL_PLAN_INVALID');
  foreach (array('dbName'=>'name','dbUser'=>'user','dbPassword'=>'password','dbHost'=>'host') as $key=>$field) $data[$key]=$plan['candidate'][$field];
  $data['reuseExistingDatabase']=true;
  return $data;
}
function cc_reinstall_retire_tables($db) {
  $plan=cc_reinstall_read_plan(); if (!$plan || $plan['state']!=='preparing') return;
  // This exact snapshot was taken BEFORE new-prefix tables were created.
  // Never use DROP DATABASE or a wildcard prefix deletion here.
  if (!$db->query('SET FOREIGN_KEY_CHECKS=0')) throw new Exception('Không chuẩn bị được bước thay bảng cũ.');
  try {
    foreach (array('VIEW','TABLE') as $type) {
      $names=array();
      foreach ($plan['tables'] as $table) {
        if ($table['type']!==$type) continue;
        if (strncmp($table['name'],$plan['candidate']['prefix'],strlen($plan['candidate']['prefix']))!==0 || strncmp($table['name'],$plan['new_prefix'],strlen($plan['new_prefix']))===0) cc_fail('Bảng ngoài phạm vi cài đè.',409,'REINSTALL_PLAN_INVALID');
        $names[]=cc_db_identifier($table['name']);
      }
      foreach (array_chunk($names,40) as $batch) if (!$db->query('DROP '.$type.' IF EXISTS '.implode(',',$batch))) cc_fail('Chưa thay hết bảng WordPress cũ. Thử lại đúng task; không tạo task khác.',409,'REINSTALL_TABLE_RESET_FAILED');
    }
  } finally { $db->query('SET FOREIGN_KEY_CHECKS=1'); }
}
function cc_reinstall_publish($data,$result=null) {
  $plan=cc_reinstall_read_plan();
  if ($result===null && (!$plan || !in_array($plan['state'],array('ready','publishing'),true))) return false;
  if ($plan && $result!==null) { $plan['state']='ready'; $plan['result']=$result; cc_reinstall_save_plan($plan); }
  if ($plan && !in_array($plan['state'],array('ready','publishing'),true)) return false;
  if ($plan) {
    $opened=cc_db_open($plan['candidate']);
    if (!$opened['db'] || !$opened['db']->query('DROP TABLE IF EXISTS '.cc_db_identifier($plan['new_prefix'].'chatcode_install_marker'))) cc_fail('Chưa dọn được checkpoint database; thử lại đúng task.',409,'REINSTALL_PUBLISH_PENDING');
    $opened['db']->close();
  }
  if (!$plan || $plan['state']==='ready') {
    $removed=cc_prepare_remote_root($data);
    if ($plan) { $plan['state']='publishing'; $plan['result']['clearedEntries']=array_slice($removed,0,20); cc_reinstall_save_plan($plan); }
    else $result['clearedEntries']=array_slice($removed,0,20);
  }
  cc_publish(cc_stage());
  if ($plan) { $plan['state']='published'; cc_reinstall_save_plan($plan); $result=$plan['result']; }
  if (CC_THEME_PACKAGE!=='') @unlink(__DIR__.'/'.CC_THEME_PACKAGE);
  $plugin=(array)($data['plugin'] ?? array());
  if (!empty($plugin['fallback_package'])) @unlink(__DIR__.'/'.basename($plugin['fallback_package']));
  cc_answer(true,'Đã cài WordPress.',$result);
}
`;
}
module.exports = { buildReinstallBootstrap };
