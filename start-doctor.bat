@echo off
rem One-click launcher for Hospital Admin Backend (port 8888)
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo [ERROR] venv python not found. Run: .venv\Scripts\python -m pip install fastapi uvicorn qrcode pillow
  pause
  exit /b 1
)
cd /d "%~dp0"
start "" "%PY%" -m uvicorn app:app --host 127.0.0.1 --port 8888
start "" cmd /c "ping -n 5 127.0.0.1 >nul 2>&1 & start http://127.0.0.1:8888/"
