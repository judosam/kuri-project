@echo off
setlocal enabledelayedexpansion
title PhotoCapture Backend (Port 8005)
cd /d "%~dp0"

echo ========================================================
echo        PhotoCapture Backend Server (Port 8005)
echo ========================================================
echo.

set "PY_EXE=.venv\Scripts\python.exe"

if exist "%PY_EXE%" (
    "%PY_EXE%" -c "import sys" >nul 2>&1
    if !errorlevel! neq 0 (
        echo [fix  ] Virtual environment base path mismatch detected.
        echo [fix  ] Auto-repairing .venv\pyvenv.cfg for this PC...
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
                echo command = !SYS_PY! -m venv "%~dp0.venv"
            ) > "%~dp0.venv\pyvenv.cfg"
            echo [ok   ] Virtual environment successfully repaired!
        )
    )
) else (
    echo [warning] .venv not found. Falling back to system Python...
    where python >nul 2>&1
    if !errorlevel! equ 0 (
        set "PY_EXE=python"
    ) else (
        where py >nul 2>&1
        if !errorlevel! equ 0 (
            set "PY_EXE=py -3.12"
        ) else (
            echo [ERROR] Python not found on PATH.
            pause
            exit /b 1
        )
    )
)

echo Starting backend with %PY_EXE%...
%PY_EXE% start_dev.py

echo.
echo Backend process stopped.
pause
endlocal
