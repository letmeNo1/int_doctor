@echo off
rem One-click launcher for "Consultation Recorder" (starts Python ASR backend automatically)
set "APP=%~dp0electron-app\node_modules\electron\dist\electron.exe"
if not exist "%APP%" (
  echo [ERROR] electron.exe not found. Run "npm install" in electron-app first.
  pause
  exit /b 1
)
cd /d "%~dp0electron-app"
start "" "%APP%" .
