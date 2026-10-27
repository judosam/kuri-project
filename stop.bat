@echo off
title Stop PhotoCapture Local Stack
cd /d "%~dp0"

echo ========================================================
echo        Stopping PhotoCapture Local Services
echo ========================================================
echo.

echo Terminating processes on ports 8005 (Backend), 5173 (Admin), 5174 (User Web)...

for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :8005 ^| findstr LISTENING') do (
    echo Stopping Backend PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :5173 ^| findstr LISTENING') do (
    echo Stopping Admin Portal PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :5174 ^| findstr LISTENING') do (
    echo Stopping User Web App PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo All PhotoCapture local services have been stopped.
ping 127.0.0.1 -n 2 >nul
