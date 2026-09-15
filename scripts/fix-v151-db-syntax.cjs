const fs = require('fs');
const file = 'core/database-runtime.js';
let source = fs.readFileSync(file,'utf8');
const replacements = [
  ["if (is_null($value)) $parts[] = '`' . $key . '` IS NULL';", "if (is_null($value)) $parts[] = $key . ' IS NULL';"],
  ["else { $parts[] = '`' . $key . '` = %s'; $values[] = maybe_serialize($value); }", "else { $parts[] = $key . ' = %s'; $values[] = maybe_serialize($value); }"],
  ["$rows = $wpdb->get_results(\"SHOW KEYS FROM `{$table}` WHERE Key_name='PRIMARY'\", ARRAY_A);", "$rows = $wpdb->get_results(\"SHOW KEYS FROM {$table} WHERE Key_name='PRIMARY'\", ARRAY_A);"],
  ["$sql = \"SELECT * FROM `{$table}` WHERE {$whereSql} LIMIT \" . (intval($max) + 1);", "$sql = \"SELECT * FROM {$table} WHERE {$whereSql} LIMIT \" . (intval($max) + 1);"],
  ["$verifySql = $wpdb->prepare(\"SELECT COUNT(*) FROM `{$table}` WHERE `{$pk}` IN ({$placeholders})\", $ids);", "$verifySql = $wpdb->prepare(\"SELECT COUNT(*) FROM {$table} WHERE {$pk} IN ({$placeholders})\", $ids);"],
];
for (const [before,after] of replacements) {
  if (!source.includes(before)) throw new Error(`Missing DB syntax marker: ${before}`);
  source = source.replace(before,after);
}
fs.writeFileSync(file,source);
console.log('database-runtime template literal syntax fixed');
