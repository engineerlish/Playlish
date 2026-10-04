# Finds Playlish's entry in the Windows media overlay (System Media Transport Controls) by track title and, optionally,
# presses one of its buttons, the same path media keys take. Used by the smoke test (#45).
# Only the session whose title matches is touched or reported, so other apps' media (and what they play) stay private.
# Output: one JSON line {"found":bool,"title":...,"artist":...,"status":...,"sent":bool|null}.
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [ValidateSet('find', 'pause', 'play', 'next')][string]$Action = 'find'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

# Waits for a WinRT async operation and returns its result.
function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
foreach ($session in $manager.GetSessions()) {
  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  if ($props.Title -ne $Title) { continue }
  $sent = $null
  switch ($Action) {
    'pause' { $sent = Await ($session.TryPauseAsync()) ([bool]) }
    'play' { $sent = Await ($session.TryPlayAsync()) ([bool]) }
    'next' { $sent = Await ($session.TrySkipNextAsync()) ([bool]) }
  }
  [pscustomobject]@{ found = $true; title = $props.Title; artist = $props.Artist; status = "$($session.GetPlaybackInfo().PlaybackStatus)"; sent = $sent } | ConvertTo-Json -Compress
  exit 0
}
[pscustomobject]@{ found = $false; title = $null; artist = $null; status = $null; sent = $null } | ConvertTo-Json -Compress
