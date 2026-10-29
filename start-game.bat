@echo off
setlocal
title Do Vui Tranh Bien - Halloween - may chu cuc bo
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 goto :nops

echo Dang khoi dong game tai http://localhost:8765/ ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\server.ps1" -Port 8765
if errorlevel 1 goto :failed
exit /b 0

:nops
echo [LOI] Khong tim thay Windows PowerShell tren may nay.
echo Cach khac: mo truc tiep file index.html bang Chrome hoac Edge - xem README.md.
pause
exit /b 1

:failed
echo.
echo [LOI] May chu game khong chay duoc. Doc thong bao phia tren.
pause
exit /b 1
