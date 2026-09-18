const crypto = require('crypto');
const { buildTransferBootstrap } = require('./fresh-install-transfer-bootstrap');
const { buildDatabaseBootstrap } = require('./fresh-install-database');

function phpString(value) {
  return String(value || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

function buildFreshInstallBootstrap({ token, installId, bridgeName, themePackageName = '', themeSha256 = '', themeSlug = '', themeEntry = '', themeArchiveLayout = 'wrapped' }) {
  return String.raw`<?php
@set_time_limit(0);
@ini_set('memory_limit','512M');
@ini_set('display_errors','0');
@ignore_user_abort(true);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
const CC_TOKEN = '${phpString(token)}';
const CC_INSTALL_ID = '${phpString(installId)}';
const CC_BRIDGE_NAME = '${phpString(bridgeName)}';
const CC_THEME_PACKAGE = '${phpString(themePackageName)}';
const CC_THEME_SHA256 = '${phpString(themeSha256)}';
const CC_THEME_SLUG = '${phpString(themeSlug)}';
const CC_THEME_ENTRY = '${phpString(themeEntry)}';
const CC_THEME_LAYOUT = '${phpString(themeArchiveLayout === 'flat' ? 'flat' : 'wrapped')}';
${buildTransferBootstrap()}
function cc_answer($ok, $message, $extra=array(), $status=200, $code='') {
  http_response_code($status);
  $base = array('ok'=>(bool)$ok,'message'=>(string)$message);
  if ($code !== '') $base['code'] = $code;
  echo json_encode(array_merge($base,$extra));
  exit;
}
function cc_fail($message,$status=500,$code='INSTALL_FAILED',$extra=array()) {
  cc_answer(false,$message,$extra,$status,$code);
}
function cc_safe_name($value) { return preg_replace('/[^A-Za-z0-9_.-]/','',(string)$value); }
function cc_cleanup_upload_artifacts() {
  foreach ((array)@scandir(__DIR__) as $name) {
    if (!is_string($name) || strpos($name,'.chatcode-') !== 0) continue;
    if (preg_match('/\.part-[0-9]{3}-of-[0-9]{3}$/',$name) || substr($name,-11) === '.assembling') @unlink(__DIR__ . DIRECTORY_SEPARATOR . $name);
  }
}
function cc_config_quote($value) { return str_replace(array('\\',"'"),array('\\\\',"\\'"),(string)$value); }
function cc_remove_tree($path) {
  if (!file_exists($path)) return;
  if (is_link($path) || is_file($path)) { @unlink($path); return; }
  $items = @scandir($path);
  if (!is_array($items)) return;
  foreach ($items as $name) if ($name !== '.' && $name !== '..') cc_remove_tree($path . DIRECTORY_SEPARATOR . $name);
  @rmdir($path);
}
function cc_allowed_root_entries($data=array()) {
  $allowed = array('.', '..', '.well-known', '.ftpquota', CC_BRIDGE_NAME, basename(cc_stage()), basename(cc_transfer_root()));
  if (CC_THEME_PACKAGE !== '') $allowed[] = CC_THEME_PACKAGE;
  if (!empty($data['corePackage'])) $allowed[] = basename((string)$data['corePackage']);
  $plugin=(array)($data['plugin'] ?? array());
  if (!empty($plugin['fallback_package'])) $allowed[] = basename((string)$plugin['fallback_package']);
  return array_values(array_unique($allowed));
}
function cc_blocking_entries($data=array()) {
  $allowed = cc_allowed_root_entries($data); $out = array();
  foreach ((array)@scandir(__DIR__) as $name) { if (!in_array($name,$allowed,true)) $out[] = $name; }
  return array_values(array_unique($out));
}
function cc_prepare_remote_root($data=array()) {
  $blocking = cc_blocking_entries($data);
  if (!$blocking) return array();
  if (empty($data['clearRemote'])) cc_fail('Thư mục website đang có nội dung.',409,'SITE_NOT_EMPTY',array('blockingEntries'=>array_slice($blocking,0,20)));
  foreach ($blocking as $name) cc_remove_tree(__DIR__ . DIRECTORY_SEPARATOR . $name);
  $remaining = cc_blocking_entries($data);
  if ($remaining) cc_fail('Không dọn hết nội dung cũ trên hosting.',500,'REMOTE_WIPE_FAILED',array('blockingEntries'=>array_slice($remaining,0,20)));
  return $blocking;
}
function cc_stage() { return __DIR__ . DIRECTORY_SEPARATOR . '.chatcode-install-' . substr(CC_INSTALL_ID,0,12); }
function cc_marker() { return __DIR__ . DIRECTORY_SEPARATOR . '.chatcode-install-id'; }
function cc_same_install_live() {
  return is_file(cc_marker()) && hash_equals(CC_INSTALL_ID, trim((string)@file_get_contents(cc_marker()))) && is_file(__DIR__.'/wp-includes/version.php');
}
function cc_download_https($url,$target,$maxBytes=157286400) {
  $parts = parse_url((string)$url);
  if (!is_array($parts) || strtolower((string)($parts['scheme'] ?? '')) !== 'https' || empty($parts['host'])) throw new Exception('Download URL bắt buộc dùng HTTPS.');
  $temporary = $target . '.part'; @unlink($temporary);
  $fh = @fopen($temporary,'wb');
  if (!$fh) throw new Exception('Không tạo được file download tạm.');
  $written = 0;
  try {
    if (function_exists('curl_init')) {
      $curl = curl_init($url);
      curl_setopt($curl,CURLOPT_FOLLOWLOCATION,true);
      curl_setopt($curl,CURLOPT_MAXREDIRS,4);
      curl_setopt($curl,CURLOPT_CONNECTTIMEOUT,12);
      curl_setopt($curl,CURLOPT_TIMEOUT,240);
      curl_setopt($curl,CURLOPT_USERAGENT,'ChatCode-Fresh/1.0');
      curl_setopt($curl,CURLOPT_WRITEFUNCTION,function($curl,$data) use ($fh,&$written,$maxBytes) {
        $written += strlen($data);
        if ($written > $maxBytes) return 0;
        return fwrite($fh,$data);
      });
      $ok = curl_exec($curl); $status = (int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);
      $effective = (string)curl_getinfo($curl,CURLINFO_EFFECTIVE_URL); $error = (string)curl_error($curl); curl_close($curl);
      if (!$ok || $status < 200 || $status >= 300 || $written <= 0) throw new Exception('Không tải được package: ' . ($error !== '' ? $error : 'HTTP '.$status));
      $effectiveParts = parse_url($effective);
      if (!is_array($effectiveParts) || strtolower((string)($effectiveParts['scheme'] ?? '')) !== 'https') throw new Exception('Package redirect sang URL không an toàn.');
    } else {
      $context = stream_context_create(array('http'=>array('timeout'=>240,'follow_location'=>1,'max_redirects'=>4,'user_agent'=>'ChatCode-Fresh/1.0')));
      $source = @fopen($url,'rb',false,$context);
      if (!$source) throw new Exception('Hosting không có cURL và không mở được HTTPS stream.');
      try {
        while (!feof($source)) {
          $block = fread($source,1048576);
          if ($block === false) throw new Exception('Đọc package thất bại.');
          $written += strlen($block);
          if ($written > $maxBytes) throw new Exception('Package vượt giới hạn dung lượng.');
          if ($block !== '' && fwrite($fh,$block) === false) throw new Exception('Ghi package thất bại.');
        }
      } finally { fclose($source); }
    }
  } finally { fclose($fh); }
  if (!is_file($temporary) || filesize($temporary) <= 0) { @unlink($temporary); throw new Exception('Package tải về bị trống.'); }
  if (!@rename($temporary,$target)) { @unlink($temporary); throw new Exception('Không chốt được package tải về.'); }
  return $target;
}
function cc_validate_zip($zipPath,$requiredEntries=array()) {
  if (!class_exists('ZipArchive')) throw new Exception('Hosting chưa bật PHP ZipArchive.');
  if (!is_file($zipPath)) throw new Exception('Không tìm thấy package ZIP.');
  $zip = new ZipArchive();
  if ($zip->open($zipPath) !== true) throw new Exception('Không mở được package ZIP.');
  $seen = array(); $files = 0; $bytes = 0;
  try {
    for ($i=0;$i<$zip->numFiles;$i++) {
      $raw = str_replace('\\','/',(string)$zip->getNameIndex($i));
      if ($raw === '' || $raw[0] === '/' || strpos($raw,"\0") !== false || preg_match('#(^|/)\.\.(/|$)#',$raw)) throw new Exception('Package chứa đường dẫn không an toàn.');
      $seen[$raw] = true;
      if (substr($raw,-1) === '/') continue;
      $stat = $zip->statIndex($i); $files++; $bytes += is_array($stat) ? (int)$stat['size'] : 0;
      if ($files > 30000 || $bytes > 536870912) throw new Exception('Package vượt giới hạn an toàn.');
      if (method_exists($zip,'getExternalAttributesIndex')) {
        $opsys=0; $attributes=0;
        if ($zip->getExternalAttributesIndex($i,$opsys,$attributes) && ((($attributes >> 16) & 0170000) === 0120000)) throw new Exception('Package chứa symbolic link.');
      }
    }
    foreach ($requiredEntries as $entry) if (!isset($seen[$entry])) throw new Exception('Package thiếu file bắt buộc: '.$entry);
  } finally { $zip->close(); }
  return true;
}
function cc_extract_zip($zipPath,$destination) {
  $zip = new ZipArchive();
  if ($zip->open($zipPath) !== true) throw new Exception('Không mở được ZIP để giải nén.');
  try { if (!$zip->extractTo($destination)) throw new Exception('Không giải nén được package.'); }
  finally { $zip->close(); }
}
function cc_move_children($from,$to) {
  foreach ((array)@scandir($from) as $name) {
    if ($name === '.' || $name === '..') continue;
    $src = $from . DIRECTORY_SEPARATOR . $name; $dst = $to . DIRECTORY_SEPARATOR . $name;
    if (file_exists($dst)) cc_remove_tree($dst);
    if (!@rename($src,$dst)) throw new Exception('Không chuyển được '.$name.' sang staging root.');
  }
}
function cc_fetch_json($url) {
  $target = cc_stage() . DIRECTORY_SEPARATOR . '.manifest-' . bin2hex(random_bytes(4)) . '.json';
  cc_download_https($url,$target,2097152); $raw = @file_get_contents($target); @unlink($target);
  $data = json_decode((string)$raw,true);
  if (!is_array($data)) throw new Exception('Update manifest không trả JSON hợp lệ.');
  return $data;
}
${buildDatabaseBootstrap()}
function cc_prepare_database($data) {
  if (!class_exists('mysqli')) throw new Exception('Hosting chưa bật PHP mysqli.');
  $selected=null; $detail=array(); $mysqli=cc_connect_database($data,$selected,$detail);
  if (!$mysqli || !$selected) {
    $panel=$detail['panel'] ?? array();
    $message='Không tự tạo/kết nối được database. DirectAdmin: HTTP '.(int)($panel['http_status'] ?? 0).' · '.($panel['message'] ?? 'Không truy cập được panel.');
    if (!empty($detail['mysql']['message'])) $message.=' · MySQL: '.$detail['mysql']['message'];
    cc_fail($message,409,$detail['code'] ?? 'DB_CONNECT_FAILED',array('databaseDetail'=>$detail));
  }
  $marker=(string)$data['tablePrefix'].'chatcode_install_marker';
  $tables=array(); $result=$mysqli->query('SHOW TABLES');
  if (!$result) throw new Exception('Không kiểm tra được database.');
  while ($row=$result->fetch_row()) if (strncmp((string)$row[0],(string)$data['tablePrefix'],strlen((string)$data['tablePrefix']))===0) $tables[]=(string)$row[0];
  $exists=in_array($marker,$tables,true);
  if (count($tables)>0 && !$exists) throw new Exception('Database đã có bảng dùng tiền tố này.');
  if ($exists) {
    $res=$mysqli->query('SELECT install_id FROM '.$marker.' LIMIT 1'); $row=$res?$res->fetch_assoc():null;
    if (!$row || !hash_equals(CC_INSTALL_ID,(string)$row['install_id'])) throw new Exception('Database thuộc một phiên cài đặt khác.');
  } else {
    if (!$mysqli->query('CREATE TABLE '.$marker.' (install_id VARCHAR(64) NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4')) throw new Exception('Không tạo được DB checkpoint.');
    $id=$mysqli->real_escape_string(CC_INSTALL_ID);
    if (!$mysqli->query("INSERT INTO ".$marker." (install_id) VALUES ('".$id."')")) throw new Exception('Không lưu được DB checkpoint.');
  }
  return array($mysqli,$marker,$selected);
}
function cc_prepare_wordpress($stage,$data) {
  if (is_file($stage.'/wp-includes/version.php')) return;
  $coreZip=$stage.'/wordpress.zip';
  if (!empty($data['corePackage']) && is_file(__DIR__.'/'.basename((string)$data['corePackage']))) {
    $coreZip=__DIR__.'/'.basename((string)$data['corePackage']);
  } else {
    try { cc_download_https('https://wordpress.org/latest.zip',$coreZip,104857600); }
    catch (Throwable $error) { cc_fail('Hosting không tự tải được WordPress: '.$error->getMessage(),502,'CORE_DOWNLOAD_FAILED'); }
  }
  cc_validate_zip($coreZip,array('wordpress/wp-admin/index.php','wordpress/wp-includes/version.php'));
  $extract=$stage.'/.core-extract'; cc_remove_tree($extract); @mkdir($extract,0755,true);
  cc_extract_zip($coreZip,$extract);
  if (!is_dir($extract.'/wordpress')) throw new Exception('WordPress ZIP sai cấu trúc.');
  cc_move_children($extract.'/wordpress',$stage); cc_remove_tree($extract);
  if ($coreZip === $stage.'/wordpress.zip') @unlink($coreZip);
}
function cc_prepare_theme($stage,$data) {
  $theme=(array)($data['theme'] ?? array()); $id=(string)($theme['id'] ?? 'wordpress-default');
  if ($id === 'wordpress-default') return '';
  if (CC_THEME_PACKAGE === '' || CC_THEME_SHA256 === '') throw new Exception('Thiếu managed theme package.');
  if (CC_THEME_SLUG === '' || !preg_match('/^[A-Za-z0-9._-]+$/',CC_THEME_SLUG)) throw new Exception('Theme slug không hợp lệ.');
  $package=__DIR__.'/'.CC_THEME_PACKAGE;
  if (!is_file($package) || !hash_equals(strtolower(CC_THEME_SHA256),strtolower(cc_transfer_sha($package)))) throw new Exception('Theme package checksum không khớp.');
  $required=CC_THEME_ENTRY !== '' ? array(CC_THEME_ENTRY) : array(); cc_validate_zip($package,$required);
  $themesRoot=$stage.'/wp-content/themes'; if (!is_dir($themesRoot)) @mkdir($themesRoot,0755,true);
  if (CC_THEME_LAYOUT === 'flat') {
    $themeTarget=$themesRoot.'/'.CC_THEME_SLUG; cc_remove_tree($themeTarget);
    if (!@mkdir($themeTarget,0755,true) && !is_dir($themeTarget)) throw new Exception('Không tạo được thư mục theme.');
    cc_extract_zip($package,$themeTarget);
  } else { cc_extract_zip($package,$themesRoot); }
  if (!is_file($themesRoot.'/'.CC_THEME_SLUG.'/style.css')) throw new Exception('Theme package không tạo đúng theme slug.');
  if (!empty($theme['generated_child']) && CC_THEME_SLUG === 'bricks') {
    $child=$themesRoot.'/bricks-child'; if (!is_dir($child)) @mkdir($child,0755,true);
    file_put_contents($child.'/style.css',"/*\nTheme Name: Bricks Child\nTemplate: bricks\nVersion: 1.0.0\n*/\n",LOCK_EX);
    file_put_contents($child.'/functions.php',"<?php\ndefined('ABSPATH') || exit;\n",LOCK_EX);
  }
  return (string)($theme['active_theme'] ?? CC_THEME_SLUG);
}
function cc_prepare_duyanh($stage,$plugin) {
  $entry=(string)($plugin['entry'] ?? ''); $fallbackName=basename((string)($plugin['fallback_package'] ?? ''));
  $fallbackSha=strtolower((string)($plugin['fallback_sha256'] ?? '')); $vendorError='';
  try {
    $manifestUrl=(string)($plugin['manifest_url'] ?? '');
    if ($manifestUrl === '') throw new Exception('Thiếu DuyAnhWebPro update manifest.');
    $manifest=cc_fetch_json($manifestUrl);
    $download=(string)($manifest['download_url'] ?? $manifest['package'] ?? '');
    $checksum=strtolower((string)($manifest['checksum_sha256'] ?? $manifest['sha256'] ?? ''));
    $version=(string)($manifest['version'] ?? $plugin['fallback_version'] ?? '');
    $manifestHost=strtolower((string)(parse_url($manifestUrl,PHP_URL_HOST) ?: ''));
    $downloadHost=strtolower((string)(parse_url($download,PHP_URL_HOST) ?: ''));
    if ($download === '' || strtolower((string)parse_url($download,PHP_URL_SCHEME)) !== 'https' || $downloadHost === '' || $downloadHost !== $manifestHost) throw new Exception('DuyAnhWebPro update manifest trả download_url không an toàn.');
    if (!preg_match('/^[a-f0-9]{64}$/',$checksum)) throw new Exception('DuyAnhWebPro manifest thiếu SHA256 hợp lệ.');
    $zip=$stage.'/.duyanhwebpro-'.$version.'.zip'; cc_download_https($download,$zip,52428800);
    if (!hash_equals($checksum,strtolower(hash_file('sha256',$zip)))) throw new Exception('DuyAnhWebPro checksum không khớp.');
    cc_validate_zip($zip,array($entry)); $target=$stage.'/wp-content/plugins'; if (!is_dir($target)) @mkdir($target,0755,true);
    cc_extract_zip($zip,$target); @unlink($zip);
    if (!is_file($stage.'/wp-content/plugins/'.$entry)) throw new Exception('DuyAnhWebPro sau giải nén thiếu entrypoint.');
    return $version;
  } catch (Throwable $error) { $vendorError=$error->getMessage(); }
  if ($fallbackName !== '' && preg_match('/^[a-f0-9]{64}$/',$fallbackSha)) {
    $fallback=__DIR__.'/'.$fallbackName;
    if (!is_file($fallback) || !hash_equals($fallbackSha,strtolower(cc_transfer_sha($fallback)))) cc_fail('Fallback DuyAnhWebPro checksum không khớp.',409,'PLUGIN_FALLBACK_INVALID');
    cc_validate_zip($fallback,array($entry)); $target=$stage.'/wp-content/plugins'; if (!is_dir($target)) @mkdir($target,0755,true);
    cc_extract_zip($fallback,$target);
    if (!is_file($stage.'/wp-content/plugins/'.$entry)) cc_fail('Fallback DuyAnhWebPro thiếu entrypoint.',409,'PLUGIN_FALLBACK_INVALID');
    return (string)($plugin['fallback_version'] ?? '1.9.4');
  }
  cc_fail('Hosting không tự tải được DuyAnhWebPro: '.$vendorError,502,'PLUGIN_DOWNLOAD_FAILED');
}
function cc_write_wp_config($stage,$data) {
  $config="<?php\n/** ChatCode generated configuration. */\n";
  foreach (array('DB_NAME'=>'dbName','DB_USER'=>'dbUser','DB_PASSWORD'=>'dbPassword','DB_HOST'=>'dbHost') as $constant=>$key) $config.="define('".$constant."', '".cc_config_quote($data[$key])."');\n";
  $config.="define('DB_CHARSET','utf8mb4');\ndefine('DB_COLLATE','');\n";
  foreach (array('AUTH_KEY','SECURE_AUTH_KEY','LOGGED_IN_KEY','NONCE_KEY','AUTH_SALT','SECURE_AUTH_SALT','LOGGED_IN_SALT','NONCE_SALT') as $key) $config.="define('".$key."', '".cc_config_quote(base64_encode(random_bytes(48)))."');\n";
  if (!empty($data['bricksLicenseKey'])) $config.="define('BRICKS_LICENSE_KEY','".cc_config_quote($data['bricksLicenseKey'])."');\n";
  $config.="\n\$table_prefix='".cc_config_quote($data['tablePrefix'])."';\ndefine('WP_DEBUG',false);\ndefine('DISALLOW_FILE_EDIT',true);\nif (!defined('ABSPATH')) define('ABSPATH',__DIR__.'/');\nrequire_once ABSPATH.'wp-settings.php';\n";
  if (file_put_contents($stage.'/wp-config.php',$config,LOCK_EX)===false) throw new Exception('Không ghi được wp-config.php.');
  @chmod($stage.'/wp-config.php',0600);
}
function cc_publish($stage) {
  foreach ((array)@scandir($stage) as $name) {
    if ($name === '.' || $name === '..') continue;
    $src=$stage.DIRECTORY_SEPARATOR.$name; $dst=__DIR__.DIRECTORY_SEPARATOR.$name;
    if (file_exists($dst)) cc_remove_tree($dst);
    if (!@rename($src,$dst)) throw new Exception('Không publish được '.$name.'.');
  }
  @rmdir($stage);
  if (file_put_contents(cc_marker(),CC_INSTALL_ID,LOCK_EX)===false) throw new Exception('Không ghi được install marker.');
}
$action='';
try {
  $supplied=(string)($_SERVER['HTTP_X_CHATCODE_TOKEN'] ?? '');
  if (!$supplied || !hash_equals(CC_TOKEN,$supplied)) cc_fail('Phiên cài đặt không hợp lệ.',403,'TOKEN_INVALID');
  $data=json_decode((string)file_get_contents('php://input'),true);
  if (!is_array($data)) cc_fail('Dữ liệu cài đặt không hợp lệ.',400,'PAYLOAD_INVALID');
  $action=(string)($data['action'] ?? 'install');
  cc_transfer_action($action,$data);
  if ($action === 'probe') { cc_answer(true,'Bootstrap ready.',array('installId'=>CC_INSTALL_ID)); }
  if ($action === 'inspect-upload') {
    $name=(string)($data['name'] ?? ''); $base=basename($name);
    if ($name === '' || $base !== $name || strpos($name,'.chatcode-') !== 0 || !preg_match('/^[A-Za-z0-9._-]+$/',$name)) cc_fail('Tên upload cần kiểm tra không hợp lệ.',400,'UPLOAD_VERIFY_INVALID');
    $expectedBytes=(int)($data['expectedBytes'] ?? 0); $expectedSha=strtolower((string)($data['expectedSha256'] ?? ''));
    if ($expectedBytes < 0 || ($expectedSha !== '' && !preg_match('/^[a-f0-9]{64}$/',$expectedSha))) cc_fail('Thông tin kiểm tra upload không hợp lệ.',400,'UPLOAD_VERIFY_INVALID');
    $file=__DIR__.DIRECTORY_SEPARATOR.$name;
    if (!is_file($file)) cc_fail('Upload chưa xuất hiện trên hosting.',409,'UPLOAD_VERIFY_FAILED',array('file'=>$name,'exists'=>false));
    $bytes=(int)@filesize($file);
    if ($expectedBytes > 0 && $bytes !== $expectedBytes) cc_fail('Dung lượng upload không khớp.',409,'UPLOAD_VERIFY_FAILED',array('file'=>$name,'exists'=>true,'bytes'=>$bytes,'expectedBytes'=>$expectedBytes));
    $sha='';
    if ($expectedSha !== '') {
      $sha=strtolower(cc_transfer_sha($file));
      if (!hash_equals($expectedSha,$sha)) cc_fail('SHA256 upload không khớp.',409,'UPLOAD_VERIFY_FAILED',array('file'=>$name,'exists'=>true,'bytes'=>$bytes,'sha256'=>$sha));
    }
    cc_answer(true,'Upload verify PASS.',array('file'=>$name,'bytes'=>$bytes,'sha256'=>$sha));
  }
  // Legacy parallel endpoint retained for interrupted tasks and existing E2E.
  if ($action === 'assemble-upload') {
    $name=(string)($data['name'] ?? ''); $base=basename($name);
    if ($name === '' || $base !== $name || strpos($name,'.chatcode-') !== 0 || !preg_match('/^[A-Za-z0-9._-]+$/',$name)) cc_fail('Tên package ghép không hợp lệ.',400,'UPLOAD_ASSEMBLY_INVALID');
    $parts=$data['parts'] ?? array();
    if (!is_array($parts) || count($parts) < 2 || count($parts) > 16) cc_fail('Danh sách part upload không hợp lệ.',400,'UPLOAD_ASSEMBLY_INVALID');
    $expectedBytes=(int)($data['expectedBytes'] ?? 0); $expectedSha=strtolower((string)($data['expectedSha256'] ?? ''));
    if ($expectedBytes <= 0 || ($expectedSha !== '' && !preg_match('/^[a-f0-9]{64}$/',$expectedSha))) cc_fail('Thông tin package ghép không hợp lệ.',400,'UPLOAD_ASSEMBLY_INVALID');
    $safeParts=array(); $missing=array(); $pattern='/^'.preg_quote($name,'/').'\.part-[0-9]{3}-of-[0-9]{3}$/';
    foreach ($parts as $part) {
      $partName=(string)$part;
      if ($partName === '' || basename($partName) !== $partName || !preg_match($pattern,$partName)) cc_fail('Tên part upload không hợp lệ.',400,'UPLOAD_ASSEMBLY_INVALID');
      $safeParts[]=$partName;
      if (!is_file(__DIR__.DIRECTORY_SEPARATOR.$partName)) $missing[]=$partName;
    }
    if ($missing) cc_fail('Thiếu part upload trên hosting.',409,'UPLOAD_PART_MISSING',array('missingParts'=>$missing));
    $target=__DIR__.DIRECTORY_SEPARATOR.$name; $temporary=$target.'.assembling'; @unlink($temporary);
    $output=@fopen($temporary,'wb');
    if (!$output) cc_fail('Không tạo được file ghép tạm.',500,'UPLOAD_ASSEMBLY_FAILED');
    $written=0; $hash=hash_init('sha256');
    try {
      foreach ($safeParts as $partName) {
        $input=@fopen(__DIR__.DIRECTORY_SEPARATOR.$partName,'rb');
        if (!$input) throw new Exception('Không mở được part upload: '.$partName);
        try {
          while (!feof($input)) {
            $block=fread($input,1048576);
            if ($block === false) throw new Exception('Không đọc được part upload: '.$partName);
            if ($block === '') break;
            cc_transfer_write($output,$block); hash_update($hash,$block); $written+=strlen($block);
            if ($written > $expectedBytes) throw new Exception('Package ghép vượt dung lượng dự kiến.');
          }
        } finally { fclose($input); }
      }
    } catch (Throwable $error) { fclose($output); @unlink($temporary); cc_fail($error->getMessage(),500,'UPLOAD_ASSEMBLY_FAILED'); }
    fclose($output); $assembledSha=hash_final($hash);
    if ($written !== $expectedBytes || (int)@filesize($temporary) !== $expectedBytes) { @unlink($temporary); cc_fail('Dung lượng package sau khi ghép không khớp.',409,'UPLOAD_ASSEMBLY_FAILED',array('bytes'=>$written,'expectedBytes'=>$expectedBytes)); }
    if ($expectedSha !== '' && !hash_equals($expectedSha,$assembledSha)) { @unlink($temporary); cc_fail('Checksum package sau khi ghép không khớp.',409,'UPLOAD_ASSEMBLY_FAILED',array('sha256'=>$assembledSha)); }
    if (!@rename($temporary,$target)) { @unlink($temporary); cc_fail('Không chốt được package sau khi ghép.',500,'UPLOAD_ASSEMBLY_FAILED'); }
    foreach ($safeParts as $partName) @unlink(__DIR__.DIRECTORY_SEPARATOR.$partName);
    cc_answer(true,'Đã ghép package upload song song.',array('file'=>$name,'bytes'=>$written,'parts'=>count($safeParts)));
  }
  if ($action === 'cleanup') {
    cc_remove_tree(cc_stage()); cc_cleanup_upload_artifacts(); cc_remove_tree(cc_transfer_root());
    if (CC_THEME_PACKAGE !== '') @unlink(__DIR__.'/'.CC_THEME_PACKAGE);
    $plugin=(array)($data['plugin'] ?? array());
    if (!empty($plugin['fallback_package'])) @unlink(__DIR__.'/'.basename((string)$plugin['fallback_package']));
    if (!empty($data['corePackage'])) @unlink(__DIR__.'/'.basename((string)$data['corePackage']));
    @unlink(__FILE__); cc_answer(true,'Đã dọn file cài đặt tạm.');
  }
  if ($action === 'verify') {
    if (!cc_same_install_live()) cc_fail('Website chưa ở trạng thái live của install task này.',409,'VERIFY_INSTALL_MARKER_FAILED');
    $ccVerifyPlugin=(array)($data['plugin'] ?? array()); $ccVerifyEntry=(string)($ccVerifyPlugin['entry'] ?? '');
    $ccExpectedTheme=(string)($data['theme']['active_theme'] ?? '');
    require_once __DIR__.'/wp-load.php'; require_once ABSPATH.'wp-admin/includes/plugin.php';
    $ccActive=(string)get_option('stylesheet'); $ccPluginOk=$ccVerifyEntry === '' ? true : is_plugin_active($ccVerifyEntry);
    if (!$ccPluginOk) cc_fail('Plugin mặc định chưa active.',409,'VERIFY_PLUGIN_FAILED');
    if ($ccExpectedTheme !== '' && $ccActive !== $ccExpectedTheme) cc_fail('Theme active không đúng manifest.',409,'VERIFY_THEME_FAILED',array('activeTheme'=>$ccActive));
    cc_answer(true,'Remote verify PASS.',array('wordpressVersion'=>(string)($GLOBALS['wp_version'] ?? ''),'activeTheme'=>$ccActive,'pluginActive'=>$ccPluginOk,'siteUrl'=>(string)get_option('siteurl')));
  }
  if ($action !== 'install') cc_fail('Action không được hỗ trợ.',400,'ACTION_UNSUPPORTED');
  if (cc_same_install_live()) cc_answer(true,'Install task đã publish trước đó.',array('alreadyInstalled'=>true));
  // Read-only guard first; do not delete website files until DB is ready.
  $blocking=cc_blocking_entries($data);
  if ($blocking && empty($data['clearRemote'])) cc_fail('Thư mục website đang có nội dung.',409,'SITE_NOT_EMPTY',array('blockingEntries'=>array_slice($blocking,0,20)));
  foreach (array('panelUser','panelPassword','dbName','dbUser','dbPassword','dbHost','tablePrefix','siteTitle','adminUser','adminEmail','adminPassword','siteUrl') as $key) {
    if (!isset($data[$key]) || (string)$data[$key] === '') cc_fail('Thiếu thông tin '.$key,400,'PAYLOAD_MISSING_FIELD');
  }
  if (!preg_match('/^[A-Za-z][A-Za-z0-9_]{0,31}$/',(string)$data['tablePrefix'])) cc_fail('Table prefix không hợp lệ.',400,'TABLE_PREFIX_INVALID');
  list($mysqli,$markerTable,$selected)=cc_prepare_database($data);
  $removedEntries=cc_prepare_remote_root($data);
  $stage=cc_stage();
  if (!is_dir($stage) && !@mkdir($stage,0755,true)) throw new Exception('Không tạo được staging directory.');
  $data['dbName']=$selected['name']; $data['dbUser']=$selected['user']; $data['dbHost']=$selected['host'];
  cc_prepare_wordpress($stage,$data); $activeTheme=cc_prepare_theme($stage,$data);
  $plugin=(array)($data['plugin'] ?? array()); $pluginVersion=cc_prepare_duyanh($stage,$plugin); cc_write_wp_config($stage,$data);
  $ccStage=$stage; $ccMysqli=$mysqli; $ccMarkerTable=$markerTable;
  $ccSiteTitle=(string)$data['siteTitle']; $ccAdminUser=(string)$data['adminUser']; $ccAdminEmail=(string)$data['adminEmail'];
  $ccAdminPassword=(string)$data['adminPassword']; $ccSiteUrl=(string)$data['siteUrl']; $ccActiveTheme=(string)$activeTheme;
  $ccPluginEntry=(string)($plugin['entry'] ?? ''); $ccPluginFallback=basename((string)($plugin['fallback_package'] ?? ''));
  $ccPluginVersion=(string)$pluginVersion; $ccDatabase=array('name'=>$data['dbName'],'user'=>$data['dbUser'],'host'=>$data['dbHost']);
  $ccClearedEntries=$removedEntries;
  if ($ccPluginEntry === '') throw new Exception('Plugin entrypoint không hợp lệ.');
  define('WP_INSTALLING',true);
  require $ccStage.'/wp-load.php'; require_once $ccStage.'/wp-admin/includes/upgrade.php'; require_once $ccStage.'/wp-admin/includes/plugin.php';
  if (!is_blog_installed()) wp_install($ccSiteTitle,$ccAdminUser,$ccAdminEmail,true,'',$ccAdminPassword,'vi');
  update_option('siteurl',$ccSiteUrl); update_option('home',$ccSiteUrl); update_option('timezone_string','Asia/Ho_Chi_Minh');
  update_option('permalink_structure','/%postname%/');
  if ($ccActiveTheme !== '') switch_theme($ccActiveTheme);
  $activated=activate_plugin($ccPluginEntry);
  if (is_wp_error($activated)) throw new Exception('Không kích hoạt được DuyAnhWebPro: '.$activated->get_error_message());
  flush_rewrite_rules(true); $ccMysqli->query('DROP TABLE IF EXISTS '.$ccMarkerTable); cc_publish($ccStage);
  if (CC_THEME_PACKAGE !== '') @unlink(__DIR__.'/'.CC_THEME_PACKAGE);
  if ($ccPluginFallback !== '') @unlink(__DIR__.'/'.$ccPluginFallback);
  cc_answer(true,'Đã cài WordPress.',array('database'=>$ccDatabase,'activeTheme'=>$ccActiveTheme,'pluginVersion'=>$ccPluginVersion,'wordpressVersion'=>(string)($GLOBALS['wp_version'] ?? ''),'clearedEntries'=>array_slice($ccClearedEntries,0,20)));
} catch (Throwable $error) { cc_fail($error->getMessage(),500,'INSTALL_FAILED'); }
`;
}
function randomInstallToken() { return crypto.randomBytes(32).toString('hex'); }
module.exports = { buildFreshInstallBootstrap, randomInstallToken };
