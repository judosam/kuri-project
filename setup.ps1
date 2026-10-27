<#
.SYNOPSIS
    PhotoCapture Full Stack Setup & Dependency Installer
.DESCRIPTION
    Creates Python virtual environment in backend/.venv, installs pip requirements,
    and installs npm node_modules for admin and user-web.
#>

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "     PhotoCapture Full Stack Setup & Dependency Installer          " -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------
# 1. Check Python
# ---------------------------------------------------------------------
Write-Host "[1/5] Checking Python..." -ForegroundColor Yellow
$PythonCmd = $null
if (Get-Command "python" -ErrorAction SilentlyContinue) {
    $PythonCmd = "python"
} elseif (Get-Command "py" -ErrorAction SilentlyContinue) {
    $PythonCmd = "py -3"
}

if (-not $PythonCmd) {
    Write-Host "[ERROR] Python was not found in PATH!" -ForegroundColor Red
    Write-Host "Please install Python 3.10+ from https://www.python.org/" -ForegroundColor Red
    exit 1
}

$PyVersion = & $PythonCmd --version 2>&1
Write-Host "   Found: $PyVersion" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------------
# 2. Check Node.js and npm
# ---------------------------------------------------------------------
Write-Host "[2/5] Checking Node.js and npm..." -ForegroundColor Yellow
$NpmCmd = $null
if (Get-Command "npm.cmd" -ErrorAction SilentlyContinue) {
    $NpmCmd = "npm.cmd"
} elseif (Get-Command "npm" -ErrorAction SilentlyContinue) {
    $NpmCmd = "npm"
}

if (-not $NpmCmd) {
    Write-Host "[ERROR] Node.js / npm was not found in PATH!" -ForegroundColor Red
    Write-Host "Please install Node.js LTS from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

$NpmVersion = & $NpmCmd --version 2>&1
Write-Host "   Found npm: v$NpmVersion" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------------
# 3. Create .venv in backend/
# ---------------------------------------------------------------------
Write-Host "[3/5] Setting up Python Virtual Environment (backend\.venv)..." -ForegroundColor Yellow
$VenvDir = Join-Path $ScriptDir "backend\.venv"
$VenvPy = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvPy)) {
    Write-Host "   Creating virtual environment with $PythonCmd..." -ForegroundColor Cyan
    & $PythonCmd -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to create virtual environment." -ForegroundColor Red
        exit 1
    }
    Write-Host "   Virtual environment created." -ForegroundColor Green
} else {
    Write-Host "   Existing virtual environment found." -ForegroundColor Green
}

Write-Host "   Ensuring pip is available..." -ForegroundColor Cyan
& $VenvPy -m ensurepip --default-pip 2>$null

Write-Host "   Upgrading pip..." -ForegroundColor Cyan
& $VenvPy -m pip install --upgrade pip --quiet

Write-Host "   Installing backend requirements from backend\requirements.txt..." -ForegroundColor Cyan
& $VenvPy -m pip install -r (Join-Path $ScriptDir "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install Python dependencies." -ForegroundColor Red
    exit 1
}
Write-Host "   Python dependencies installed successfully." -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------------
# 4. Install node_modules in admin and user-web
# ---------------------------------------------------------------------
Write-Host "[4/5] Installing npm dependencies..." -ForegroundColor Yellow

Write-Host "   [A] Installing admin portal dependencies (admin\node_modules)..." -ForegroundColor Cyan
Push-Location (Join-Path $ScriptDir "admin")
try {
    & $NpmCmd install
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed in admin/"
    }
} finally {
    Pop-Location
}
Write-Host "   Admin dependencies installed." -ForegroundColor Green

Write-Host "   [B] Installing user-web dependencies (user-web\node_modules)..." -ForegroundColor Cyan
Push-Location (Join-Path $ScriptDir "user-web")
try {
    & $NpmCmd install
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed in user-web/"
    }
} finally {
    Pop-Location
}
Write-Host "   User-web dependencies installed." -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------------
# 5. Configuration (.env)
# ---------------------------------------------------------------------
Write-Host "[5/5] Checking configuration (.env)..." -ForegroundColor Yellow
$EnvFile = Join-Path $ScriptDir ".env"
$EnvExample = Join-Path $ScriptDir ".env.example"
$BackendEnv = Join-Path $ScriptDir "backend\.env"

if (-not (Test-Path $EnvFile) -and (Test-Path $EnvExample)) {
    Copy-Item $EnvExample $EnvFile
    Write-Host "   Created .env from .env.example" -ForegroundColor Green
} else {
    Write-Host "   .env configuration exists." -ForegroundColor Green
}

if (Test-Path $EnvFile) {
    Copy-Item $EnvFile $BackendEnv -Force
    Write-Host "   Synchronized .env to backend\.env" -ForegroundColor Green
}

Write-Host ""
Write-Host "===================================================================" -ForegroundColor Green
Write-Host "                  SETUP COMPLETED SUCCESSFULLY!                    " -ForegroundColor Green
Write-Host "===================================================================" -ForegroundColor Green
Write-Host "  - Backend .venv        : backend\.venv [Ready]" -ForegroundColor White
Write-Host "  - Admin node_modules   : admin\node_modules [Ready]" -ForegroundColor White
Write-Host "  - User-Web node_modules: user-web\node_modules [Ready]" -ForegroundColor White
Write-Host "  - Configuration (.env) : Synchronized" -ForegroundColor White
Write-Host "===================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start all services, run: .\run.bat  or  .\run.ps1" -ForegroundColor Yellow
