@echo off
setlocal enabledelayedexpansion

set BACKEND_PORT=8286
set FRONTEND_PORT=5173
set BACKEND_URL=http://localhost:%BACKEND_PORT%/
set FRONTEND_URL=http://localhost:%FRONTEND_PORT%/
set TIMEOUT=300

echo Starte lasttest Backend (neues Fenster) ...
start "lasttest backend" cmd /k "cd /d %~dp0backend && gradlew.bat bootRun"

echo Starte lasttest Frontend (neues Fenster) ...
start "lasttest frontend" cmd /k "cd /d %~dp0frontend && npm install && npm run dev"

echo.
echo Warte auf Backend  (!BACKEND_URL!)
echo Warte auf Frontend (!FRONTEND_URL!)
echo.

set /a ELAPSED=0

:WAIT_LOOP
curl -sf -o nul --max-time 2 !BACKEND_URL! 2>nul
if %errorlevel% neq 0 goto NOT_READY

curl -sf -o nul --max-time 2 !FRONTEND_URL! 2>nul
if %errorlevel% neq 0 goto NOT_READY

goto READY

:NOT_READY
timeout /t 1 /nobreak >nul
set /a ELAPSED=ELAPSED+1
if !ELAPSED! geq !TIMEOUT! (
  echo FEHLER: Services wurden nicht innerhalb von !TIMEOUT! Sekunden bereit.
  exit /b 1
)
goto WAIT_LOOP

:READY
echo Backend  ist erreichbar.
echo Frontend ist erreichbar.
echo.
echo ============================================================
echo lasttest wurde erfolgreich gestartet.
echo   Frontend (Vite Dev-Server):  !FRONTEND_URL!
echo   Backend  (Spring-Boot API):  !BACKEND_URL!
echo   Demo-API  zum Testen:        http://localhost:!BACKEND_PORT!/demo-api/products
echo Im Browser das Frontend oeffnen: !FRONTEND_URL!
echo Zum Beenden: beide cmd-Fenster schliessen.
echo ============================================================
endlocal
