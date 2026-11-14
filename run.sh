#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "[ESP32 Console] Creating Python virtual environment..."
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi

echo "[ESP32 Console] Starting local web app at http://127.0.0.1:8000"
echo "[ESP32 Console] Kid-Friendly Guide available at http://127.0.0.1:8000/guide"
(sleep 1.2 && command -v xdg-open >/dev/null && xdg-open "http://127.0.0.1:8000" >/dev/null 2>&1) &
exec .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000

