@echo off
cd /d "%~dp0"

if not exist ".venv" (
  echo [ESP32 Console] Creating Python virtual environment...
  python -m venv .venv
  .venv\Scripts\pip install --upgrade pip
  .venv\Scripts\pip install -r requirements.txt
)

echo [ESP32 Console] Starting local web app at http://127.0.0.1:8000
echo [ESP32 Console] Kid-Friendly Guide available at http://127.0.0.1:8000/guide
start "" http://127.0.0.1:8000
.venv\Scripts\uvicorn backend.main:app --host 127.0.0.1 --port 8000

