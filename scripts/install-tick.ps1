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

# Jobs are clocked in Eastern time. 7:03 AM ET is 6:03 AM on this Central PC.
$Eastern = [TimeZoneInfo]::FindSystemTimeZoneById("Eastern Standard Time")
$Today = [DateTime]::Today
$EtStart = [DateTime]::new($Today.Year, $Today.Month, $Today.Day, 7, 3, 0, [DateTimeKind]::Unspecified)
$LocalStart = [TimeZoneInfo]::ConvertTimeFromUtc([TimeZoneInfo]::ConvertTimeToUtc($EtStart, $Eastern), [TimeZoneInfo]::Local)

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`"" -WorkingDirectory $Repo
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $LocalStart
$Repeat = New-ScheduledTaskTrigger -Once -At $LocalStart -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Hours 12)
$Trigger.Repetition = $Repeat.Repetition
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -DontStopOnIdleEnd -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Swing Tick" -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
Write-Host ("registered Swing Tick (weekdays {0:h:mm tt} local = 7:03 AM ET, every 15 minutes for 12 hours, wakes the PC)" -f $LocalStart)

Get-ScheduledTask | Where-Object { $_.TaskName -like "Swing *" } | ForEach-Object {
  Write-Host ("{0}  {1}" -f $_.TaskName, $_.State)
}
