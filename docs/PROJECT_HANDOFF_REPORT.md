# ESP32 Active-Learning Local Web Console — Complete AI Handoff & Architecture Report

> **Purpose of this document:** Give any developer or AI coding agent complete, accurate context about this repository's architecture, files, protocols, API contracts, design invariants, constraints, and test status so work can continue seamlessly.

---

## 1. Project Overview & Goals

* **Project Location:** `esp32_console/`
* **Core Mission:** Solve the "no monitor / no OS task manager" problem for ESP32 microcontrollers through a single **local web application** (`http://127.0.0.1:8000`) built **MicroPython-first**, while also supporting **other languages** (Arduino, C++, PlatformIO, ESP-IDF, Rust, `.bin` firmware & wireless OTA).
* **Core Design Pillars:**
  1. **Zero-Build Frontend:** Pure **HTML5 + CSS3 + Vanilla JavaScript** (no Node.js, no npm, no React/Vite, no external CDNs — works completely offline).
  2. **Active Learning Everywhere:** Every button, option, and metric includes an **`(i)` Info button** opening a *What / Why / How / Protocol Example / Pro Tip* drawer, paired with a live **Protocol X-Ray** strip, **Guided Missions**, **Starter Templates**, and a built-in **Virtual Demo ESP32 Simulator** so users can learn without hardware plugged in.
  3. **Kid-Friendly Separate Markdown Guide (`/guide`):** Renders `docs/GUIDE.md` via a custom zero-dependency Markdown renderer (`frontend/js/md_renderer.js`) with plain-English analogies, diagrams, real-hardware instructions, raw `.md` viewer, and download button.
  4. **Real Hardware First:** Supports USB Serial (`pyserial`), Wireless WebREPL (`websockets`), and `esptool` flashing, plus a `SIMULATOR` mode for testing and onboarding.

---

## 2. Tech Stack & Runtime Environment

* **Language & Runtime:** Python **3.12+** inside local `.venv` (no system Node/npm required).
* **Python Dependencies (`requirements.txt`):**
  * `fastapi`, `uvicorn[standard]`, `python-multipart` — Local web server, REST API, static hosting, WebSocket stream.
  * `pyserial` — USB serial port scanning and UART communication.
  * `esptool` — Chip probing, flash erase, single & multi-offset `.bin` flashing.
  * `mpremote` — Bundled MicroPython tooling dependency.
  * `websockets` — MicroPython wireless WebREPL client + test server.
  * `httpx`, `pytest` — Automated integration & API testing.
* **Launchers:**
  * Linux / macOS: `./run.sh` (creates `.venv` if absent, installs deps, starts `uvicorn backend.main:app --host 127.0.0.1 --port 8000`, opens browser).
  * Windows: `run.bat` (same flow using `.venv\Scripts\`).
* **URLs:**
  * Main Console: `http://127.0.0.1:8000/`
  * Kid-Friendly Guide: `http://127.0.0.1:8000/guide`

---

## 3. Complete Repository Map

```text
esp32_console/
├── README.md                              # Quick start & real-hardware usage summary
├── requirements.txt                       # Python dependencies
├── pytest.ini                             # Sets pythonpath=. and testpaths=tests
├── run.sh / run.bat                       # One-command cross-platform launchers
├── docs/
│   ├── GUIDE.md                           # Kid-friendly + real-hardware manual (served at /guide)
│   └── PROJECT_HANDOFF_REPORT.md          # This AI handoff report
├── backend/
│   ├── __init__.py
│   ├── main.py                            # FastAPI routes, page serving, REST + /ws/console WS
│   ├── device_manager.py                  # Session owner, asyncio.Lock, stream parser, WS fan-out
│   ├── transports/
│   │   ├── __init__.py
│   │   ├── base.py                        # Abstract DeviceTransport interface + capabilities dict
│   │   ├── serial_transport.py            # pyserial USB UART (safe DTR/RTS, VID/PID detection)
│   │   ├── webrepl_transport.py           # WebSocket ws://<ip>:8266 MicroPython WebREPL client
│   │   └── simulator_transport.py         # In-memory Virtual ESP32-S3 with Raw/Friendly REPL
│   ├── engines/
│   │   ├── __init__.py
│   │   ├── micropython_repl.py            # Raw/Friendly REPL engine: files, Wi-Fi, metrics, probes
│   │   ├── flasher.py                     # esptool subprocess wrapper + simulator flash practice
│   │   ├── firmware_updater.py            # Other langs: arduino-cli/pio/idf.py, HTTP & ArduinoOTA
│   │   └── crash_decoder.py               # Reset cause, Brownout & Guru Meditation decoder
│   └── helpers/
│       ├── __init__.py
│       ├── esp_console_agent.py           # MicroPython @METRIC streaming helper (non-blocking)
│       ├── ESPConsoleAgent.h              # Arduino/C++ @METRIC streaming header (non-blocking)
│       └── wifi_ap_fallback.py            # MicroPython `wifi_manager.py` (STA + 192.168.4.1 AP fallback)
├── frontend/
│   ├── index.html                         # 5-tab console shell, top control bar, X-Ray, Info Drawer
│   ├── guide.html                         # Separate /guide Markdown reader page
│   ├── css/
│   │   ├── style.css                      # Console dark/light themes, gauges, drawer, responsive layout
│   │   └── guide.css                      # Readable handbook layout + TOC sidebar
│   └── js/
│       ├── app.js                         # Shell, port refresh, WS client, state pill, tab switching
│       ├── learning.js                    # INFO_CATALOG for all (i) buttons, Missions, X-Ray strip
│       ├── terminal.js                    # Terminal output, command history, macros
│       ├── files.js                       # File tree, drag-drop upload, inline editor, templates
│       ├── wifi.js                        # Wi-Fi scan/connect, 1-Click Initial Setup, WebREPL wizard
│       ├── metrics.js                     # RAM/Flash/CPU/Temp gauges, 7-point Health Checkup, I2C/GPIO
│       ├── flasher.js                     # Chip probe, erase, .bin flasher, local build, OTA, crash UI
│       └── md_renderer.js                 # Zero-dependency Markdown->HTML renderer (tables, nested lists)
└── tests/
    └── test_console.py                    # 8 end-to-end automated tests
```

---

## 4. System Architecture & Data Flow

```text
Browser UI (Pure HTML + CSS + Vanilla JS)
  ├── REST fetch() calls ──────────────────┐
  └── WebSocket (/ws/console) ─────────────┼──► FastAPI (backend/main.py)
                                           │      │
                                           ▼      ▼
                                   DeviceManager (device_manager.py)
                                   - Owns single active DeviceTransport
                                   - Enforces asyncio.Lock across REPL/UART ops
                                   - Extracts @METRIC:{...}, >>> state, crash alerts
                                   - Broadcasts term / state / xray / metric / flash / alert
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              ▼                            ▼                            ▼
    MicroPythonReplEngine         Flasher / FirmwareUpdater       DeviceTransport
    (Raw REPL Ctrl+A..Ctrl+D)     (esptool, OTA, CLI bridge)     ├── SerialTransport (USB)
    - Files CRUD & .zip backup    - probe / erase / write_flash  ├── WebReplTransport (Wi-Fi)
    - Wi-Fi, AP fallback, WebREPL - local .bin / HTTP & espota   └── SimulatorTransport (Demo)
    - Metrics, Checkup, I2C/GPIO  - crash_decoder (Guru/Reset)
```

### Key Architectural Behaviors
1. **Unified Transport Abstraction (`DeviceTransport`):**
   * `SerialTransport`, `WebReplTransport`, and `SimulatorTransport` all share the exact same byte-stream contract (`connect`, `disconnect`, `write`, `hard_reset`, `enter_bootloader`, `capabilities`).
   * Because `MicroPythonReplEngine` speaks standard MicroPython Raw REPL (`\x01` / `\x04` / `\x02`) and Friendly REPL (`\x03` / `>>>`) over that stream, **File Explorer, Wi-Fi config, Health Checkup, I2C/GPIO probes, and Terminal work identically over USB, Wi-Fi WebREPL, and Simulator**.
2. **Command Mutex & Output Isolation (`DeviceManager` + `MicroPythonReplEngine`):**
   * All REPL transactions acquire `dm.lock` (`asyncio.Lock`) and set `repl._capturing = True`.
   * While `_capturing` is active, raw Base64/JSON protocol frames are routed strictly to the REPL engine and **not** echoed into the visible user terminal.
3. **Two-Mode Telemetry (Never Breaks Running Code):**
   * **On-Demand Mode:** Clicking *Sample Metrics Now* or *Run Full Health Checkup* executes a short Raw REPL snippet cleanly.
   * **Continuous Live Mode:** Dropping `esp_console_agent.py` (MicroPython) or `ESPConsoleAgent.h` (Arduino/C++) into a project emits `@METRIC:{...}` lines. `DeviceManager._on_transport_bytes()` buffers partial `@METRIC:` prefixes across UART reads, parses JSON into `metric` WebSocket events for gauges, and strips raw `@METRIC:` lines from the terminal view.
4. **Real Simulator Accuracy (`SimulatorTransport`):**
   * Emulates an ESP32-S3 LittleFS (`_SimVFS`), mocked MicroPython modules (`os`, `gc`, `machine`, `network`, `esp32`, `time`, `sys`, `webrepl`), async `main.py` execution, `Ctrl+C` interrupts, and Raw REPL (`\x01`..`\x04`) so the **actual** `MicroPythonReplEngine` code runs against it during tests and demos.

---

## 5. Complete API Surface (`backend/main.py`)

### Pages & Docs
* `GET /` — Main Console UI (`frontend/index.html`)
* `GET /guide` — Kid-Friendly Guide page (`frontend/guide.html`)
* `GET /api/guide-md[?download=1]` — Raw Markdown source (`docs/GUIDE.md`)

### Connection & Execution Control
* `GET /api/ports` — Lists USB serial ports (VID/PID labeled) + `SIMULATOR` + current status
* `POST /api/connect` — `{mode: "serial"|"webrepl"|"simulator", target, baudrate, password}`
* `POST /api/disconnect` — Closes active transport cleanly
* `POST /api/control/{action}` — Actions: `interrupt`, `aggressive_interrupt`, `soft_reset`, `hard_reset`, `enter_bootloader`, `safe_recovery`, `safe_recovery_disable_main`

### MicroPython Filesystem
* `GET /api/files?path=/` — Recursive directory tree (`os.ilistdir`)
* `GET /api/file?path=...` — Reads text or flags binary file
* `POST /api/file` — `{path, content}` UTF-8 write via Base64 chunks
* `POST /api/upload` — Multipart upload into `target_dir`
* `DELETE /api/file?path=...` — Recursive file/directory removal
* `POST /api/mkdir` | `POST /api/rename` | `POST /api/run-file` | `POST /api/make-main`
* `GET /api/backup-zip` — Streams in-memory `.zip` archive of entire ESP32 flash

### Metrics, Health & Hardware Probes
* `GET /api/metrics` — Heap RAM, Flash storage, CPU MHz, temp, Wi-Fi IP/RSSI, plain-English reset cause
* `POST /api/health-checkup` — 7-point Pass/Warn/Info board diagnostic scorecard
* `POST /api/metrics/gc` — Runs `gc.collect()`, returns before/after/freed bytes
* `POST /api/metrics/freq` — `{mhz}` sets `machine.freq()` (`80`/`160`/`240`)
* `POST /api/hardware/i2c-scan` — `{scl, sda}` scans I2C bus & identifies common devices (`0x3C`, `0x76`, etc.)
* `POST /api/hardware/gpio` — `{pin, action}` (`toggle`, `read`, `on`, `off`)

### Wi-Fi & Wireless WebREPL
* `GET /api/wifi/status` — `STA_IF`, `AP_IF`, saved `/wifi_config.json`
* `POST /api/wifi/scan` — Scans 2.4 GHz networks (`ssid`, `channel`, `rssi`, `security`)
* `POST /api/wifi/connect` — Writes `/wifi_config.json`, `/wifi_manager.py`, `/boot.py` and connects STA
* `POST /api/wifi/ap` — Starts manual Access Point (`192.168.4.1`)
* `POST /api/webrepl/setup` — Writes `/webrepl_cfg.py`, updates `/boot.py`, starts `webrepl.start(password=...)`
* `POST /api/wifi/initial-setup` — 1-click USB provisioning combining `wifi_connect` + `setup_webrepl`

### Firmware Flashing, Other Languages & Diagnostics
* `POST /api/flash/probe` — `esptool flash_id` chip/MAC/flash detection (or simulated)
* `POST /api/flash/erase` — `esptool erase_flash`
* `POST /api/flash/write` — Multipart `.bin` flash with `offsets_json` (supports multi-offset C++/IDF sets)
* `POST /api/flash/write-local` — Flashes `.bin` files already on local disk (e.g., from compiled projects)
* `GET /api/toolchains` — Checks availability of `arduino-cli`, `pio`, `idf.py`, `mpy-cross`
* `POST /api/toolchains/inspect` — Inspects project folder frameworks & `.bin` outputs
* `POST /api/toolchains/build` — Invokes `arduino-cli`, `pio`, or `idf.py` compile
* `POST /api/ota/upload` — Wireless HTTP multipart OTA or pure-Python ArduinoOTA (`espota`)
* `POST /api/crash/decode` — Parses panic cause, reset banner, backtrace PCs (+ optional `addr2line` on `.elf`)
* `GET /api/helpers/{name}` & `POST /api/helpers/install-agent`

### WebSocket Stream (`WS /ws/console`)
* Server → Client JSON envelopes:
  * `{"type": "state", "data": status_snapshot}`
  * `{"type": "term", "data": "<text>"}`
  * `{"type": "xray", "data": {"action", "protocol", "code", "explanation"}}`
  * `{"type": "metric", "data": {...}}`
  * `{"type": "flash", "data": {"line", "pct"}}`
  * `{"type": "alert", "data": {"severity", "title", "summary", "fix"}}`
* Client → Server: `{"type": "input", "data": "<keystrokes_or_cmd>"}`

---

## 6. Critical Invariants & Gotchas (Do Not Break!)

1. **DTR/RTS Safe Open (`serial_transport.py`):**
   * Always keep `ser.dtr = False; ser.rts = False` before `ser.open()`. Default `pyserial` behavior asserts DTR/RTS and reboots or enters bootloader on DevKits the moment the console connects.
2. **Release Serial Port Before `esptool` (`device_manager.py`):**
   * Always call `await dm.release_serial_if_busy(port)` before `esptool` subprocess commands; otherwise the OS rejects `esptool` with port busy / access denied.
3. **Chunked Raw REPL Writes (`micropython_repl.py`):**
   * Send Raw REPL payloads in `<= 256`-byte chunks and Base64 file writes in `384`-char chunks; real ESP32 UART/WebREPL buffers overflow on huge single bursts.
4. **Chip-Specific Flash Offsets (`flasher.js`):**
   * Classic `ESP32` MicroPython firmware flashes at `0x1000`; `ESP32-S2`, `ESP32-S3`, `ESP32-C3`, and `ESP32-C6` flash at `0x0`. C++/IDF 3-part presets use `[0x1000 or 0x0, 0x8000, 0x10000]`.
5. **WebREPL Password Rules (`micropython_repl.py`):**
   * MicroPython enforces **4 to 9 characters**. Always write `/webrepl_cfg.py`, ensure `webrepl.start()` is in `/boot.py`, and call `webrepl.start(password=...)` (with `TypeError` fallback to `webrepl.start()` for older firmware).
6. **Every `data-info` Must Exist in `INFO_CATALOG` (`learning.js`):**
   * Every UI button/option carries `data-info="<key>"`. Keep `INFO_CATALOG` in `frontend/js/learning.js` synchronized — `test_info_buttons_coverage_in_html` enforces this automatically.
7. **`@METRIC:` Prefix Buffering (`device_manager.py`):**
   * UART bytes may arrive character-by-character; keep the partial-prefix check (`"@METRIC:".startswith(stripped_left)`) intact so telemetry JSON never leaks into the terminal on real boards.

---

## 7. Verification Status

* **Automated Tests (`tests/test_console.py`):** **8 / 8 passing** via `.venv/bin/pytest -v`:
  1. `test_pages_and_guide_markdown` — `/`, `/guide`, `/api/guide-md`, raw download header.
  2. `test_simulator_full_micropython_workflow` — Ports, Simulator connect, `Ctrl+C`, file CRUD + `.zip` backup, multipart upload, metrics, `gc.collect()`, CPU freq, I2C, GPIO, Wi-Fi scan/connect + AP fallback, WebREPL `/webrepl_cfg.py` + `/boot.py`, 7-point `/api/health-checkup`, 1-click `/api/wifi/initial-setup`, disconnect.
  3. `test_flasher_simulator_and_crash_decoder` — Simulated probe/erase/flash + `LoadProhibited` crash & backtrace parser.
  4. `test_websocket_terminal_and_xray` — Live `/ws/console` state, interrupt, REPL eval (`print(6 * 7)` -> `42`).
  5. `test_info_buttons_coverage_in_html` — Validates all `data-info` keys in `index.html` exist in `learning.js`.
  6. `test_static_assets_and_helpers` — Verifies every CSS/JS asset in HTML + helper endpoints + 1-click agent install.
  7. `test_local_project_inspect_and_flash_write_local` — Temp Arduino `.ino` + `.bin` inspection & local `.bin` flashing.
  8. `test_webrepl_transport_handshake_and_stream` — Real WebSocket server handshake, wrong-password `PermissionError`, and bidirectional REPL stream.
* **Not Yet Hardware-Tested on This Host:** Live physical USB-attached ESP32 flashing/REPL (no `/dev/ttyUSB*` or `/dev/ttyACM*` board was plugged into the development machine during creation). All real-hardware pathways (`pyserial`, `esptool`, `WebReplTransport`, `arduino-cli`/`pio`/`idf.py`, `espota`) are implemented cleanly and ready for testing with a physical board.

---

## 8. Good Next Extensions (If Requested Later)

* Automatic MicroPython `.bin` firmware catalog downloader inside the Flash tab (fetching official release URLs from `micropython.org`).
* Local folder bidirectional project sync ("Upload changed `.py` files only" + optional `mpy-cross` `.mpy` bytecode pre-compilation).
* Live time-series sparkline chart inside **4. Metrics & Hardware** plotting `@METRIC:` RAM/RSSI/Temp history over time.
* Packaging as a standalone desktop executable (e.g., PyInstaller or Tauri wrapper around the local Python server).

