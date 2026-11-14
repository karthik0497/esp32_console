# ESP32 Console — Complete Guide (Real Hardware + Active Learning)

Welcome! If you just bought your first **ESP32** board and wondered *"Why is nothing showing up? How do I flash it, see what's running, upload files, check RAM, or change Wi-Fi?"* — you are in the exact right place.

Unlike a laptop or phone, a tiny microcontroller like the ESP32 **does not have its own monitor, keyboard, or desktop screen**. This local web console works with **REAL physical ESP32 boards** (over USB Serial and wireless Wi-Fi WebREPL) and also includes a **Virtual Demo Simulator** so anyone can practice safely before plugging in hardware.

---

## 1. The 30-Second Picture: How an ESP32 Works

Think of your ESP32 like a **tiny robot student at a study desk**:

```text
+-------------------------------------------------------------------+
|                        INSIDE YOUR ESP32                          |
|                                                                   |
|  [ 1. FLASH MEMORY (The School Backpack) ]                        |
|   - Holds Firmware (MicroPython or C++ brain)                     |
|   - Holds your files: boot.py, main.py, wifi_config.json, /lib    |
|   - REMEMBERS everything even when you unplug the USB cable!      |
|                                                                   |
|  [ 2. RAM MEMORY (The Study Desk) ]                               |
|   - Fast space where the ESP32 thinks while running code          |
|   - Holds variables, Wi-Fi buffers, sensor numbers                |
|   - WIPED CLEAN every time you restart or unplug power!           |
|                                                                   |
|  [ 3. USB / Wi-Fi (The Walkie-Talkie) ]                           |
|   - USB Serial: Wired connection for flashing, fixing & chatting  |
|   - WebREPL: Wireless Wi-Fi connection after first setup!         |
+-------------------------------------------------------------------+
```

### MicroPython vs. C++ / Arduino / ESP-IDF
* **MicroPython** puts a live Python interpreter *inside* the ESP32. That means you can talk to it live (`>>>`), browse directories, edit `main.py`, check free RAM, and change Wi-Fi **without rebuilding firmware**.
* **C++ / Arduino / ESP-IDF / Rust** compiles your code on your PC into `.bin` files and flashes them straight to the chip. It runs super fast, but has **no built-in file browser or Python prompt** — so for those languages you use the **Flasher**, **Serial Monitor**, **Crash Decoder**, and **Wireless OTA Update** tools!

---

## 2. Option A vs. Option B: Simulator vs. Real Physical ESP32

### Option A: Practice First Without Hardware (`SIMULATOR`)
1. At the top of the console, select **`SIMULATOR — Virtual Demo ESP32-S3`**.
2. Click **Connect**.
3. Turn **Active Learning: ON** and watch `main.py` blink a virtual LED, stream live RAM metrics, and respond to **Stop (`Ctrl+C`)**, file uploads, Wi-Fi scans, and flashing!

### Option B: Connect a REAL Physical ESP32 Board (Step-by-Step)

#### Step 1: Check Your USB Cable & Port
1. **Use a REAL USB Data Cable:** Many phone charging cables only have power wires inside and zero data wires. If no port appears, try a different cable!
2. **Dual USB-C Boards (ESP32-S3 / C3):** Some newer DevKits have two USB-C ports labeled `UART` (or `COM`) and `USB`. Start with the **`UART` / `COM`** port for reliable `esptool` flashing and boot logs.
3. **Install USB Drivers (Windows only, if port doesn't appear):**
   * Boards with square chip `CP2102` → install **Silicon Labs CP210x** driver.
   * Boards with rectangular chip `CH340` / `CH9102` → install **WCH CH340/CH341** driver.
4. **Linux Serial Permission (One-Time Setup):**
   * If connecting to `/dev/ttyUSB0` or `/dev/ttyACM0` says *Permission Denied*, run once in terminal, then **log out and log back in**:
     ```bash
     sudo usermod -aG dialout $USER
     ```
5. **Close Other Serial Apps:** Only one program can hold a USB port at a time. Close Arduino IDE Serial Monitor, Thonny, PuTTY, or PlatformIO Monitor before clicking **Connect** or **Flash**.

#### Step 2: Flash MicroPython Onto Your Real ESP32 (If Blank or Running C++)
If your ESP32 is brand new or currently has an Arduino/factory sketch on it:
1. Download the official MicroPython `.bin` firmware for your exact board from `https://micropython.org/download/`.
2. Open the **5. Flash & Other Langs** tab in this console.
3. Select your real port (`COM3` / `/dev/ttyUSB0`) and click **Probe Chip Info**.
   * *If it stalls on `Connecting.......`*: hold down the **`BOOT`** button on the ESP32, tap **`EN` / `RST`**, then release **`BOOT`**.
4. Select your chip family (`ESP32`, `ESP32-S3`, `ESP32-C3`, etc.) — the console automatically sets the right flash offset:

| Chip Family | MicroPython Flash Offset | Notes |
| :--- | :--- | :--- |
| **Classic ESP32** | **`0x1000`** | Standard DevKit V1 / WROOM / WROVER |
| **ESP32-S2 / S3 / C3 / C6** | **`0x0`** | Newer chips start bootloader at `0x0` |

5. Check **Erase first** (strongly recommended when switching from Arduino/C++ to MicroPython).
6. Choose your downloaded `.bin` file and click **Flash Firmware**. Wait until `100%` completes (do not unplug USB!).
7. Press the **`RST` / `EN`** button once after flashing finishes.

#### Step 3: Connect & Talk to Your Real ESP32
1. Go back to the top bar, pick your port (`COM3` / `/dev/ttyUSB0`) at **`115200 baud`**, and click **Connect**.
   > **Why doesn't Connect restart my board?**
   > Unlike many tools, this console opens serial with `dtr=False, rts=False` so it doesn't accidentally reboot whatever your ESP32 is already running!
2. If your board already has `main.py` running in a loop, click **Stop (`Ctrl+C`)** to pause it and see `>>>`.
3. Try clicking **Quick Macros** like **Chip Info**, **Check RAM**, or **Toggle LED (Pin 2)**!

---

## 3. Knowing What Your Board Is Doing & Stopping Stuck Code

Look at the **Status Pill** at the top of the console:
* **Running `main.py` (Pulsing Blue):** Your project loop is actively working!
* **Idle at REPL `>>>` (Green):** The ESP32 is waiting politely for your commands.
* **Bootloader Mode (Amber):** The chip is waiting to receive `.bin` firmware from `esptool`.
* **Crash / Error (Red):** A Brownout, Flash error, or Guru Meditation panic was detected.

### How `boot.py` and `main.py` Work
When a MicroPython ESP32 wakes up:
1. First it runs **`boot.py`** (*Morning checklist*: free memory, connect Wi-Fi, start WebREPL).
2. Next it runs **`main.py`** (*Main job*: blink LEDs, read sensors, run your robot).
3. When `main.py` finishes (or if there is no `main.py`), it drops to **`>>>`**.

### How to Stop Runaway Code (`while True:`)
If you uploaded a `main.py` that loops forever and locks up the terminal:
1. Click **Stop (`Ctrl+C`)** — sends `0x03` (`KeyboardInterrupt`).
2. If your loop has no `time.sleep()` pauses, click **Force Stop** (bursts five `Ctrl+C` signals).
3. If the chip is completely frozen or in deep sleep, click **Safe Recovery** — resets the board and floods `Ctrl+C` during boot, with an option to rename `/main.py` to `/main.py.bak` so nothing gets deleted!

---

## 4. File Directories, Code Updates & Templates

Open the **2. Files & Deploy** tab (works identically over **USB** and **Wi-Fi WebREPL**!):
* **Browse directories:** Click **Refresh Files** to see `/`, `/lib`, `boot.py`, `main.py`, `wifi_config.json`.
* **Starter Templates:** Use the **Load Starter Template...** dropdown above the editor to load beginner examples (*Blink LED*, *Live Telemetry Loop*, *Mini Web Server*, *Runaway Loop Practice*) in one click!
* **Upload files:** Drag and drop `.py`, `.json`, or `.mpy` files into `/` or `/lib`.
* **Run File:** Executes the open script right away without touching `/main.py`.
* **Make `main.py`:** Copies your tested script into `/main.py` so it auto-starts on every power-up.
* **Backup `.zip`:** Downloads every file from the ESP32 to your PC in one click.

---

## 5. Wi-Fi Setup & Unplugging the USB Cable (WebREPL)

### "Do I need USB the first time to set up Wi-Fi?"
**Normally, yes — once!** Out of the box, a fresh MicroPython ESP32 doesn't know your Wi-Fi name or password yet, and WebREPL is disabled.

1. Connect over **USB** first.
2. Open the **3. Wi-Fi & WebREPL** tab.
3. Click **Scan Wi-Fi** -> pick your **2.4 GHz** Wi-Fi router (ESP32 does not connect to 5 GHz-only networks).
4. Enter your Wi-Fi password, set a 4–9 character WebREPL password below (e.g. `1234`), and click **1-Click Full Wi-Fi + WebREPL Setup**!
   * That single click automatically uploads **`/wifi_config.json`**, **`/wifi_manager.py`** (with optional `ESP32-Setup` AP hotspot fallback so you can change Wi-Fi later at `http://192.168.4.1` without USB!), **`/boot.py`**, and **`/webrepl_cfg.py`**, connects to Wi-Fi, and starts WebREPL right away!
5. Note the IP address shown (e.g. `ws://192.168.1.142:8266`), click **Use in Top Bar**, click **Connect** (your PC and ESP32 must share the same Wi-Fi), and **unplug your USB cable!**

---

## 6. Live System Metrics, Memory & Hardware Quick-Checks

Open the **4. Metrics & Hardware** tab:
* **Run Full Health Checkup:** Runs 7 diagnostics in 1 click (MicroPython runtime, RAM headroom, Flash space, Reset Reason, `/boot.py` & `/main.py`, Wi-Fi + WebREPL readiness, and Live Telemetry Agent).
* **Free Heap RAM & `gc.collect()`:** Watch used vs. free RAM. Click **Free RAM Now (`gc.collect`)** to clear unused temporary objects and avoid `MemoryError`.
* **Two Ways Metrics Work:**
  1. **On-Demand (`Sample Metrics Now`):** Queries RAM, Flash, CPU speed, temp, Wi-Fi, and Reset Reason cleanly when idle (or pauses briefly).
  2. **Continuous Live Streaming Without Pausing Your Code:**
     * **For MicroPython:** Click **Install Live Metrics Agent** (uploads `/esp_console_agent.py`), then add 2 lines to your loop:
       ```python
       import esp_console_agent
       esp_console_agent.emit_metrics()
       ```
     * **For Arduino / C++:** Copy `backend/helpers/ESPConsoleAgent.h` into your sketch folder, `#include "ESPConsoleAgent.h"`, and call `ESPConsoleAgent::loop(2000);` inside `loop()`.
     * The console strips `@METRIC:{...}` lines from the terminal and updates your RAM/CPU/Temp/RSSI gauges automatically!
* **Last Reset Reason:** Explains in plain English why the chip last restarted (e.g., **Brownout Reset** = weak USB cable; **Watchdog Reset** = loop lacked `time.sleep()`).
* **Hardware Quick-Checks:**
  * **Scan I2C Bus:** Instantly finds wired sensors/OLEDs (`0x3C` SSD1306 OLED, `0x76` BME280, `0x27` LCD, `0x68` MPU6050).
  * **Toggle / Read GPIO Pin:** Blink Pin `2` (onboard LED on most DevKits) to test your board in 1 click.

---

## 7. Using Other Languages (C++, Arduino, PlatformIO, ESP-IDF)

Even though MicroPython gives you live files and `>>>`, this console handles compiled languages too in **5. Flash & Other Langs**:

1. **Arduino IDE Users (No CLI Setup Needed):**
   * In Arduino IDE, click **Sketch → Export Compiled Binary**.
   * Upload the generated `.bin` files here! If Arduino outputs 3 files (`bootloader.bin`, `partitions.bin`, `sketch.bin`), click **C++ / IDF 3-Part Preset** (`0x1000`, `0x8000`, `0x10000` — or `0x0` bootloader for S3/C3) and flash!
2. **Local Compiler Bridge (`arduino-cli`, `pio`, `idf.py`):**
   * Paste your project folder path and click **Inspect** / **Compile Project** if those CLI tools are installed on your PC.
3. **Wireless OTA Updates Over Wi-Fi:**
   * If your C++/Arduino sketch uses `HTTPUpdateServer` / `ElegantOTA`, use **HTTP OTA (`/update`)**.
   * If your sketch uses `ArduinoOTA`, pick **ArduinoOTA (`espota`)**, enter the board's IP, port `3232`, and `.bin` file, and push wirelessly!
4. **Crash & Guru Meditation Decoder:**
   * Paste any `Guru Meditation Error` or `rst:0x...` boot crash log (plus optional `.elf` path) to get a plain-English diagnosis.

---

## 8. Troubleshooting Cheatsheet

| What You See | Why It Happened | Quick Fix |
| :--- | :--- | :--- |
| No USB port shows up | Charge-only USB cable or missing USB driver (`CP210x`/`CH340`) | Try a different USB data cable; install CP210x / CH340 driver |
| `Permission denied` on Linux `/dev/ttyUSB0` | User not in `dialout` group | Run `sudo usermod -aG dialout $USER`, then log out & back in |
| `esptool` stuck on `Connecting....` | Board didn't auto-enter ROM bootloader | Hold **BOOT** button -> tap **RST/EN** -> release **BOOT** |
| Flash succeeded, board won't boot | Wrong flash offset for chip (`0x1000` vs `0x0`) | Classic ESP32 uses `0x1000`; ESP32-S2/S3/C3/C6 use `0x0` |
| Terminal prints scrambled text | Wrong baud rate selected | Switch baud rate to **`115200`** (or **`74880`** for old ROM logs) |
| `Ctrl+C` ignored by infinite loop | Loop has zero `time.sleep()` pauses | Click **Force Stop**, or **Safe Recovery** to rename `main.py` |
| `Brownout detector was triggered` | Voltage dropped when Wi-Fi turned on | Swap to a thicker/shorter USB cable or plug directly into PC |
| Wi-Fi won't connect | Router is 5 GHz-only or wrong password | ESP32 needs **2.4 GHz** Wi-Fi |
