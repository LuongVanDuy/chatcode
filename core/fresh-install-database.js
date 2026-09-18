'use strict';

// A failed database bootstrap can be refreshed without resending theme ZIPs.
// Never replace an installer whose outcome is still pending reconciliation.
function needsDatabaseBootstrapRefresh(task) {
  if (task.checkpoint !== 'uploaded' || task.install_request_pending) return false;
  return !!task.remote_policy?.clear_remote || !!task.clear_remote_confirmed || /^DB_/.test(task.error_code || '') ||
    (task.error_code === 'INSTALL_FAILED' &&
      /^Không tự tạo\/kết nối được database\./.test(task.error || ''));
}

function buildDatabaseBootstrap() {
  return String.raw`
function cc_db_text($value) {
  if (is_array($value)) return implode(' ',array_map('cc_db_text',$value));
  return is_scalar($value) ? (string)$value : '';
}
function cc_db_redact($value,$data) {
  $text=cc_db_text($value);
  foreach (array('panelPassword','dbPassword','adminPassword','bricksLicenseKey') as $key) {
    $secret=(string)($data[$key] ?? '');
    if ($secret!=='') $text=str_replace(array($secret,rawurlencode($secret),urlencode($secret)),'[redacted]',$text);
  }
  $text=html_entity_decode(strip_tags($text),ENT_QUOTES,'UTF-8');
  foreach (array('panelPassword','dbPassword','adminPassword','bricksLicenseKey') as $key) {
    $secret=(string)($data[$key] ?? '');
    if ($secret!=='') $text=str_replace($secret,'[redacted]',$text);
  }
  return substr(trim(preg_replace('/\s+/u',' ',$text)),0,600);
}
function cc_db_panel_result($reply,$data) {
  $status=(int)($reply['status'] ?? 0);
  $body=(string)($reply['body'] ?? '');
  $parsed=json_decode($body,true);
  if (!is_array($parsed)) { $parsed=array(); parse_str($body,$parsed); }
  $messages=array();
  foreach (array('text','details','message','error') as $key) {
    if (isset($parsed[$key]) && !in_array($parsed[$key],array(0,'0',1,'1',true,false),true)) $messages[]=cc_db_text($parsed[$key]);
  }
  $message=cc_db_redact(implode(' · ',array_unique(array_filter($messages))),$data);
  if ($message==='') $message=cc_db_redact($reply['error'] ?? '',$data);
  if ($message==='' && !array_key_exists('error',$parsed)) $message=cc_db_redact($body,$data);
  $ok=$status>=200 && $status<300 && array_key_exists('error',$parsed) && in_array($parsed['error'],array(0,'0',false),true);
  $code=$ok ? '' : 'DB_PANEL_REJECTED';
  if (!$status) $code='DB_PANEL_UNAVAILABLE';
  elseif (in_array($status,array(401,403),true)) $code='DB_PANEL_AUTH_FAILED';
  elseif (preg_match('/(?:database|mysql).{0,80}(?:limit|quota)|(?:limit|quota).{0,80}(?:database|mysql)|maximum number of databases/i',$message)) $code='DB_PANEL_LIMIT';
  return array('ok'=>$ok,'code'=>$code,'http_status'=>$status,'message'=>$message ?: ($ok ? 'Database created.' : 'DirectAdmin không trả chi tiết lỗi.'));
}
function cc_db_panel_send($url,$body,$data) {
  $curl=curl_init($url);
  curl_setopt_array($curl,array(
    CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body,CURLOPT_RETURNTRANSFER=>true,
    CURLOPT_HTTPAUTH=>CURLAUTH_BASIC,CURLOPT_USERPWD=>$data['panelUser'].':'.$data['panelPassword'],
    CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>20,CURLOPT_FOLLOWLOCATION=>false,
    CURLOPT_HTTPHEADER=>array('Content-Type: application/x-www-form-urlencoded','Accept: application/json')
  ));
  // Only the fixed loopback panel endpoint uses the local TLS exception.
  if (strpos($url,'https://127.0.0.1:2222/')===0) {
    curl_setopt($curl,CURLOPT_SSL_VERIFYPEER,false); curl_setopt($curl,CURLOPT_SSL_VERIFYHOST,0);
  }
  $response=curl_exec($curl);
  $reply=array('body'=>$response===false ? '' : $response,'status'=>(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE),
    'errno'=>curl_errno($curl),'error'=>curl_error($curl));
  curl_close($curl);
  return $reply;
}
function cc_directadmin_create_database($data,&$detail,$send=null) {
  if ($send===null) {
    if (!function_exists('curl_init')) { $detail=array('code'=>'DB_PANEL_UNAVAILABLE','message'=>'PHP chưa bật cURL.'); return false; }
    $send='cc_db_panel_send';
  }
  $account=(string)($data['panelUser'] ?? '');
  $prefix=$account.'_';
  $name=(string)$data['dbName']; $user=(string)$data['dbUser'];
  if (!preg_match('/^[A-Za-z0-9_]+$/D',$account) || empty($data['panelPassword']) ||
      strpos($name,$prefix)!==0 || strpos($user,$prefix)!==0) {
    $detail=array('code'=>'DB_PANEL_INPUT_INVALID','message'=>'Tài khoản panel hoặc tiền tố database không khớp.'); return false;
  }
  $name=substr($name,strlen($prefix)); $user=substr($user,strlen($prefix));
  if (!preg_match('/^[A-Za-z0-9_]{1,40}$/D',$name) || !preg_match('/^[A-Za-z0-9_]{1,40}$/D',$user)) {
    $detail=array('code'=>'DB_PANEL_INPUT_INVALID','message'=>'Tên database/user không hợp lệ.'); return false;
  }
  // Preserve the exact manifest credentials; never truncate or silently rename.
  $body=http_build_query(array('action'=>'create','name'=>$name,'user'=>$user,
    'passwd'=>(string)$data['dbPassword'],'passwd2'=>(string)$data['dbPassword'],'json'=>'yes'));
  $attempts=array();
  foreach (array('https','http') as $scheme) {
    $url=$scheme.'://127.0.0.1:2222/CMD_API_DATABASES';
    $reply=call_user_func($send,$url,$body,$data);
    $detail=cc_db_panel_result($reply,$data);
    $attempts[]=array('scheme'=>$scheme,'http_status'=>$detail['http_status'],'message'=>$detail['message']);
    $detail['attempts']=$attempts;
    if ($detail['ok']) return true;
    // HTTP 500 is an application response, NOT a reason to submit CREATE twice.
    // Plain HTTP is attempted only after TLS cannot speak to a plaintext panel.
    if ($scheme!=='https' || (int)($reply['status'] ?? 0)!==0 || (int)($reply['errno'] ?? 0)!==35) break;
  }
  return false;
}
function cc_db_open($candidate) {
  mysqli_report(MYSQLI_REPORT_OFF);
  try {
    $db=@new mysqli($candidate['host'],$candidate['user'],$candidate['password'],$candidate['name']);
    if (!$db->connect_errno) return array('db'=>$db,'errno'=>0,'message'=>'');
    return array('db'=>null,'errno'=>(int)$db->connect_errno,'message'=>(string)$db->connect_error);
  } catch (Throwable $error) { return array('db'=>null,'errno'=>(int)$error->getCode(),'message'=>$error->getMessage()); }
}
function cc_connect_database($data,&$selected,&$detail,$connect=null,$send=null) {
  $connect=$connect ?: 'cc_db_open';
  $candidate=array('name'=>$data['dbName'],'user'=>$data['dbUser'],'password'=>$data['dbPassword'],'host'=>$data['dbHost']);
  $first=call_user_func($connect,$candidate);
  if ($first['db']) { $selected=$candidate; return $first['db']; }
  if (!empty($data['reuseExistingDatabase'])) {
    $detail=array('code'=>'DB_REUSE_CONNECT_FAILED','phase'=>'database','mysql'=>array('errno'=>(int)$first['errno'],'message'=>'Không kết nối được database hiện tại. Không tạo database khác.'));
    return null;
  }
  $panel=array(); cc_directadmin_create_database($data,$panel,$send);
  // An error/timeout can arrive after CREATE has committed. Reconnect once with
  // identical credentials, not a second CREATE and not a password reset.
  $last=call_user_func($connect,$candidate);
  if ($last['db']) { $selected=$candidate; return $last['db']; }
  $detail=array('code'=>empty($panel['ok']) ? ($panel['code'] ?? 'DB_PANEL_REJECTED') : 'DB_CONNECT_FAILED',
    'phase'=>'database','database'=>array('name'=>$candidate['name'],'user'=>$candidate['user'],'host'=>$candidate['host']),
    'panel'=>$panel,'mysql'=>array('errno'=>(int)$last['errno'],'message'=>cc_db_redact($last['message'],$data)));
  return null;
}
`;
}
module.exports={ buildDatabaseBootstrap, needsDatabaseBootstrapRefresh };
