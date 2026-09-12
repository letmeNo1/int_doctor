@echo off
rem One-click: Start Hospital Admin Backend + Cloudflare Tunnel (public URL)
cd /d "%~dp0"
start "" ".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8888
start "" "cloudflared.exe" tunnel --url http://127.0.0.1:8888 --no-autoupdate
echo.
echo Backend starting at  http://127.0.0.1:8888
echo Cloudflare tunnel starting, public URL appears in cloudflared.err.log
echo Check it with:  findstr "trycloudflare" cloudflared.err.log
pause
