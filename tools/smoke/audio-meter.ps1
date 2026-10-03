# Reads the Windows audio meter for given processes: the peak output level of their audio sessions on the default
# output device over a short window. Used by the smoke test to tell real sound from silence without anyone listening.
# Output: one JSON object, for example {"peak":0.35,"sessions":[{"pid":1234,"active":true,"volume":1,"muted":false,"peak":0.35}]}
param(
  [Parameter(Mandatory = $true)][int[]]$ProcessIds,
  [int]$Milliseconds = 2000   # CHANGE HERE: how long to watch the meter
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class PlaylishAudioMeter {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int EnumAudioEndpoints(int f, int s, out IntPtr d); int GetDefaultAudioEndpoint(int f, int r, out IMMDevice d); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 { int a(); int b(); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i, out IAudioSessionControl s); }
  [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl { int a(); int b(); int c(); int d(); int e(); int f(); int g(); int h(); int i(); int j(); int k(); int l(); }
  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 { int GetState(out int s); int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n); int SetDisplayName(string n, ref Guid g); int GetIconPath(out string p); int SetIconPath(string p, ref Guid g); int GetGroupingParam(out Guid g); int SetGroupingParam(ref Guid g, ref Guid c); int RegisterAudioSessionNotification(IntPtr n); int UnregisterAudioSessionNotification(IntPtr n); int GetSessionIdentifier(out string id); int GetSessionInstanceIdentifier(out string id); int GetProcessId(out uint pid); int IsSystemSoundsSession(); int SetDuckingPreference(bool b); }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume { int SetMasterVolume(float l, ref Guid g); int GetMasterVolume(out float l); int SetMute(bool m, ref Guid g); int GetMute(out bool m); }
  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation { int GetPeakValue(out float p); }

  public class SessionInfo { public uint Pid; public bool Active; public float Volume; public bool Muted; public float Peak; }

  public static List<SessionInfo> Measure(HashSet<uint> pids, int milliseconds) {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid g = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"); object o; dev.Activate(ref g, 23, IntPtr.Zero, out o);
    IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
    int n; se.GetCount(out n);
    var found = new List<KeyValuePair<SessionInfo, IAudioMeterInformation>>();
    for (int i = 0; i < n; i++) {
      IAudioSessionControl c; se.GetSession(i, out c);
      uint pid; ((IAudioSessionControl2)c).GetProcessId(out pid);
      if (!pids.Contains(pid)) continue;
      int st; ((IAudioSessionControl2)c).GetState(out st);
      var v = (ISimpleAudioVolume)c; float vol; bool mute; v.GetMasterVolume(out vol); v.GetMute(out mute);
      found.Add(new KeyValuePair<SessionInfo, IAudioMeterInformation>(new SessionInfo { Pid = pid, Active = st == 1, Volume = vol, Muted = mute }, (IAudioMeterInformation)c));
    }
    var end = DateTime.UtcNow.AddMilliseconds(milliseconds);
    while (DateTime.UtcNow < end) {
      foreach (var f in found) { float p; f.Value.GetPeakValue(out p); if (p > f.Key.Peak) f.Key.Peak = p; }
      System.Threading.Thread.Sleep(40);
    }
    var result = new List<SessionInfo>(); foreach (var f in found) result.Add(f.Key); return result;
  }
}
"@

$set = New-Object 'System.Collections.Generic.HashSet[uint32]'
foreach ($id in $ProcessIds) { [void]$set.Add([uint32]$id) }
$sessions = [PlaylishAudioMeter]::Measure($set, $Milliseconds)
$peak = 0.0; foreach ($s in $sessions) { if ($s.Peak -gt $peak) { $peak = $s.Peak } }
[pscustomobject]@{
  peak     = [math]::Round($peak, 4)
  sessions = @($sessions | ForEach-Object { [pscustomobject]@{ pid = $_.Pid; active = $_.Active; volume = [math]::Round($_.Volume, 3); muted = $_.Muted; peak = [math]::Round($_.Peak, 4) } })
} | ConvertTo-Json -Compress -Depth 4
