@echo off
setlocal
start "lasttest backend" cmd /k "cd /d %~dp0backend && gradlew.bat bootRun"
start "lasttest frontend" cmd /k "cd /d %~dp0frontend && npm install && npm run dev"
echo lasttest wird gestartet. Browser: http://localhost:5173
