# Scans a Playlish profile folder for secrets stored in plain text and prints only file names and counts, never values.
# Usage (from the project folder):
#   powershell -ExecutionPolicy Bypass -File tools\audit\scan-profile.ps1
#   powershell -ExecutionPolicy Bypass -File tools\audit\scan-profile.ps1 -Profile "D:\some\other\profile"
param(
  [string]$Profile = (Join-Path $env:APPDATA 'Playlish')
)

if (-not (Test-Path $Profile)) { Write-Output "No profile at $Profile"; exit 0 }

# CHANGE HERE: patterns for secrets. Spotify access tokens start with BQ, refresh tokens with AQ.
$patterns = [ordered]@{
  # The look-behind stops matches in the middle of a longer base64 string (for example signatures).
  'Spotify access token'             = '(?<![A-Za-z0-9_+/-])BQ[A-Za-z0-9_-]{100,}'
  'Spotify refresh token'            = '(?<![A-Za-z0-9_+/-])AQ[A-Za-z0-9_-]{100,}'
  'Bearer header with a value'       = 'Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{20,}'
  'access_token or refresh_token value' = '(access_token|refresh_token)["'']?\s*[:=]\s*["'']?(?!\[REDACTED\])[A-Za-z0-9._-]{40,}'
}

# CHANGE HERE: folders that hold Google's signed Widevine component, which contains long signatures but never secrets.
$skip = @('WidevineCdm', 'component_crx_cache')
$files = Get-ChildItem $Profile -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $file = $_; $file.Length -lt 50MB -and -not ($skip | Where-Object { $file.FullName -like "*\$_\*" }) }
$hits = @()
foreach ($file in $files) {
  try { $bytes = [IO.File]::ReadAllBytes($file.FullName) } catch { continue }
  # Read as Latin-1 so binary databases (LevelDB, SQLite) are searched byte for byte, and also as UTF-16 for Chromium's
  # UTF-16 encoded storage values.
  $texts = @([Text.Encoding]::GetEncoding(28591).GetString($bytes), [Text.Encoding]::Unicode.GetString($bytes))
  foreach ($name in $patterns.Keys) {
    $count = 0
    foreach ($t in $texts) { $count += ([regex]::Matches($t, $patterns[$name])).Count }
    if ($count -gt 0) { $hits += [pscustomobject]@{ File = $file.FullName.Substring($Profile.Length).TrimStart('\'); Secret = $name; Count = $count } }
  }
}

Write-Output "Scanned $($files.Count) files in $Profile"
if ($hits.Count -eq 0) { Write-Output 'No plain-text secrets found.' } else { $hits | Format-Table -AutoSize | Out-String -Width 200 }
