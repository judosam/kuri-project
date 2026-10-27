@echo off
setlocal
title Create Project Zip Archive

echo ========================================================
echo   Packing PhotoCapture Project into ZIP Archive
echo   Excluding: node_modules, .venv, git, build artifacts
echo ========================================================
echo.

python "%~dp0create_project_zip.py" %*

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Zip creation encountered an issue. Check Python installation.
    pause
    exit /b %ERRORLEVEL%
)

echo.
pause
