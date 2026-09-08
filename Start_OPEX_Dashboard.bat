@echo off
title OPEX Dashboard - Starting...
echo ============================================
echo   OPEX Dashboard - Starting...
echo ============================================
echo.

cd /d "%~dp0"

echo [1/2] Starting API Server on port 3001...
start "OPEX API Server" cmd /c "node opex-api.js"

echo [2/2] Waiting for server to start...
timeout /t 4 /nobreak >nul

echo [3/3] Opening Dashboard in browser...
start "" "%~dp0OPEX_Live_Dashboard.html"

echo.
echo ============================================
echo   Server Running: http://localhost:3001
echo   Dashboard: OPEX_Live_Dashboard.html
echo ============================================
echo.
echo Press any key to stop the server...
pause >nul

echo Stopping server...
taskkill /FI "WindowTitle eq OPEX API Server" /T /F >nul 2>&1
echo Server stopped.
timeout /t 2 >nul
