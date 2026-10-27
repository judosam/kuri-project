@echo off
title PhotoCapture User Web App (Port 5174)
cd /d "%~dp0"

echo ========================================================
echo        PhotoCapture User Web App (Port 5174)
echo ========================================================
echo.

call npm.cmd run dev

echo.
echo User Web App process stopped.
pause
