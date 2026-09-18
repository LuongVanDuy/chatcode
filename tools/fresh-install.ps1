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
        if (-not [string]::IsNullOrWhiteSpace($line)) {
          $item = $line.Trim().Replace('\','/').TrimEnd('/')
          if ($item.Contains('/')) { $item = @($item.Split('/') | Where-Object { $_ })[-1] }
          if (-not [string]::IsNullOrWhiteSpace($item)) { $items += $item }
        }
      }
      return ,$items
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
  $size = [long](Get-Item -LiteralPath $local).Length
  $maxAttempts = 4
  $lastError = ''
  for ($attempt=1; $attempt -le $maxAttempts; $attempt++) {
    $inputStream = $null
    $outputStream = $null
    $response = $null
    try {
      $request = New-FtpRequest $FtpHost $Port $RemotePath ([Net.WebRequestMethods+Ftp]::UploadFile) $Username $Password $Tls 30000
      $request.ContentLength = $size
      $inputStream = [IO.File]::OpenRead($local)
      $outputStream = $request.GetRequestStream()
      $buffer = New-Object byte[] (1024 * 1024)
      while (($read = $inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
        $outputStream.Write($buffer,0,$read)
      }
      Safe-Dispose $outputStream
      $outputStream = $null
      Safe-Dispose $inputStream
      $inputStream = $null
      try {
        $response = $request.GetResponse()
        return $size
      } catch {
        $lastError = [string]$_.Exception.Message
        if ((Get-RemoteFileSize $FtpHost $Port $RemotePath $Username $Password $Tls) -eq $size) {
          return $size
        }
        throw
      }
    } catch {
      $lastError = [string]$_.Exception.Message
      if ((Get-RemoteFileSize $FtpHost $Port $RemotePath $Username $Password $Tls) -eq $size) {
        return $size
      }
      if ($attempt -ge $maxAttempts) {
        throw "FTP upload failed after $maxAttempts attempts: $lastError"
      }
      Start-Sleep -Seconds ([Math]::Min($attempt,3))
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