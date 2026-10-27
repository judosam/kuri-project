@echo off
setlocal enabledelayedexpansion
title PhotoCapture - Initial Project Setup and Dependency Installer
cd /d "%~dp0"

echo ===================================================================
echo     PhotoCapture Full Stack Setup and Dependency Installer
echo ===================================================================
echo   This script will automatically:
echo     1. Check Python and Node.js prerequisites
echo     2. Create Python virtual environment (.venv) in backend/
echo     3. Install Python dependencies (FastAPI, SQLAlchemy, etc.)
echo     4. Install npm dependencies (node_modules) in admin/ and user-web/
echo     5. Initialize local configuration (.env)
echo ===================================================================
echo.

:: ---------------------------------------------------------------------
:: 1. Check Python installation
:: ---------------------------------------------------------------------
echo [Step 1/5] Checking Python installation...
set "SYSTEM_PY="
where python >nul 2>nul
if %errorlevel% equ 0 (
    set "SYSTEM_PY=python"
) else (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        set "SYSTEM_PY=py -3"
    )
)

if "%SYSTEM_PY%"=="" (
    echo [ERROR] Python was not found in PATH!
    echo Please install Python 3.10, 3.11, or 3.12 from https://www.python.org/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('%SYSTEM_PY% --version 2^>^&1') do set "PY_VER=%%v"
echo    Found: %PY_VER%
echo.

:: ---------------------------------------------------------------------
:: 2. Check Node.js and npm
:: ---------------------------------------------------------------------
echo [Step 2/5] Checking Node.js and npm...
set "NPM_CMD="

call npm --version >nul 2>nul
if %errorlevel% equ 0 (
    set "NPM_CMD=npm"
) else (
    call npm.cmd --version >nul 2>nul
    if %errorlevel% equ 0 (
        set "NPM_CMD=npm.cmd"
    )
)

if "%NPM_CMD%"=="" (
    echo [ERROR] Node.js / npm was not found in PATH!
    echo Please install Node.js LTS version 18, 20, or 22 from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('%NPM_CMD% --version') do set "NPM_VER=%%v"
echo    Found npm: v%NPM_VER%
echo.

:: ---------------------------------------------------------------------
:: 3. Setup Python Virtual Environment (.venv) in backend/
:: ---------------------------------------------------------------------
echo [Step 3/5] Setting up Python Virtual Environment in backend\.venv...
set "VENV_DIR=backend\.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo    Creating virtual environment with %SYSTEM_PY%...
    %SYSTEM_PY% -m venv "%VENV_DIR%"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment!
        pause
        exit /b 1
    )
    echo    Virtual environment created successfully.
) else (
    echo    Existing virtual environment found at %VENV_DIR%.
)

echo    Ensuring pip is available in virtual environment...
"%VENV_PY%" -m ensurepip --default-pip >nul 2>nul

echo    Upgrading pip...
"%VENV_PY%" -m pip install --upgrade pip --quiet

echo    Installing Python dependencies from backend\requirements.txt...
"%VENV_PY%" -m pip install -r backend\requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python dependencies!
    pause
    exit /b 1
)
echo    Python dependencies installed successfully.
echo.

:: ---------------------------------------------------------------------
:: 4. Install npm node_modules in admin/ and user-web/
:: ---------------------------------------------------------------------
echo [Step 4/5] Installing frontend dependencies (node_modules)...

echo    [A] Installing admin portal dependencies (admin\node_modules)...
pushd admin
call %NPM_CMD% install
if %errorlevel% neq 0 (
    popd
    echo [ERROR] Failed to install npm packages in admin/!
    pause
    exit /b 1
)
popd
echo    Admin dependencies installed successfully.

echo.
echo    [B] Installing user-web app dependencies (user-web\node_modules)...
pushd user-web
call %NPM_CMD% install
if %errorlevel% neq 0 (
    popd
    echo [ERROR] Failed to install npm packages in user-web/!
    pause
    exit /b 1
)
popd
echo    User-web dependencies installed successfully.
echo.

:: ---------------------------------------------------------------------
:: 5. Initialize environment config (.env)
:: ---------------------------------------------------------------------
echo [Step 5/5] Checking configuration files...
if not exist ".env" (
    if exist ".env.example" (
        echo    Creating .env from .env.example...
        copy /Y ".env.example" ".env" >nul
        echo    Default .env created.
    ) else (
        echo    [WARN] Neither .env nor .env.example found.
    )
) else (
    echo    .env configuration exists.
)

:: Synchronize .env into backend/.env
if exist ".env" (
    copy /Y ".env" "backend\.env" >nul
    echo    Synchronized .env to backend\.env.
)

echo.
echo ===================================================================
echo                  SETUP COMPLETED SUCCESSFULLY!
echo ===================================================================
echo   - Backend .venv         : backend\.venv  [Ready]
echo   - Admin node_modules    : admin\node_modules  [Ready]
echo   - User-Web node_modules : user-web\node_modules  [Ready]
echo   - Configuration (.env)  : Configured and Synchronized
echo ===================================================================
echo.
echo To start all services at once, double-click:
echo    run.bat
echo.
echo Or run services individually:
echo    - backend\run.bat   (FastAPI on http://localhost:8000)
echo    - admin\run.bat     (Admin UI on http://localhost:5173)
echo    - user-web\run.bat  (User Web on http://localhost:5174/app/)
echo ===================================================================
echo.
pause
