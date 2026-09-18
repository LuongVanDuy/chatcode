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
  [int]$TimeoutMs = 12000
) {
  $request = [Net.FtpWebRequest]::Create((Ftp-Uri $FtpHost $Port $RemotePath))
  $request.Method = $Method
  $request.Credentials = New-Object Net.NetworkCredential($Username, $Password)
  $request.EnableSsl = $Tls
  $request.UsePassive = $true
  $request.UseBinary = $true
  $request.KeepAlive = $false
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
        if (-not [string]::IsNullOrWhiteSpace($line)) { $items += $line.Trim() }
      }
      return ,$items
    } finally { $reader.Dispose() }
  } finally { $response.Dispose() }
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
        $response.Dispose()
      } catch {
        try { [void](List-Directory $FtpHost $Port $current $Username $Password $Tls) }
        catch { throw }
      }
    }
  }
}

function Upload-File(
  [string]$FtpHost,
  [int]$Port,
  [string]$RemotePath,
  [string]$LocalPath,
  [string]$Username,
  [string]$Password,
  [bool]$Tls
) {
  $local = [IO.Path]::GetFullPath($LocalPath)
  if (-not [IO.File]::Exists($local)) { throw "Local file not found: $local" }
  $parent = (Normalize-Path ([IO.Path]::GetDirectoryName((Normalize-Path $RemotePath)).Replace('\','/')))
  if ($parent -and $parent -ne '/' -and $parent -ne '.') {
    Ensure-Directory $FtpHost $Port $parent $Username $Password $Tls
  }
  $request = New-FtpRequest $FtpHost $Port $RemotePath ([Net.WebRequestMethods+Ftp]::UploadFile) $Username $Password $Tls 30000
  $size = (Get-Item -LiteralPath $local).Length
  $request.ContentLength = $size
  $inputStream = [IO.File]::OpenRead($local)
  try {
    $output = $request.GetRequestStream()
    try {
      $buffer = New-Object byte[] (1024 * 1024)
      while (($read = $inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
        $output.Write($buffer,0,$read)
      }
    } finally { $output.Dispose() }
  } finally { $inputStream.Dispose() }
  $response = $request.GetResponse()
  $response.Dispose()
  return $size
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
    $response.Dispose()
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
            '/www',
            '/'
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

  if ($action -eq 'upload') {
    $results = @()
    foreach ($file in @($payload.files)) {
      $localPath = [string]$file.localPath
      $remoteName = [string]$file.remoteName
      if (-not $remoteName -or $remoteName.Contains('..') -or $remoteName.Contains('\')) {
        throw "Unsafe remote file name: $remoteName"
      }
      $remotePath = (Normalize-Path ($remoteRoot.TrimEnd('/') + '/' + $remoteName.TrimStart('/')))
      $bytes = Upload-File $FtpHost $port $remotePath $localPath $username $password $tls
      $results += @{ file=$remoteName; bytes=$bytes; status='uploaded' }
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