'use strict';

// Authenticated short-lived PHP endpoints used by the native transfer path.
function buildTransferBootstrap() {
  return String.raw`
function cc_transfer_root() { return __DIR__ . '/.chatcode-upload-' . substr(CC_INSTALL_ID,0,12); }
function cc_transfer_name($name) {
  if (!is_string($name) || !preg_match('/^\\.chatcode-[A-Za-z0-9._-]+\\.zip$/D',$name) || strpos($name,'..') !== false) cc_fail('Ten package upload khong hop le.',400,'UPLOAD_NAME_INVALID');
  return $name;
}
function cc_transfer_dir($name) { return cc_transfer_root() . '/' . substr(hash('sha256',$name),0,16); }
function cc_transfer_receipt($file) { return cc_transfer_root() . '/verified-' . hash('sha256',basename($file)) . '.json'; }
function cc_transfer_record($file,$sha) {
  clearstatcache(true,$file);
  @file_put_contents(cc_transfer_receipt($file),json_encode(array('bytes'=>(int)filesize($file),'mtime'=>(int)filemtime($file),'sha256'=>$sha)),LOCK_EX);
}
function cc_transfer_sha($file) {
  clearstatcache(true,$file);
  $receipt=cc_transfer_receipt($file);
  $saved=is_file($receipt) ? json_decode((string)@file_get_contents($receipt),true) : null;
  if (is_array($saved) && is_file($file) && (int)$saved['bytes']===(int)filesize($file) && (int)$saved['mtime']===(int)filemtime($file)) return (string)$saved['sha256'];
  return (string)hash_file('sha256',$file);
}
function cc_transfer_write($stream,$block) {
  $length=strlen($block); $offset=0;
  while ($offset<$length) {
    $written=fwrite($stream,substr($block,$offset));
    if ($written===false || $written===0) throw new Exception('Khong ghi duoc ZIP tren hosting.');
    $offset+=$written;
  }
}
function cc_transfer_action($action,$data) {
  if (!in_array($action,array('prepare-parts','assemble-parts'),true)) return;
  $name=cc_transfer_name($data['name'] ?? '');
  $directory=cc_transfer_dir($name); $root=cc_transfer_root();
  if (!is_dir($root) && !@mkdir($root,0755,true) && !is_dir($root)) throw new Exception('Khong tao duoc thu muc upload.');
  @file_put_contents($root.'/.htaccess',"Require all denied\n",LOCK_EX);
  if (!is_dir($directory) && !@mkdir($directory,0755,true) && !is_dir($directory)) throw new Exception('Khong tao duoc thu muc parts.');
  $lock=fopen($directory.'/transfer.lock','c');
  if (!$lock || !flock($lock,LOCK_EX|LOCK_NB)) cc_fail('Package dang duoc xu ly.',409,'UPLOAD_BUSY');
  $planFile=$directory.'/plan.json';
  $plan=is_file($planFile) ? json_decode((string)file_get_contents($planFile),true) : null;
  if ($action==='prepare-parts') {
    $parts=$data['parts'] ?? array(); $bytes=(int)($data['expectedBytes'] ?? 0); $sha=strtolower((string)($data['expectedSha256'] ?? ''));
    if (!is_array($parts) || count($parts)<1 || count($parts)>16 || $bytes<1 || $bytes>167772160 || ($sha!=='' && !preg_match('/^[a-f0-9]{64}$/D',$sha))) cc_fail('Ke hoach upload khong hop le.',400,'UPLOAD_PLAN_INVALID');
    $offset=0;
    foreach ($parts as $index=>$part) {
      if ((int)($part['index'] ?? -1)!==$index || (int)($part['offset'] ?? -1)!==$offset || (int)($part['bytes'] ?? 0)<1) cc_fail('Cac part khong lien tuc.',400,'UPLOAD_PLAN_INVALID');
      $offset+=(int)$part['bytes'];
    }
    if ($offset!==$bytes) cc_fail('Tong dung luong parts khong khop.',400,'UPLOAD_PLAN_INVALID');
    // A verified completed ZIP is independent of the current worker count.
    $target=__DIR__.'/'.$name;
    if ($sha!=='' && is_file($target) && !is_link($target) && (int)filesize($target)===$bytes && is_file(cc_transfer_receipt($target)) && hash_equals($sha,cc_transfer_sha($target))) cc_answer(true,'Package already uploaded.',array('complete'=>true,'file'=>$name,'bytes'=>$bytes,'sha256'=>$sha,'workers'=>count($parts)));
    $next=array('name'=>$name,'bytes'=>$bytes,'sha256'=>$sha,'parts'=>$parts);
    if ($plan!==$next) {
      foreach ((array)glob($directory.'/*.part') as $old) @unlink($old);
      @unlink(cc_transfer_receipt($target));
      if (file_put_contents($planFile,json_encode($next),LOCK_EX)===false) throw new Exception('Khong luu duoc ke hoach upload.');
    }
    $present=array();
    foreach ($parts as $index=>$part) {
      $file=$directory.'/'.$index.'.part'; clearstatcache(true,$file);
      if (is_file($file) && !is_link($file) && (int)filesize($file)===(int)$part['bytes']) $present[]=$index;
    }
    cc_answer(true,'Upload plan ready.',array('directory'=>basename($root).'/'.basename($directory),'present'=>$present));
  }
  if (!is_array($plan)) cc_fail('Thieu ke hoach upload.',409,'UPLOAD_PLAN_MISSING');
  $hashes=$data['partSha256'] ?? array();
  if (!is_array($hashes) || count($hashes)!==count($plan['parts'])) cc_fail('Thieu checksum parts.',400,'UPLOAD_PLAN_INVALID');
  $bad=array();
  foreach ($plan['parts'] as $index=>$part) {
    $file=$directory.'/'.$index.'.part'; clearstatcache(true,$file);
    if (!preg_match('/^[a-f0-9]{64}$/D',(string)$hashes[$index])) cc_fail('Checksum part khong hop le.',400,'UPLOAD_PLAN_INVALID');
    if (!is_file($file) || is_link($file) || (int)filesize($file)!==(int)$part['bytes']) $bad[]=$index;
  }
  if ($bad) cc_fail('Mot so part chua du du lieu.',409,'UPLOAD_PARTS_INVALID',array('badParts'=>$bad));
  $target=__DIR__.'/'.$name; $temporary=$directory.'/assembled.zip'; $output=fopen($temporary,'wb');
  if (!$output) throw new Exception('Khong tao duoc ZIP tam.');
  $whole=hash_init('sha256'); $total=0;
  try {
    foreach ($plan['parts'] as $index=>$part) {
      $input=fopen($directory.'/'.$index.'.part','rb');
      if (!$input) throw new Exception('Khong doc duoc part '.($index+1));
      $hash=hash_init('sha256');
      try {
        while (!feof($input)) {
          $block=fread($input,1048576);
          if ($block===false) throw new Exception('Doc part that bai.');
          if ($block==='') break;
          $total+=strlen($block);
          if ($total>(int)$plan['bytes']) throw new Exception('Part thay doi trong khi ghep.');
          hash_update($whole,$block); hash_update($hash,$block); cc_transfer_write($output,$block);
        }
      } finally { fclose($input); }
      if (!hash_equals((string)$hashes[$index],hash_final($hash))) $bad[]=$index;
    }
  } catch (Throwable $error) { fclose($output); @unlink($temporary); throw $error; }
  fclose($output); $sha=hash_final($whole);
  if ($bad) { @unlink($temporary); cc_fail('Part upload bi loi.',409,'UPLOAD_PARTS_INVALID',array('badParts'=>$bad)); }
  if ($total!==(int)$plan['bytes'] || ($plan['sha256']!=='' && !hash_equals($plan['sha256'],$sha))) {
    @unlink($temporary); cc_fail('ZIP local khong khop package da chon. Hay import lai package.',409,'PACKAGE_SOURCE_CHANGED');
  }
  if (!rename($temporary,$target)) throw new Exception('Khong chot duoc ZIP tren hosting.');
  cc_transfer_record($target,$sha);
  foreach ($plan['parts'] as $index=>$part) @unlink($directory.'/'.$index.'.part');
  cc_answer(true,'Parallel upload complete.',array('file'=>$name,'bytes'=>$total,'sha256'=>$sha,'workers'=>count($plan['parts'])));
}
`;
}
module.exports = { buildTransferBootstrap };
