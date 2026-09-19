'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// User-supplied archive, preserved byte-for-byte including the custom element
// and screenshot. Embedded in the small bootstrap to avoid another FTP upload.
const CHILD_SHA256 = 'ad2c3fac57fc89b05084ef48333d903d0a34c82ead5d039961a2b3a80556567d';
let childBase64;
function buildInstallProfileBootstrap() {
  if (!childBase64) {
    const zip = fs.readFileSync(path.join(__dirname, 'packages', 'bricks-child.zip'));
    if (crypto.createHash('sha256').update(zip).digest('hex') !== CHILD_SHA256) throw new Error('Bundled Bricks Child archive does not match the supplied template.');
    childBase64 = zip.toString('base64');
  }
  return String.raw`
function cc_profile_install_child($stage) {
  $archive=$stage.'/.bricks-child-template.zip';
  $bytes=base64_decode('${childBase64}',true);
  if ($bytes===false || file_put_contents($archive,$bytes,LOCK_EX)!==strlen($bytes)) throw new Exception('Không ghi được gói Bricks Child.');
  try {
    cc_validate_zip($archive,array('bricks-child/style.css','bricks-child/functions.php','bricks-child/elements/title.php','bricks-child/screenshot.png'));
    $root=$stage.'/wp-content/themes';
    cc_remove_tree($root.'/bricks-child');
    cc_extract_zip($archive,$root);
  } finally { @unlink($archive); }
}
function cc_profile_prepare_language() {
  require_once ABSPATH.'wp-admin/includes/translation-install.php';
  if (wp_download_language_pack('vi')!=='vi') cc_fail('Không tải được gói tiếng Việt của WordPress. Giữ nguyên website cũ; thử lại khi hosting truy cập được máy chủ bản dịch.',502,'LANGUAGE_DOWNLOAD_FAILED');
  if (!in_array('vi',get_available_languages(),true)) cc_fail('Gói tiếng Việt chưa có trên hosting.',409,'LANGUAGE_PACK_MISSING');
  switch_to_locale('vi');
}
function cc_profile_prune_directory($root,$allowed) {
  foreach ((array)scandir($root) as $name) {
    if ($name==='.' || $name==='..' || $name==='index.php' || in_array($name,$allowed,true)) continue;
    $file=$root.'/'.$name;
    cc_remove_tree($file);
    clearstatcache(true,$file);
    if (file_exists($file) || is_link($file)) cc_fail('Không dọn được thành phần mặc định: '.$name,500,'PROFILE_CLEANUP_FAILED');
  }
}
function cc_profile_finalize($adminUser) {
  update_option('WPLANG','vi');
  $user=get_user_by('login',$adminUser);
  if (!$user) cc_fail('Thiếu tài khoản quản trị mới.',409,'PROFILE_ADMIN_MISSING');
  update_user_meta($user->ID,'locale','vi');
  // Prune only this installation's staging tree, never a live site's unrelated
  // extensions. Keep the chosen theme/parent in non-Bricks install modes.
  $themes=CC_THEME_SLUG==='bricks' ? array('bricks','bricks-child') : array_values(array_unique(array(get_option('stylesheet'),get_option('template'))));
  cc_profile_prune_directory(ABSPATH.'wp-content/themes',$themes);
  cc_profile_prune_directory(ABSPATH.'wp-content/plugins',array('duyanhwebpro'));
  wp_clean_themes_cache(false);
  wp_clean_plugins_cache(false);
  return cc_profile_verify($adminUser);
}
function cc_profile_verify($adminUser='') {
  $locale=(string)get_option('WPLANG');
  $languages=get_available_languages();
  // Checking both front-end and admin catalogs prevents a vi setting with an
  // English interface caused by an incomplete translation download.
  foreach (array('vi','admin-vi') as $catalog) {
    if (!is_readable(WP_LANG_DIR.'/'.$catalog.'.mo') && !is_readable(WP_LANG_DIR.'/'.$catalog.'.l10n.php')) cc_fail('Thiếu bản dịch tiếng Việt: '.$catalog,409,'VERIFY_LANGUAGE_FAILED');
  }
  if ($locale!=='vi' || !in_array('vi',$languages,true)) cc_fail('Ngôn ngữ WordPress chưa là tiếng Việt.',409,'VERIFY_LANGUAGE_FAILED');
  if ($adminUser!=='') {
    $user=get_user_by('login',$adminUser);
    if (!$user || get_user_locale($user->ID)!=='vi') cc_fail('Ngôn ngữ wp-admin chưa là tiếng Việt.',409,'VERIFY_LANGUAGE_FAILED');
  }
  $themes=array_keys(wp_get_themes()); sort($themes);
  $plugins=array_keys(get_plugins()); sort($plugins);
  $expected=CC_THEME_SLUG==='bricks' ? array('bricks','bricks-child') : array_values(array_unique(array(get_option('stylesheet'),get_option('template')))); sort($expected);
  if ($themes!==$expected || $plugins!==array('duyanhwebpro/duyanhwebpro.php') || !is_plugin_active('duyanhwebpro/duyanhwebpro.php')) cc_fail('Danh sách theme/plugin chưa đúng cấu hình cài mới.',409,'VERIFY_PROFILE_FAILED');
  if (CC_THEME_SLUG==='bricks' && (get_option('stylesheet')!=='bricks-child' || get_option('template')!=='bricks')) cc_fail('Bricks Child chưa được kích hoạt.',409,'VERIFY_PROFILE_FAILED');
  return array('locale'=>'vi','themes'=>$themes,'plugins'=>$plugins,'profileVersion'=>1);
}
`;
}
module.exports = { buildInstallProfileBootstrap, CHILD_SHA256 };
