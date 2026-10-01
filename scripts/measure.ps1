# External cross-check of Playlish resource use (independent of the in-app logger).
# Sums every electron.exe process: working set, private bytes and CPU% over a sampling window.
# Usage: powershell -File scripts\measure.ps1 [-Seconds 30] [-ProcessName electron]
param(
  [int]$Seconds = 30,                 # CHANGE HERE: sampling window length
  [string]$ProcessName = 'electron'   # CHANGE HERE: use 'Playlish' once the packaged app exists
)

# Returns the total CPU seconds and process list for the app at this moment.
function Get-Snapshot {
  $procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
  [pscustomobject]@{
    Procs = @($procs)
    Cpu   = ($procs | Measure-Object -Property CPU -Sum).Sum
  }
}

$start = Get-Snapshot
if ($start.Procs.Count -eq 0) { Write-Error "No '$ProcessName' processes found."; exit 1 }
Start-Sleep -Seconds $Seconds
$end = Get-Snapshot

$wsMb   = [math]::Round((($end.Procs | Measure-Object -Property WorkingSet64 -Sum).Sum) / 1MB, 1)
$privMb = [math]::Round((($end.Procs | Measure-Object -Property PrivateMemorySize64 -Sum).Sum) / 1MB, 1)
$cpuPct = [math]::Round((($end.Cpu - $start.Cpu) / $Seconds / [Environment]::ProcessorCount) * 100, 2)

"Processes:        $($end.Procs.Count)"
"Working set (MB): $wsMb"
"Private (MB):     $privMb"
"CPU % (of all cores, avg over ${Seconds}s): $cpuPct"
