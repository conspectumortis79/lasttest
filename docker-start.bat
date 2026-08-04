@echo off
setlocal enabledelayedexpansion

set URL=http://localhost:8286/
set TIMEOUT=300
set CONTAINER=lasttest

echo Starte lasttest via docker compose ...
docker compose up -d --build
if %errorlevel% neq 0 (
  echo FEHLER: docker compose up ist fehlgeschlagen.
  exit /b 1
)

echo.
echo Warte auf Container-Healthcheck (!CONTAINER!) ...
echo.

set /a ELAPSED=0

:WAIT_LOOP
for /f "usebackq delims=" %%s in (`docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}" !CONTAINER! 2^>nul`) do set STATUS=%%s
if not defined STATUS set STATUS=starting

if /i "!STATUS!"=="healthy" goto READY
if /i "!STATUS!"=="unhealthy" (
  echo FEHLER: Container meldet 'unhealthy'.
  docker compose logs --tail=80
  exit /b 1
)

timeout /t 2 /nobreak >nul
set /a ELAPSED=ELAPSED+2
if !ELAPSED! geq !TIMEOUT! (
  echo FEHLER: Container wurde nicht innerhalb von !TIMEOUT! Sekunden healthy.
  docker compose logs --tail=80
  exit /b 1
)
goto WAIT_LOOP

:READY
echo.
echo ============================================================
echo lasttest wurde erfolgreich gestartet.
echo Jetzt im Browser oeffnen: !URL!
echo Zum Beenden: docker compose down
echo ============================================================
endlocal
