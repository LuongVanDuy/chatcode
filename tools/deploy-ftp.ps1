[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Manifest = '',
  [switch]$DryRun,
  [switch]$Probe,
  [ValidateRange(5,300)][int]$TimeoutSec = 45,
  [ValidateRange(1,3)][int]$MaxAttempts = 2
)

# Windows PowerShell 5.1+. Credentials travel to curl over stdin, never argv.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$script:cfg = $null
$script:scratch = $null
$script:results = New-Object System.Collections.Generic.List[object]
$script:cleanupWarnings = New-Object System.Collections.Generic.List[string]
$script:remoteBase = ''
$script:probePath = ''
$script:curlCount = 0

function Safe-Message($message) {
  $s = [string]$message
  if ($script:cfg) {
    foreach ($v in @($script:cfg.password, $script:cfg.username, $script:cfg.host)) {
      if ($v) { $s = $s.Replace([string]$v, '[redacted]') }
    }
  }
  return ($s -replace '[\r\n]+', ' ').Trim()
}
function Config-Line([string]$key, [string]$value) {
  if ($value -match '[\r\n\x00]') { throw "Invalid control character in curl option: $key" }
  return $key + ' = "' + $value.Replace('\','\\').Replace('"','\"') + '"'
}
function Remote-Url([string]$remote) {
  $encoded = (($remote.TrimStart('/') -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
  # %2F means absolute FTP path; ordinary /paths are relative to the login home in curl.
  $scheme = if ($script:implicitTls) { 'ftps' } else { 'ftp' }
  return "${scheme}://$($script:cfg.host):$($script:port)/%2F$encoded"
}
function Invoke-Ftp([string]$remote, [string[]]$extra = @()) {
  $lines = @('silent','show-error','fail','globoff', 'noproxy = "*"',
    'connect-timeout = "10"', (Config-Line 'max-time' "$TimeoutSec"),
    'proto = "=ftp,ftps"', (Config-Line 'url' (Remote-Url $remote)),
    (Config-Line 'user' ($script:cfg.username + ':' + $script:cfg.password)))
  if ($script:explicitTls) { $lines += 'ssl-reqd' }
  if ($script:cfg.passive -eq $false) { $lines += 'ftp-port = "-"' }
  $lines += $extra
  $script:curlCount++
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $p.StartInfo.FileName = $script:curlPath
  $p.StartInfo.Arguments = '--disable --config -'
  $p.StartInfo.UseShellExecute = $false
  $p.StartInfo.CreateNoWindow = $true
  $p.StartInfo.RedirectStandardInput = $true
  $p.StartInfo.RedirectStandardOutput = $true
  $p.StartInfo.RedirectStandardError = $true
  $p.StartInfo.StandardOutputEncoding = $utf8
  $p.StartInfo.StandardErrorEncoding = $utf8
  try {
    [void]$p.Start()
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    $configBytes = $utf8.GetBytes(($lines -join "`n") + "`n")
    $p.StandardInput.BaseStream.Write($configBytes, 0, $configBytes.Length)
    $p.StandardInput.BaseStream.Close()
    if (-not $p.WaitForExit(($TimeoutSec + 5) * 1000)) {
      $p.Kill(); $p.WaitForExit()
      return @{ code=28; error='FTP process exceeded deadline' }
    }
    [void]$outTask.GetAwaiter().GetResult()
    $err = $errTask.GetAwaiter().GetResult()
    return @{ code=$p.ExitCode; error=(Safe-Message $err) }
  } finally { $p.Dispose() }
}
function Require-Ok($response) {
  if ($response.code -ne 0) {
    $e = New-Object System.Exception("curl exit $($response.code): $($response.error)")
    $e.Data['curlCode'] = $response.code
    throw $e
  }
}
function Hash-File([string]$file) {
  $hash = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($file)
  try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $hash.Dispose() }
}
function Download-Hash([string]$remote, [switch]$AllowMissing) {
  $download = Join-Path $script:scratch ([Guid]::NewGuid().ToString('N') + '.download')
  try {
    $r = Invoke-Ftp $remote @((Config-Line 'output' $download))
    if ($AllowMissing -and $r.code -in @(9,78)) { return '' }
    Require-Ok $r
    return Hash-File $download
  } finally { if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force } }
}
function Delete-OwnedRemote([string]$remote) {
  # Called only for this run's GUID staging/probe files, never a manifest target.
  $r = Invoke-Ftp ($script:remoteBase + '/') @('list-only', (Config-Line 'quote' ('DELE ' + $remote)))
  return $r
}
function Publish-File($item) {
  $remote = $script:remoteBase + '/' + $item.path
  $parent = $remote.Substring(0, $remote.LastIndexOf('/'))
  for ($attempt=1; $attempt -le $MaxAttempts; $attempt++) {
    $stage = $parent + '/.chatcode-upload-' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $stageMayExist = $false
    try {
      if ((Download-Hash $remote -AllowMissing) -eq $item.sha256) {
        if (-not $Probe -and (Hash-File $item.local) -ne $item.sha256) { throw 'Local file changed during verification; rerun the manifest' }
        return @{file=$item.path; status='unchanged'; sha256=$item.sha256; attempts=$attempt}
      }
      $stageMayExist = $true
      Require-Ok (Invoke-Ftp $stage @('ftp-create-dirs', (Config-Line 'upload-file' $item.snapshot)))
      if ((Download-Hash $stage) -ne $item.sha256) { throw 'Uploaded staging file failed SHA-256 verification' }
      if (-not $Probe -and (Hash-File $item.local) -ne $item.sha256) { throw 'Local file changed during upload; rerun the manifest' }
      Require-Ok (Invoke-Ftp ($script:remoteBase + '/') @('list-only',
        (Config-Line 'quote' ('RNFR ' + $stage)), (Config-Line 'quote' ('RNTO ' + $remote))))
      $stageMayExist = $false
      if ((Download-Hash $remote) -ne $item.sha256) { throw 'Published file failed SHA-256 verification' }
      if (-not $Probe -and (Hash-File $item.local) -ne $item.sha256) { throw 'Local file changed after publish; rerun the manifest' }
      return @{file=$item.path; status='uploaded'; sha256=$item.sha256; attempts=$attempt}
    } catch {
      $code = $_.Exception.Data['curlCode']
      $message = Safe-Message $_.Exception.Message
      if ($attempt -ge $MaxAttempts -or $code -notin @(6,7,18,28,52,55,56)) {
        return @{file=$item.path; status='failed'; attempts=$attempt; error=$message}
      }
      Write-Host "FTP retry $attempt/$MaxAttempts : $($item.path)" -ForegroundColor Yellow
      Start-Sleep -Seconds $attempt
    } finally {
      if ($stageMayExist) {
        try {
          $cleanup = Delete-OwnedRemote $stage
          if ($cleanup.code -ne 0) { $script:cleanupWarnings.Add("Staging cleanup not confirmed: $stage") }
        } catch { $script:cleanupWarnings.Add("Staging cleanup not confirmed: $stage") }
      }
    }
  }
}
function Resolve-UploadPath([string]$rel) {
  $rel = $rel.Replace('\','/')
  if ([string]::IsNullOrWhiteSpace($rel) -or $rel -match '^/|[:\x00-\x1f]' -or $rel -match '(^|/)\.{1,2}(/|$)') { throw "Invalid relative file path: $rel" }
  $parts = $rel -split '/'
  if ($parts | Where-Object { -not $_ -or $_ -match '[. ]$' }) { throw "Invalid path segment: $rel" }
  if ($rel -match '(^|/)(\.git|\.vscode|\.chatcode)(/|$)|(^|/)\.env([^/]*)(/|$)|(^|/)wp-config\.php$') { throw "Protected local file: $rel" }
  $cursor = $script:root
  foreach ($part in $parts) {
    $cursor = Join-Path $cursor $part
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Symlink/junction upload is not allowed: $rel" }
    }
  }
  if (-not (Test-Path -LiteralPath $cursor -PathType Leaf)) { throw "Local file missing (nothing deleted remotely): $rel" }
  return @{path=$rel; local=$cursor}
}

$exitCode = 0
try {
  $script:root = (Resolve-Path -LiteralPath $ProjectRoot).ProviderPath.TrimEnd('\','/')
  $configPath = Join-Path $script:root '.vscode/sftp.json'
  try { $script:cfg = [IO.File]::ReadAllText($configPath, $utf8) | ConvertFrom-Json }
  catch { throw 'Cannot read .vscode/sftp.json as JSON; validate it locally without printing credentials' }
  if ($cfg -is [Array] -or $cfg.protocol -ne 'ftp') { throw 'Only a single FTP configuration is supported; SFTP is a different protocol' }
  if (-not $cfg.host -or -not $cfg.username -or -not $cfg.password) { throw 'FTP host, username and password are required in .vscode/sftp.json' }
  if ($cfg.host -notmatch '^[a-zA-Z0-9.-]+$') { throw 'FTP host must be a DNS name or IPv4 address' }
  $script:implicitTls = $cfg.secure -is [string] -and $cfg.secure -eq 'implicit'
  $script:explicitTls = ($cfg.secure -is [bool] -and $cfg.secure) -or ($cfg.secure -is [string] -and $cfg.secure -eq 'explicit')
  if ($cfg.secure -and -not $implicitTls -and -not $explicitTls) { throw 'Unsupported secure setting; use true, false, explicit or implicit' }
  $script:port = if ($cfg.port) { [int]$cfg.port } elseif ($implicitTls) { 990 } else { 21 }
  if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid FTP port' }
  $script:remoteBase = ([string]$cfg.remotePath).Replace('\','/')
  if (-not $remoteBase.StartsWith('/') -or $remoteBase -match '[\r\n\x00]|(^|/)\.\.(/|$)') { throw 'remotePath must be an explicit absolute FTP directory' }
  $script:remoteBase = $remoteBase.TrimEnd('/')
  $script:curlPath = (Get-Command curl.exe -CommandType Application -ErrorAction Stop).Source
  $script:scratch = Join-Path ([IO.Path]::GetTempPath()) ('chatcode-ftp-' + [Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($scratch)
  $items = @()
  if ($Probe) {
    $probeName = 'chatcode-ftp-probe-' + [Guid]::NewGuid().ToString('N') + '.txt'
    $snapshot = Join-Path $scratch 'probe.txt'
    [IO.File]::WriteAllText($snapshot, "ChatCode FTP probe $probeName`r`n", $utf8)
    $script:probePath = $remoteBase + '/' + $probeName
    $items = @(@{path=$probeName; local=$snapshot; snapshot=$snapshot; sha256=(Hash-File $snapshot)})
  } else {
    if (-not $Manifest) { $Manifest = Join-Path $root '.chatcode/ftp-files.json' }
    $parsed = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Manifest).ProviderPath, $utf8) | ConvertFrom-Json
    if ($parsed.PSObject.Properties['files'] -and $parsed.files -isnot [Array]) { throw 'Manifest files must be a JSON array' }
    $files = if ($parsed -is [Array]) { $parsed } elseif ($parsed.PSObject.Properties['files']) { $parsed.files } else { throw 'Manifest must be a JSON array or an object with files[]' }
    if (@($files).Count -lt 1 -or @($files).Count -gt 500) { throw 'Manifest must contain 1..500 files; lists are never silently truncated' }
    $seen = @{}
    foreach ($file in $files) {
      if ($file -isnot [string]) { throw 'Every manifest entry must be a relative filename string' }
      $item = Resolve-UploadPath $file
      if ($seen.ContainsKey($item.path)) { continue }
      $seen[$item.path] = $true
      $item.snapshot = Join-Path $scratch ([Guid]::NewGuid().ToString('N') + '.upload')
      [IO.File]::Copy($item.local, $item.snapshot)
      $item.sha256 = Hash-File $item.snapshot
      $items += $item
    }
  }
  if ($DryRun) {
    foreach ($item in $items) { $results.Add(@{file=$item.path; status='planned'; sha256=$item.sha256}) }
  } else {
    foreach ($item in $items) {
      $result = Publish-File $item
      $results.Add($result)
      Write-Host ("FTP {0}: {1}" -f $result.status, $item.path)
      if ($result.status -eq 'failed') { $exitCode=2; break }
    }
    if ($Probe -and $exitCode -eq 0) {
      $again = Publish-File $items[0]
      if ($again.status -ne 'unchanged') { throw 'Probe repeat should detect identical remote content' }
    }
  }
} catch {
  $exitCode = 2
  $results.Add(@{status='failed'; error=(Safe-Message $_.Exception.Message)})
} finally {
  if ($probePath -and -not $DryRun) {
    try {
      Require-Ok (Delete-OwnedRemote $probePath)
      if ((Download-Hash $probePath -AllowMissing) -ne '') { throw 'Probe still exists after cleanup' }
    } catch { $exitCode=2; $cleanupWarnings.Add((Safe-Message $_.Exception.Message)) }
  }
  if ($scratch -and (Test-Path -LiteralPath $scratch)) {
    # scratch is this invocation's GUID directory directly below the OS temp directory.
    $resolvedScratch = [IO.Path]::GetFullPath($scratch)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
    if ($resolvedScratch.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedScratch -Leaf) -match '^chatcode-ftp-[a-f0-9]{32}$') {
      Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
    }
  }
}
$report = @{ok=($exitCode -eq 0); mode=$(if ($DryRun) {'dry_run'} elseif ($Probe) {'probe'} else {'deploy'}); files=@($results.ToArray()); curl_requests=$curlCount; cleanup_warnings=@($cleanupWarnings.ToArray())}
if ($exitCode -ne 0 -and $items) { $report.not_attempted = @($items | Where-Object { $_.path -notin @($results | ForEach-Object { $_.file }) } | ForEach-Object { $_.path }) }
$report | ConvertTo-Json -Depth 6
exit $exitCode
