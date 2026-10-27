@echo off
title Self-Hosted OpenRouteService (ORS) Setup
echo ========================================================
echo   Self-Hosted OpenRouteService (ORS) - 0 Euro Routing
echo ========================================================
echo.

if not exist "%~dp0data" mkdir "%~dp0data"
if not exist "%~dp0graphs" mkdir "%~dp0graphs"
if not exist "%~dp0logs" mkdir "%~dp0logs"

echo Checking for OSM map file in ors-server\data...
if exist "%~dp0data\osm_file.pbf" (
    echo [OK] osm_file.pbf found.
) else (
    echo [NOTICE] osm_file.pbf not found.
    echo.
    echo Please place your regional OSM .osm.pbf file into:
    echo   %~dp0data\osm_file.pbf
    echo.
    echo For India, you can download:
    echo   https://download.geofabrik.de/asia/india-latest.osm.pbf
    echo   (or southern-zone-latest.osm.pbf for faster startup)
    echo.
    echo Once downloaded, rename it to 'osm_file.pbf' and save in ors-server\data\
    echo.
)

echo Starting OpenRouteService container via Docker Compose...
cd /d "%~dp0"
docker compose up -d

echo.
echo ========================================================
echo OpenRouteService container starting in background!
echo Endpoints:
echo   Health check: http://localhost:8080/ors/v2/health
echo   Directions:   http://localhost:8080/ors/v2/directions/driving-car
echo   Matrix:       http://localhost:8080/ors/v2/matrix/driving-car
echo ========================================================
pause
