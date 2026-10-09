# Remove the four fixed Swing tasks and register one weekday tick.
$ErrorActionPreference = "Stop"

$Repo = "C:\swing-trading-strategy"
$Runner = Join-Path $Repo "scripts\run-tick.ps1"
if (-not (Test-Path $Runner)) {
  throw "Missing $Runner. Pull this version into $Repo first."
}

$Old = @("Swing Premarket", "Swing Intraday", "Swing Nightly", "Swing Report")
foreach ($Name in $Old) {
  $Existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if ($Existing) {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    Write-Host "removed $Name"
  }
}

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`"" -WorkingDirectory $Repo
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "7:03AM"
$Repeat = New-ScheduledTaskTrigger -Once -At "7:03AM" -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Hours 12)
$Trigger.Repetition = $Repeat.Repetition
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Swing Tick" -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
Write-Host "registered Swing Tick (weekdays 7:03 AM, every 15 minutes for 12 hours)"

Get-ScheduledTask | Where-Object { $_.TaskName -like "Swing *" } | ForEach-Object {
  Write-Host ("{0}  {1}" -f $_.TaskName, $_.State)
}
