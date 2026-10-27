@echo off
setlocal
title PhotoCapture - One-Click Starter
cd /d "%~dp0"

echo ==========================================================
echo  PhotoCapture - Field Geotagging ^& Audit
echo  Starting backend, admin portal and operator web app...
echo ==========================================================
echo.

REM ---------------------------------------------------------------------
REM 1. Configuration - read login credentials from the single root .env
REM    (backend seeds its first admin from ADMIN_EMAIL / ADMIN_PASSWORD).
REM ---------------------------------------------------------------------
if not exist ".env" (
    if exist ".env.example" (
        copy /Y ".env.example" ".env" >nul
        echo [setup] Created .env from .env.example.
    )
)

set "ADMIN_EMAIL_VALUE=admin@photocapture.local"
set "ADMIN_PASSWORD_VALUE=admin123"

if exist ".env" (
    for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"ADMIN_EMAIL=" ".env" 2^>nul') do set "ADMIN_EMAIL_VALUE=%%b"
    for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"ADMIN_PASSWORD=" ".env" 2^>nul') do set "ADMIN_PASSWORD_VALUE=%%b"
)

REM Strip optional surrounding quotes ("value" -> value). Safe because the
REM variables above are always defined at this point.
set "ADMIN_EMAIL_VALUE=%ADMIN_EMAIL_VALUE:"=%"
set "ADMIN_PASSWORD_VALUE=%ADMIN_PASSWORD_VALUE:"=%"

REM ---------------------------------------------------------------------
REM 2. Prerequisite checks
REM ---------------------------------------------------------------------
if not exist "backend\.venv\Scripts\python.exe" (
    echo [ERROR] backend\.venv not found.
    echo         Run setup.bat first to create it, then start.bat again.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if not %errorlevel%==0 (
    echo [ERROR] npm was not found in PATH. Install Node.js LTS from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM ---------------------------------------------------------------------
REM 3. Start servers (each in its own window; skipped if already running)
REM ---------------------------------------------------------------------
netstat -ano | findstr /c:":8000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [skip ] Backend already running on port 8000.
) else (
    echo [start] Backend        on http://localhost:8000
    start "PhotoCapture Backend :8000" /D "%~dp0backend" cmd /k ".venv\Scripts\python.exe start_dev.py"
)

netstat -ano | findstr /c:":5173 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [skip ] Admin portal already running on port 5173.
) else (
    echo [start] Admin portal   on http://localhost:5173
    start "PhotoCapture Admin :5173" /D "%~dp0admin" cmd /k "npm run dev"
)

netstat -ano | findstr /c:":5174 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [skip ] Operator web already running on port 5174.
) else (
    echo [start] Operator web   on http://localhost:5174/app
    start "PhotoCapture Operator Web :5174" /D "%~dp0user-web" cmd /k "npm run dev"
)

REM ---------------------------------------------------------------------
REM 4. Wait until the backend answers /health before showing the panel
REM    (kept outside parentheses so %errorlevel% is read after each step)
REM ---------------------------------------------------------------------
where curl >nul 2>nul
if not %errorlevel%==0 (
    echo [wait ] curl not found - giving the servers a few seconds...
    ping -n 9 127.0.0.1 >nul
    goto show_panel
)

echo [wait ] Waiting for the backend health probe...
call :wait_for_url "http://127.0.0.1:8000/health" 25
if %errorlevel%==0 (
    echo [  ok  ] Backend is healthy.
) else (
    echo [warn  ] Backend not confirmed yet - it may still be starting.
)

:show_panel
REM ---------------------------------------------------------------------
REM 5. Show the sign-in panel and open both portals
REM ---------------------------------------------------------------------
echo.
echo ==================================================================
echo                PHOTO CAPTURE IS READY - SIGN IN
echo ==================================================================
echo    Admin Portal (management) : http://localhost:5173/
echo    Operator Web  (field app) : http://localhost:5174/app/
echo    API Docs (Swagger)        : http://localhost:8000/docs
echo    Health Probe              : http://localhost:8000/health
echo ------------------------------------------------------------------
echo    Username : %ADMIN_EMAIL_VALUE%
echo    Password : %ADMIN_PASSWORD_VALUE%
echo ------------------------------------------------------------------
echo    The same account works on both portals.
echo    Change it in the .env file (ADMIN_EMAIL / ADMIN_PASSWORD),
echo    then restart - or edit it from within the app later.
echo ==================================================================
echo.

start "" "http://localhost:5173/"
start "" "http://localhost:5174/app/"

echo Servers run in their own windows - close a window to stop that server.
echo Tip: run stop.bat to terminate all local services.
echo.
pause
exit /b 0

REM ---------------------------------------------------------------------
:wait_for_url
REM Polls %~1 with curl every ~1s, up to %~2 tries. Returns 0 when reachable.
set /a wf_tries=0
:wait_for_url_loop
curl -s -o NUL -m 2 "%~1" >nul 2>&1
if %errorlevel%==0 exit /b 0
set /a wf_tries+=1
if %wf_tries% GEQ %~2 exit /b 1
ping -n 2 127.0.0.1 >nul
goto wait_for_url_loop
