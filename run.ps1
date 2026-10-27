# PhotoCapture Local Development Stack Launcher
$ErrorActionPreference = "Continue"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "       Starting PhotoCapture Local Development Stack" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# 1. Start Backend
Write-Host "[1/3] Starting FastAPI Backend on port 8000..." -ForegroundColor Green
Start-Process -FilePath "$ScriptDir\backend\run.bat" -WindowStyle Normal

Start-Sleep -Seconds 3

# 2. Start Admin Portal
Write-Host "[2/3] Starting Admin Web Portal on port 5173..." -ForegroundColor Green
Start-Process -FilePath "$ScriptDir\admin\run.bat" -WindowStyle Normal

Start-Sleep -Seconds 3

# 3. Start User Web App
Write-Host "[3/3] Starting User Web App on port 5174..." -ForegroundColor Green
Start-Process -FilePath "$ScriptDir\user-web\run.bat" -WindowStyle Normal

Start-Sleep -Seconds 4

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   All Services Started Successfully!" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   - Admin Portal:  http://localhost:5173/" -ForegroundColor White
Write-Host "   - User Web App:  http://localhost:5174/app/" -ForegroundColor White
Write-Host "   - API Swagger:   http://localhost:8000/docs" -ForegroundColor White
Write-Host "   - API Health:    http://localhost:8000/health" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Opening applications in your default browser..." -ForegroundColor Yellow

Start-Process "http://localhost:5173/"
Start-Process "http://localhost:5174/app/"

Write-Host "Tip: Run stop.bat anytime to terminate all local services." -ForegroundColor DarkGray
