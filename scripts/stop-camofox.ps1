$serverPids = Get-NetTCPConnection -LocalPort 9377 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($null -eq $serverPids) {
  Write-Output "Camofox is not running on port 9377."
  exit 0
}

foreach ($serverPid in $serverPids) {
  & taskkill.exe /PID $serverPid /T /F
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
