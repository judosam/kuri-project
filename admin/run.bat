@echo off
title PhotoCapture Admin Portal (Port 5173)
cd /d "%~dp0"

echo ========================================================
echo        PhotoCapture Admin Web Portal (Port 5173)
echo ========================================================
echo.

call npm.cmd run dev

echo.
echo Admin Portal process stopped.
pause
