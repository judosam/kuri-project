# Run PowerShell as Administrator, once, on the development PC.
$ErrorActionPreference = "Stop"
New-NetFirewallRule -DisplayName "PhotoCapture API 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private -ErrorAction SilentlyContinue | Out-Null
Write-Host "PhotoCapture API port 8000 is allowed on Private networks."
