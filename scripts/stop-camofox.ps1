$serverPids = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -ge 9377 -and $_.LocalPort -le 9386 } |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($null -eq $serverPids) {
  Write-Output "No managed Camofox browser is running."
  exit 0
}

foreach ($serverPid in $serverPids) {
  & taskkill.exe /PID $serverPid /T /F
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
