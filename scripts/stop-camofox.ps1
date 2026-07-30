param([int]$Port = 9580)

# 依控制埠的監聽者 PID 關閉整個 Camofox 程序樹。
$serverPids = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -eq $Port } |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($null -eq $serverPids) {
  Write-Output "No managed Camofox browser is running."
  exit 0
}

foreach ($serverPid in $serverPids) {
  & taskkill.exe /PID $serverPid /T /F
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
