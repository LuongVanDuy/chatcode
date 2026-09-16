const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: marker count=${count}`);
  return text.replace(oldText, newText);
}
function insertBeforeLast(text, marker, insertion, label) {
  const index = text.lastIndexOf(marker);
  if (index < 0) throw new Error(`${label}: marker missing`);
  return text.slice(0,index) + insertion + text.slice(index);
}

let ps = execFileSync('git', ['show', 'origin/main:tools/deploy-ftp.ps1'], { encoding:'utf8' }).replace(/^\uFEFF/, '');
ps = replaceOnce(ps,
  "  [string]$Manifest = '',\n  [switch]$DryRun,",
  "  [string]$Manifest = '',\n  [string]$DeleteOwned = '',\n  [switch]$DryRun,",
  'param');
ps = replaceOnce(ps,
  "  # Called only for this run's GUID staging/probe files, never a manifest target.",
  "  # Called only for this run's GUID staging/probe files or a caller-validated one-shot DB helper; never a manifest target.",
  'delete comment');
ps = replaceOnce(ps,
  "  $items = @()\n  if ($Probe) {",
  [
    "  $items = @()",
    "  if ($DeleteOwned) {",
    "    $rel = ([string]$DeleteOwned).Replace('\\','/')",
    "    if ($rel -notmatch '^wp-content/chatcode-db-once-[a-f0-9]{24}\\.php$') { throw 'DeleteOwned is restricted to ChatCode one-shot DB helpers' }",
    "    if ($DryRun) {",
    "      $results.Add(@{file=$rel; status='planned-delete'})",
    "    } else {",
    "      $ownedRemote = $remoteBase + '/' + $rel",
    "      if ((Download-Hash $ownedRemote -AllowMissing) -eq '') {",
    "        $results.Add(@{file=$rel; status='absent'})",
    "      } else {",
    "        Require-Ok (Delete-OwnedRemote $ownedRemote)",
    "        if ((Download-Hash $ownedRemote -AllowMissing) -ne '') { throw 'Owned helper still exists after delete' }",
    "        $results.Add(@{file=$rel; status='deleted'})",
    "      }",
    "    }",
    "  } elseif ($Probe) {"
  ].join('\n'),
  'owned delete branch');
ps = insertBeforeLast(ps,
  '$report | ConvertTo-Json -Depth 6',
  [
    "$ownedDeleted = @($results | Where-Object { $_.status -eq 'deleted' }).Count -gt 0",
    "$ownedAbsent = @($results | Where-Object { $_.status -eq 'absent' }).Count -gt 0",
    "if ($DeleteOwned) {",
    "  $report['mode'] = 'owned_delete'",
    "  $report['deleted'] = $ownedDeleted",
    "  $report['absent'] = $ownedAbsent",
    "}",
    ""
  ].join('\n'),
  'report emission');
fs.writeFileSync('tools/deploy-ftp.ps1', ps, 'utf8');

const smokePath = 'scripts/smoke-ftp-runner.cjs';
let smoke = fs.readFileSync(smokePath, 'utf8').replace(/\r\n/g,'\n');
const marker = "  const probe=await run({files:[]},['-Probe']);assert.equal(probe.code,0);\n  assert.ok([...files.keys()].every(p=>!p.includes('chatcode-upload-')&&!p.includes('chatcode-ftp-probe-')),'temporary remote files must be cleaned');";
const replacement = [
  "  const probe=await run({files:[]},['-Probe']);assert.equal(probe.code,0);",
  "  assert.ok([...files.keys()].every(p=>!p.includes('chatcode-upload-')&&!p.includes('chatcode-ftp-probe-')),'temporary remote files must be cleaned');",
  "  const ownedRel='wp-content/chatcode-db-once-'+'a'.repeat(24)+'.php';",
  "  files.set('/site/'+ownedRel,Buffer.from('<?php // one-shot helper'));",
  "  const ownedDelete=await run({files:[]},['-DeleteOwned',ownedRel]);",
  "  assert.equal(ownedDelete.code,0,JSON.stringify(ownedDelete.report));assert.equal(ownedDelete.report.mode,'owned_delete');assert.equal(ownedDelete.report.deleted,true);assert.equal(files.has('/site/'+ownedRel),false);",
  "  const connectionsBeforeInvalidDelete=connections;",
  "  const invalidDelete=await run({files:[]},['-DeleteOwned','wp-content/uploads/not-owned.php']);",
  "  assert.equal(invalidDelete.code,2);assert.equal(invalidDelete.report.curl_requests,0);assert.equal(connections,connectionsBeforeInvalidDelete,'invalid owned-delete path must fail before FTP');"
].join('\n');
smoke = replaceOnce(smoke, marker, replacement, 'FTP smoke');
fs.writeFileSync(smokePath, smoke, 'utf8');
console.log('v1.0.51 FTP repair patch prepared.');
