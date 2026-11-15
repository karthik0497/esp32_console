# ESP32 Active-Learning Local Web Console

A local, offline-friendly web workbench built for **real physical ESP32 boards** (MicroPython-first control + C++/Arduino/ESP-IDF `.bin` & OTA updates) with a built-in **Virtual Demo ESP32 Simulator**, **Active Learning `(i)` explanations on every control**, and a dedicated **Kid-Friendly Markdown Guide (`/guide`)**.

## Quick Start

### 1. Launch the Local Web App
* **Linux / macOS:**
  ```bash
  chmod +x run.sh
  ./run.sh
  ```
* **Windows:** Double-click `run.bat` (or run `.venv\Scripts\uvicorn backend.main:app --host 127.0.0.1 --port 8000`).

Open in your browser:
* **Main Console:** `http://127.0.0.1:8000`
* **Kid-Friendly Full Guide:** `http://127.0.0.1:8000/guide` (source: `docs/GUIDE.md`)

---

## Using With a Real Physical ESP32 Board

1. **USB Driver & Port Permissions:**
   * **Linux:** Grant serial access once and re-login:
     ```bash
     sudo usermod -aG dialout $USER
     ```
   * **Windows:** If your board doesn't show up under `COMx`, install the **CP210x** or **CH340** USB-UART driver and verify you are using a **data** USB cable (not charge-only).
   * Close Arduino IDE / Thonny / PuTTY before connecting so the port isn't busy.
2. **Flashing MicroPython (Blank or C++ Board):**
   * Open **5. Flash & Other Langs**, pick your USB port (`COM3` / `/dev/ttyUSB0`), click **Probe Chip Info** (hold `BOOT` if prompted).
   * Download the matching MicroPython `.bin` from `micropython.org/download`, pick your chip (`0x1000` for classic ESP32, `0x0` for ESP32-S2/S3/C3/C6), check **Erase first**, and click **Flash Firmware**.
3. **Connecting Safely & Managing Code:**
   * Pick your USB port at `115200 baud` and click **Connect** (opens safely with `dtr=False, rts=False` so running scripts aren't unexpectedly reset).
   * Use **Stop (`Ctrl+C`)**, **Force Stop**, **Soft Reboot**, **Hard Reset**, and **Safe Recovery** in the top bar.
   * Browse `/`, `/lib`, `boot.py`, `main.py` in **2. Files & Deploy**, upload/edit scripts, test starter templates, `Run File`, `Make main.py`, or download a full `.zip` backup.
4. **Initial Wi-Fi + WebREPL Setup -> Unplug USB:**
   * In **3. Wi-Fi & WebREPL**, scan 2.4 GHz Wi-Fi, enter your Wi-Fi password + a 4–9 char WebREPL password, and click **1-Click Full Wi-Fi + WebREPL Setup** (uploads `wifi_config.json`, `wifi_manager.py`, `boot.py`, and `webrepl_cfg.py`, connects Wi-Fi, and starts WebREPL right away).
   * Click **Use in Top Bar**, connect over **Wi-Fi WebREPL**, and unplug USB.
5. **Live System Metrics (While Code Runs):**
   * Click **Install Live Metrics Agent** in **4. Metrics & Hardware** to upload `/esp_console_agent.py` (MicroPython), or include `backend/helpers/ESPConsoleAgent.h` in Arduino/C++ sketches to stream live RAM, Flash, CPU MHz, Temp, and Wi-Fi RSSI without pausing your loop.
6. **Other Languages (C++ / Arduino / PlatformIO / ESP-IDF):**
   * Flash multi-offset `.bin` sets (`0x1000` / `0x8000` / `0x10000`), compile local projects (`arduino-cli`, `pio`, `idf.py`), push wireless **HTTP OTA** or **ArduinoOTA**, and decode **Guru Meditation Error** crash logs.

## Running Tests
```bash
.venv/bin/pytest -v
```
