# One tick of the desk. Task Scheduler starts this every 15 minutes.
$ErrorActionPreference = "Stop"

$Repo = "C:\swing-trading-strategy"
$UvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $UvCmd) {
  throw "uv not found on PATH. Install uv, then reopen the session that Task Scheduler runs."
}
$Uv = $UvCmd.Source

Set-Location $Repo
$State = Join-Path $Repo "state"
New-Item -ItemType Directory -Force -Path $State | Out-Null
$Log = Join-Path $State "scheduler.log"
$Out = Join-Path $State "last-out.txt"
$Err = Join-Path $State "last-err.txt"
$Stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
Add-Content -Path $Log -Value "$Stamp start tick"

$Proc = Start-Process -FilePath $Uv -ArgumentList @("run", "swing", "tick") -WorkingDirectory $Repo -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $Out -RedirectStandardError $Err
Add-Content -Path $Log -Value "$Stamp end tick exit=$($Proc.ExitCode)"
exit $Proc.ExitCode
