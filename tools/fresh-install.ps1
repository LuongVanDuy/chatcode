param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8

function Out-Json([hashtable]$Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 12 -Compress))
}

function Fail([string]$Message, [string]$Code = 'FRESH_INSTALL_RUNNER_FAILED') {
  Out-Json @{ ok=$false; code=$Code; error=$Message }
  exit 1
}

function Read-Payload {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) { Fail 'Missing JSON payload' 'PAYLOAD_MISSING' }
  try { return ($raw | ConvertFrom-Json) }
  catch { Fail ('Invalid JSON payload: ' + $_.Exception.Message) 'PAYLOAD_INVALID' }
}

function Normalize-Path([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return '/' }
  $value = $Path.Replace('\','/')
  if (-not $value.StartsWith('/')) { $value = '/' + $value }
  while ($value.Contains('//')) { $value = $value.Replace('//','/') }
  return $value
}

function Safe-Dispose($Value) {
  if ($null -eq $Value) { return }
  try { $Value.Dispose() } catch {}
}

function Ftp-Uri([string]$FtpHost, [int]$Port, [string]$RemotePath) {
  $pathValue = Normalize-Path $RemotePath
  $segments = $pathValue.TrimStart('/').Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }
  $escaped = [string]::Join('/', $segments)
  $suffix = if ($escaped) { '/' + $escaped } else { '/' }
  return [Uri]("ftp://" + $FtpHost + ":" + $Port + $suffix)
}

function New-FtpRequest(
  [string]$FtpHost,
  [int]$Port,
  [string]$RemotePath,
  [string]$Method,
  [string]$Username,
  [string]$Password,
  [bool]$Tls,
  [int]$TimeoutMs = 12000,
  [bool]$KeepAlive = $false
) {
  $request = [Net.FtpWebRequest]::Create((Ftp-Uri $FtpHost $Port $RemotePath))
  $request.Method = $Method
  $request.Credentials = New-Object Net.NetworkCredential($Username, $Password)
  $request.EnableSsl = $Tls
  $request.UsePassive = $true
  $request.UseBinary = $true
  $request.KeepAlive = $KeepAlive
  $request.Timeout = $TimeoutMs
  $request.ReadWriteTimeout = [Math]::Max($TimeoutMs, 30000)
  return $request
}

function List-Directory(
  [string]$FtpHost,
  [int]$Port,
  [string]$RemotePath,
  [string]$Username,
  [string]$Password,
  [bool]$Tls
) {
  $request = New-FtpRequest $FtpHost $Port $RemotePath ([Net.WebRequestMethods+Ftp]::ListDirectory) $Username $Password $Tls
  $response = $request.GetResponse()
  try {
    $reader = New-Object IO.StreamReader($response.GetResponseStream())
    try {
      $items = @()
      while (-not $reader.EndOfStream) {
        $line = $reader.ReadLine()
        if (-not [string]::IsNullOrWhiteSpace($line)) {
          $item = $line.Trim().Replace('\','/').TrimEnd('/')
          if ($item.Contains('/')) { $item = @($item.Split('/') | Where-Object { $_ })[-1] }
          if (-not [string]::IsNullOrWhiteSpace($item)) { $items += $item }
        }
      }
      return $items
    } finally { Safe-Dispose $reader }
  } finally { Safe-Dispose $response }
}

function Ensure-Directory(
  [string]$FtpHost,
  [int]$Port,
  [string]$RemotePath,
  [string]$Username,
  [string]$Password,
  [bool]$Tls
) {
  $normalized = Normalize-Path $RemotePath
  if ($normalized -eq '/') { return }
  $parts = $normalized.Trim('/').Split('/')
  $current = ''
  foreach ($part in $parts) {
    if ([string]::IsNullOrWhiteSpace($part)) { continue }
    $current += '/' + $part
    try {
      [void](List-Directory $FtpHost $Port $current $Username $Password $Tls)
    } catch {
      try {
        $request = New-FtpRequest $FtpHost $Port $current ([Net.WebRequestMethods+Ftp]::MakeDirectory) $Username $Password $Tls
        $response = $request.GetResponse()
        Safe-Dispose $response
      } catch {
        try { [void](List-Directory $FtpHost $Port $current $Username $Password $Tls) }
        catch { throw }
      }
    }
  }
}

function Get-RemoteFileSize(
  [string]$FtpHost,
  [int]$Port,
  [string]$RemotePath,
  [string]$Username,
  [string]$Password,
  [bool]$Tls
) {
  $response = $null
  try {
    $request = New-FtpRequest $FtpHost $Port $RemotePath ([Net.WebRequestMethods+Ftp]::GetFileSize) $Username $Password $Tls 15000
    $response = $request.GetResponse()
    return [long]$response.ContentLength
  } catch {
    return [long]-1
  } finally {
    Safe-Dispose $response
  }
}

function Test-DefinitiveFtpError([string]$Message) {
  return [bool]($Message -match '\\([45][0-9][0-9]\\)')
}

function Upload-File(
  [string]$FtpHost,
  [int]$Port,
  [string]$RemotePath,
  [string]$LocalPath,
  [string]$Username,
  [string]$Password,
  [bool]$Tls,
  [long]$Offset = 0,
  [long]$Length = 0,
  [bool]$Fast = $false
) {
  $local = [IO.Path]::GetFullPath($LocalPath)
  if (-not [IO.File]::Exists($local)) { throw "Local file not found: $local" }
  $parent = (Normalize-Path ([IO.Path]::GetDirectoryName((Normalize-Path $RemotePath)).Replace('\','/')))
  if ($parent -and $parent -ne '/' -and $parent -ne '.') {
    Ensure-Directory $FtpHost $Port $parent $Username $Password $Tls
  }

  $totalSize = [long](Get-Item -LiteralPath $local).Length
  if ($Offset -lt 0 -or $Offset -gt $totalSize) { throw "Invalid upload offset: $Offset" }
  $available = [long]($totalSize - $Offset)
  $size = if ($Length -gt 0 -and $Length -lt $available) { [long]$Length } else { $available }
  if ($size -lt 0) { throw "Invalid upload length: $Length" }

  $maxAttempts = if ($Fast) { 1 } else { 2 }
  $lastError = ''
  for ($attempt=1; $attempt -le $maxAttempts; $attempt++) {
    $inputStream = $null
    $outputStream = $null
    $response = $null
    $writeCompleted = $false
    try {
      $request = New-FtpRequest $FtpHost $Port $RemotePath ([Net.WebRequestMethods+Ftp]::UploadFile) $Username $Password $Tls 45000
      $request.ContentLength = $size
      $inputStream = [IO.File]::OpenRead($local)
      if ($Offset -gt 0) { [void]$inputStream.Seek($Offset, [IO.SeekOrigin]::Begin) }
      $outputStream = $request.GetRequestStream()
      $buffer = New-Object byte[] (1024 * 1024)
      $remaining = [long]$size
      while ($remaining -gt 0) {
        $want = [int][Math]::Min([long]$buffer.Length, $remaining)
        $read = $inputStream.Read($buffer,0,$want)
        if ($read -le 0) { throw "Unexpected end of local file while uploading range" }
        $outputStream.Write($buffer,0,$read)
        $remaining -= $read
      }
      $outputStream.Flush()
      Safe-Dispose $outputStream
      $outputStream = $null
      Safe-Dispose $inputStream
      $inputStream = $null
      $writeCompleted = $true
      try {
        $response = $request.GetResponse()
        return @{ bytes=$size; status='confirmed'; ftpConfirmed=$true; attempts=$attempt }
      } catch {
        $lastError = [string]$_.Exception.Message
        if ($Fast) {
          return @{ bytes=$size; status='sent-unconfirmed'; ftpConfirmed=$false; attempts=$attempt; error=$lastError }
        }
        $remoteSize = Get-RemoteFileSize $FtpHost $Port $RemotePath $Username $Password $Tls
        if ($remoteSize -eq $size) {
          return @{ bytes=$size; status='confirmed-size'; ftpConfirmed=$true; attempts=$attempt }
        }
        if (-not (Test-DefinitiveFtpError $lastError)) {
          return @{ bytes=$size; status='sent-unconfirmed'; ftpConfirmed=$false; attempts=$attempt; error=$lastError }
        }
        throw
      }
    } catch {
      $lastError = [string]$_.Exception.Message
      if ($writeCompleted) {
        if ($Fast) {
          return @{ bytes=$size; status='sent-unconfirmed'; ftpConfirmed=$false; attempts=$attempt; error=$lastError }
        }
        $remoteSize = Get-RemoteFileSize $FtpHost $Port $RemotePath $Username $Password $Tls
        if ($remoteSize -eq $size) {
          return @{ bytes=$size; status='confirmed-size'; ftpConfirmed=$true; attempts=$attempt }
        }
        if (-not (Test-DefinitiveFtpError $lastError)) {
          return @{ bytes=$size; status='sent-unconfirmed'; ftpConfirmed=$false; attempts=$attempt; error=$lastError }
        }
      }
      if ($attempt -ge $maxAttempts) {
        throw "FTP upload failed after $maxAttempts attempts: $lastError"
      }
      Start-Sleep -Seconds 1
    } finally {
      Safe-Dispose $response
      Safe-Dispose $outputStream
      Safe-Dispose $inputStream
    }
  }
  throw "FTP upload failed: $lastError"
}
function Delete-File(
  [string]$FtpHost,
  [int]$Port,
  [string]$RemotePath,
  [string]$Username,
  [string]$Password,
  [bool]$Tls
) {
  try {
    $request = New-FtpRequest $FtpHost $Port $RemotePath ([Net.WebRequestMethods+Ftp]::DeleteFile) $Username $Password $Tls
    $response = $request.GetResponse()
    Safe-Dispose $response
    return $true
  } catch {
    if ($_.Exception.Message -match '550|not found|does not exist') { return $false }
    throw
  }
}

$payload = Read-Payload
$action = [string]$payload.action
if (-not $action) { Fail 'Missing action' 'ACTION_MISSING' }

try {
  if ($action -eq 'selftest') {
    $FtpHost = [string]$payload.host
    $port = if ($payload.port) { [int]$payload.port } else { 21 }
    $username = [string]$payload.username
    $password = [string]$payload.password
    $tls = ([string]$payload.protocol).ToLowerInvariant() -ne 'ftp'
    $remoteRoot = Normalize-Path ([string]$payload.remotePath)
    if (-not $FtpHost -or -not $username -or -not $password) { Fail 'Selftest connection data missing' 'SELFTEST_INVALID' }
    $protocolName = if ($tls) { 'ftps' } else { 'ftp' }
    $selftestUri = Ftp-Uri $FtpHost $port $remoteRoot
    $selftestRequest = New-FtpRequest $FtpHost $port $remoteRoot ([Net.WebRequestMethods+Ftp]::ListDirectory) $username $password $tls
    if (-not $selftestRequest -or -not $selftestUri) { Fail 'Selftest request construction failed' 'SELFTEST_REQUEST_FAILED' }
    Out-Json @{
      ok=$true
      action='selftest'
      host=$FtpHost
      port=$port
      protocol=$protocolName
      remotePath=$remoteRoot
      uri=$selftestUri.AbsoluteUri
    }
    exit 0
  }
  if ($action -eq 'discover') {
    $domain = ([string]$payload.domain).Trim().ToLowerInvariant()
    $username = [string]$payload.username
    $password = [string]$payload.password
    if (-not $domain -or -not $username -or -not $password) { Fail 'Domain, username and password are required' 'CREDENTIALS_MISSING' }

    $hosts = @($domain, "ftp.$domain") | Select-Object -Unique
    $attempts = @()
    foreach ($FtpHost in $hosts) {
      foreach ($tls in @($true,$false)) {
        $protocol = if ($tls) { 'ftps' } else { 'ftp' }
        try {
          [void](List-Directory $FtpHost 21 '/' $username $password $tls)
          $paths = @(
            "/domains/$domain/public_html",
            '/public_html',
            '/httpdocs',
            '/www'
          ) | Select-Object -Unique
          foreach ($candidate in $paths) {
            try {
              $entries = @(List-Directory $FtpHost 21 $candidate $username $password $tls)
              $blocking = @($entries | Where-Object { $_ -and $_ -notin @('.well-known','.ftpquota') })
              Out-Json @{
                ok=$true
                host=$FtpHost
                port=21
                protocol=$protocol
                passive=$true
                remotePath=(Normalize-Path $candidate)
                entries=$entries
                siteNotEmpty=($blocking.Count -gt 0)
                blockingEntries=@($blocking | Select-Object -First 20)
                attempts=$attempts
              }
              exit 0
            } catch {
              $attempts += ($protocol + '://' + $FtpHost + $candidate + ' => ' + $_.Exception.Message)
            }
          }
        } catch {
          $attempts += ($protocol + '://' + $FtpHost + '/ => ' + $_.Exception.Message)
        }
      }
    }
    $recentAttempts = @($attempts | Select-Object -Last 4)
    $detail = ''
    if ($recentAttempts.Count -gt 0) {
      $detail = [string]::Join(' | ', [string[]]$recentAttempts)
    }
    $message = 'FTP/FTPS and website path auto-discovery failed.'
    if ($detail) { $message += ' ' + $detail }
    Fail $message 'FTP_DISCOVERY_FAILED'
  }

  $FtpHost = [string]$payload.host
  $port = if ($payload.port) { [int]$payload.port } else { 21 }
  $username = [string]$payload.username
  $password = [string]$payload.password
  $tls = ([string]$payload.protocol).ToLowerInvariant() -ne 'ftp'
  $remoteRoot = Normalize-Path ([string]$payload.remotePath)
  if (-not $FtpHost -or -not $username -or -not $password) { Fail 'FTP connection data missing' 'CREDENTIALS_MISSING' }

  if ($action -eq 'probe-worker') {
    $holdMs = if ($payload.holdMs) { [int]$payload.holdMs } else { 1200 }
    $holdMs = [Math]::Max(100, [Math]::Min(5000, $holdMs))
    $response = $null
    try {
      $request = New-FtpRequest $FtpHost $port $remoteRoot ([Net.WebRequestMethods+Ftp]::ListDirectory) $username $password $tls 12000 $true
      $response = $request.GetResponse()
      Start-Sleep -Milliseconds $holdMs
    } finally {
      Safe-Dispose $response
    }
    Out-Json @{ ok=$true; action='probe-worker'; remotePath=$remoteRoot; holdMs=$holdMs }
    exit 0
  }

  if ($action -eq 'upload') {
    $results = @()
    foreach ($file in @($payload.files)) {
      $localPath = [string]$file.localPath
      $remoteName = [string]$file.remoteName
      if (-not $remoteName -or $remoteName.Contains('..') -or $remoteName.Contains('\')) {
        throw "Unsafe remote file name: $remoteName"
      }
      $remotePath = (Normalize-Path ($remoteRoot.TrimEnd('/') + '/' + $remoteName.TrimStart('/')))
      $offset = if ($null -ne $file.offset) { [long]$file.offset } else { [long]0 }
      $length = if ($null -ne $file.length) { [long]$file.length } else { [long]0 }
      $fast = if ($null -ne $file.fast) { [bool]$file.fast } else { $false }
      $upload = Upload-File $FtpHost $port $remotePath $localPath $username $password $tls $offset $length $fast
      $results += @{
        file=$remoteName
        bytes=[long]$upload.bytes
        offset=$offset
        length=$length
        status=[string]$upload.status
        ftpConfirmed=[bool]$upload.ftpConfirmed
        attempts=[int]$upload.attempts
      }
    }
    Out-Json @{ ok=$true; action='upload'; files=$results }
    exit 0
  }

  if ($action -eq 'delete') {
    $results = @()
    foreach ($remoteName in @($payload.files)) {
      $name = [string]$remoteName
      if (-not $name -or $name.Contains('..') -or $name.Contains('\') -or $name.Contains('/')) {
        throw "Unsafe remote file name: $name"
      }
      $remotePath = (Normalize-Path ($remoteRoot.TrimEnd('/') + '/' + $name))
      $deleted = Delete-File $FtpHost $port $remotePath $username $password $tls
      $results += @{ file=$name; deleted=$deleted }
    }
    Out-Json @{ ok=$true; action='delete'; files=$results }
    exit 0
  }

  Fail "Unsupported action: $action" 'ACTION_UNSUPPORTED'
} catch {
  Fail $_.Exception.Message 'FRESH_INSTALL_RUNNER_FAILED'
}