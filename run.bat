@echo off
setlocal enabledelayedexpansion
title PhotoCapture Launcher
cd /d "%~dp0"

echo ==========================================================
echo  PhotoCapture - Field Geotagging ^& Audit
echo  Backend  : http://127.0.0.1:8005  (FastAPI + SQLite)
echo  Admin    : http://127.0.0.1:5173  (Admin Web Portal)
echo  User App : http://127.0.0.1:5174  (Operator Web App)
echo ==========================================================
echo.

REM ---------- Verify & Self-Heal Python Environment ----------
set "PY_EXE=backend\.venv\Scripts\python.exe"

if exist "%PY_EXE%" (
    "%PY_EXE%" -c "import sys" >nul 2>&1
    if !errorlevel! neq 0 (
        echo [fix  ] Virtual environment base path mismatch detected.
        echo [fix  ] Auto-repairing backend\.venv\pyvenv.cfg for this PC...
        set "SYS_PY="
        for /f "delims=" %%I in ('where python 2^>nul') do (
            if not defined SYS_PY set "SYS_PY=%%I"
        )
        if defined SYS_PY (
            for %%D in ("!SYS_PY!") do set "SYS_HOME=%%~dpD"
            set "SYS_HOME=!SYS_HOME:~0,-1!"
            (
                echo home = !SYS_HOME!
                echo include-system-site-packages = false
                echo version = 3.12.10
                echo executable = !SYS_PY!
                echo command = !SYS_PY! -m venv "%~dp0backend\.venv"
            ) > "%~dp0backend\.venv\pyvenv.cfg"
            echo [ok   ] Virtual environment successfully repaired!
        )
    )
) else (
    echo [warning] backend\.venv not found. Falling back to system Python...
    where python >nul 2>&1
    if !errorlevel! equ 0 (
        set "PY_EXE=python"
    ) else (
        where py >nul 2>&1
        if !errorlevel! equ 0 (
            set "PY_EXE=py -3.12"
        ) else (
            echo [ERROR] Python not found on PATH. Please run setup.bat first.
            pause
            exit /b 1
        )
    )
)

REM ---------- 1. Backend (FastAPI on port 8005) ----------
netstat -ano | findstr ":8005" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [skip ] Backend already running on port 8005.
) else (
    echo [start] Backend on http://127.0.0.1:8005 ...
    start "PhotoCapture Backend :8005" cmd /k "cd /d "%~dp0backend" && call run.bat"
)

REM ---------- 2. Admin portal (Vite dev server on port 5173) ----------
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [skip ] Admin dev server already running on port 5173.
) else (
    echo [start] Admin portal on http://127.0.0.1:5173 ...
    start "PhotoCapture Admin :5173" cmd /k "cd /d "%~dp0admin" && call run.bat"
)

REM ---------- 3. Field-operator web app (Port 5174) ----------
netstat -ano | findstr ":5174" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [skip ] Operator web app already running on port 5174.
) else (
    echo [start] Operator web app on http://127.0.0.1:5174 ...
    start "PhotoCapture Operator Web :5174" cmd /k "cd /d "%~dp0user-web" && call run.bat"
)

REM ---------- Open portals in the default browser ----------
if /i "%~1"=="nobrowser" (
    echo [skip ] Browser auto-open disabled.
) else (
    echo [wait ] Giving the servers a moment to initialize...
    ping -n 6 127.0.0.1 >nul
    start "" http://127.0.0.1:5173/
    start "" http://127.0.0.1:5174/
)

echo.
echo All PhotoCapture services are running in their own windows.
echo To stop everything anytime, run: stop.bat
echo.
if /i not "%~1"=="nobrowser" pause
endlocal
