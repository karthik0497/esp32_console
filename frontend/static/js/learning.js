/* Universal (i) Info Drawer Database, Active Learning X-Ray Strip, and Guided Missions */

(function () {
  const INFO_CATALOG = {
    learning_mode: {
      title: "Active Learning Mode (Protocol X-Ray)",
      what: "Turns on live 'under-the-hood' explanations showing the exact MicroPython code, serial bytes, and esptool commands sent each time you click any button.",
      why: "Instead of treating the console like magic, you gradually learn how MicroPython Raw REPL, esptool, and UART actually work!",
      how: "Every backend engine emits an X-Ray trace event over WebSocket whenever an action executes.",
      tip: "Leave this ON while learning. You can switch it OFF anytime for a cleaner screen.",
    },
    missions_toggle: {
      title: "Guided First-Time Missions",
      what: "A step-by-step interactive checklist that walks you through connecting, stopping loops, browsing files, freeing RAM, and setting up Wi-Fi.",
      why: "Beginners often ask 'What should I try first?' — missions tick off automatically as you practice real actions.",
      how: "Tracks completed learning actions in your browser's localStorage.",
      tip: "Works safely on the Virtual Demo ESP32 too if no real board is plugged in yet!",
    },
    conn_mode: {
      title: "Connection Mode (USB / WebREPL / Simulator)",
      what: "Chooses how your PC talks to the ESP32: wired USB Serial, wireless Wi-Fi WebREPL, or the built-in Virtual Demo ESP32.",
      why: "USB is needed to flash new firmware and for initial Wi-Fi setup. Once Wi-Fi + WebREPL are enabled, you can switch to WebREPL and unplug the cable!",
      how: "USB uses UART (115200 baud). WebREPL uses WebSocket (ws://ip:8266). Simulator runs a virtual ESP32-S3 right in Python.",
      tip: "Never unplug USB while flashing firmware!",
    },
    port_select: {
      title: "Port / Target Selector",
      what: "Lists detected USB serial ports (like COM3 or /dev/ttyUSB0) plus the Virtual Demo ESP32 Simulator.",
      why: "Your computer might have several USB devices; choosing the right COM/tty port tells the console which cable connects to your ESP32.",
      how: "Scans USB Vendor/Product IDs (CP210x, CH340, CH9102, FTDI, Espressif JTAG).",
      tip: "If no port shows up when plugging in a real board, your USB cable might be charge-only (no data wires)!",
    },
    baud_rate: {
      title: "Baud Rate (Serial Talking Speed)",
      what: "Sets how many bits per second flow over the USB cable.",
      why: "Both your PC and the ESP32 must agree on the same speed, otherwise the terminal shows scrambled symbols.",
      how: "MicroPython defaults to 115200 bps. Some bootloader logs print at 74880 bps.",
      code: "115200 bits/sec (~11,500 characters per second)",
      tip: "Keep 115200 for normal MicroPython work; faster speeds like 460800 are used mainly during esptool flashing.",
    },
    connect_btn: {
      title: "Safe Connect / Disconnect",
      what: "Opens or closes the communication channel to your ESP32.",
      why: "Unlike many serial apps, Safe Connect keeps DTR and RTS hardware lines OFF when opening so your running code isn't accidentally rebooted.",
      how: "Opens serial with dtr=False, rts=False, or opens WebSocket ws://<ip>:8266 with WebREPL password handshake.",
      code: "serial.Serial(port, 115200, dtr=False, rts=False)",
      tip: "Only one program can hold a USB serial port at a time—close Arduino IDE / Thonny Serial Monitor first!",
    },
    status_pill: {
      title: "Live Device Status Indicator",
      what: "Answers 'Is my device running or not?' at a glance.",
      why: "Without a monitor on the ESP32, this tells you if the chip is currently executing main.py, sitting idle at >>>, in Bootloader mode, or crashed.",
      how: "Watches UART output for >>> prompts, main.py print logs, @METRIC frames, bootloader banners, and panic errors.",
      tip: "If status stays 'Running main.py', click Stop (Ctrl+C) before trying to type interactive Python commands.",
    },
    stop_ctrl_c: {
      title: "Stop Code (Ctrl+C)",
      what: "Pauses whatever script (like main.py) is currently running and drops you to the interactive >>> prompt.",
      why: "You cannot run File Explorer scans or test commands while main.py is stuck inside an infinite loop.",
      how: "Sends ASCII control byte 0x03 (KeyboardInterrupt) over USB or WebREPL.",
      code: "b'\\x03\\x03'  # Raises KeyboardInterrupt inside MicroPython",
      tip: "If main.py uses tight loops with zero sleep(), try Force Stop instead!",
    },
    force_stop: {
      title: "Force Stop (Ctrl+C Burst)",
      what: "Sends a rapid burst of five Ctrl+C interrupts to break out of busy loops.",
      why: "Tight loops without time.sleep() sometimes miss a single Ctrl+C byte.",
      how: "Transmits b'\\x03\\x03\\x03\\x03\\x03' directly to the interpreter.",
      tip: "If the chip is completely frozen or in machine.deepsleep(), use Safe Recovery!",
    },
    soft_reset: {
      title: "Soft Reboot (Ctrl+D)",
      what: "Restarts MicroPython cleanly from boot.py -> main.py without cutting USB power.",
      why: "Great for testing how your board behaves from a fresh boot after uploading updated files.",
      how: "Exits Raw REPL if needed and sends byte 0x04 (Ctrl+D) at the friendly REPL prompt.",
      code: "b'\\x04'  # MPY: soft reboot",
      tip: "RAM is cleared on soft reboot, while Flash files stay safe!",
    },
    hard_reset: {
      title: "Hard Reset (RST / EN Pin)",
      what: "Physically resets the ESP32 silicon chip — identical to pressing the RST/EN button on the board.",
      why: "Clears stuck Wi-Fi/hardware peripherals when a soft reboot isn't enough.",
      how: "Pulses the USB-UART RTS signal LOW for 120ms to pull the chip's EN pin.",
      tip: "Only available over USB Serial (WebREPL cannot toggle hardware pins wirelessly).",
    },
    safe_recovery: {
      title: "Safe Recovery Mode (Unbrick Runaway Loop)",
      what: "Rescues an ESP32 trapped by a broken main.py (e.g., tight infinite loop or instant crash/reboot loop).",
      why: "Saves you from having to wipe the entire flash memory and re-flash MicroPython from scratch!",
      how: "Resets the board, floods Ctrl+C during the boot window before main.py grabs the CPU, and optionally renames /main.py -> /main.py.bak.",
      tip: "Choose 'Disable main.py' if your board keeps freezing every time it turns on.",
    },
    terminal_box: {
      title: "Live Serial & REPL Terminal",
      what: "Your walkie-talkie screen with the ESP32. Shows print() output from main.py, boot messages, and lets you type live Python commands.",
      why: "Since ESP32 has no screen, print() messages sent over UART or WebREPL are your #1 window into what your code is doing.",
      how: "Uses a real-time WebSocket stream connected to the active transport, filtering out noisy @METRIC telemetry lines automatically.",
      tip: "Use Up/Down arrow keys in the command box to repeat previous commands!",
    },
    quick_macros: {
      title: "Quick Learning Macros",
      what: "One-click MicroPython commands for beginners so you don't have to memorize syntax right away.",
      why: "Lets you instantly check MicroPython version, list files, check free RAM, or scan Wi-Fi right in the terminal.",
      how: "Writes standard MicroPython one-liners directly into the active REPL.",
      tip: "Watch the terminal output after clicking a macro to learn the exact Python syntax!",
    },
    file_explorer: {
      title: "ESP32 Flash File Directory",
      what: "Displays all folders and files stored permanently inside your ESP32's Flash memory (/, /lib, boot.py, main.py).",
      why: "Helps you verify whether your updated code actually uploaded, check file sizes, and organize libraries in /lib.",
      how: "Enters MicroPython Raw REPL (Ctrl+A) and runs os.ilistdir() recursively, returning JSON.",
      code: "os.ilistdir('/')  # lists (name, type, inode, size)",
      tip: "Never delete boot.py unless you know what's inside—though MicroPython still boots to >>> without one.",
    },
    file_upload: {
      title: "Upload Files (USB or WebREPL)",
      what: "Copies .py, .json, .mpy, or data files from your computer straight into the ESP32 flash directory.",
      why: "Works identically whether you are connected by USB cable OR wirelessly over Wi-Fi WebREPL!",
      how: "Encodes file bytes in Base64 chunks and writes them safely through Raw REPL using open(..., 'wb').",
      tip: "Upload helper libraries into /lib so your root / folder stays neat.",
    },
    file_run: {
      title: "Run Selected File Now",
      what: "Executes the selected Python file immediately without overwriting /main.py.",
      why: "Great for testing a new script safely before deciding to make it auto-run on boot.",
      how: "Sends exec(open('/path.py').read()) in Friendly REPL so print() output streams live.",
      code: "exec(open('/test_led.py').read())",
      tip: "Click Stop (Ctrl+C) anytime to halt the running script.",
    },
    file_make_main: {
      title: "Set Selected File as /main.py",
      what: "Copies the selected file into /main.py.",
      why: "MicroPython automatically looks for /main.py and runs it every time the ESP32 gets power (even from a battery or wall charger).",
      how: "Streams bytes from your chosen script into /main.py inside ESP32 flash.",
      tip: "Download a Backup .zip first if you already had an important main.py!",
    },
    file_backup: {
      title: "Download Full Flash Backup (.zip)",
      what: "Downloads every file from your ESP32 into a single .zip file on your computer.",
      why: "Protects your working code before you experiment, erase flash, or change main.py.",
      how: "Reads each file via Raw REPL and bundles them in-memory into a compressed zip.",
      tip: "Make a habit of taking a backup whenever a project is working nicely!",
    },
    wifi_scan: {
      title: "Scan Nearby Wi-Fi Networks",
      what: "Turns on the ESP32's Wi-Fi radio and scans for visible routers nearby, showing signal strength (RSSI) and security type.",
      why: "Confirms your ESP32's antenna works and shows whether your router's 2.4 GHz network is reachable.",
      how: "Calls network.WLAN(network.STA_IF).scan().",
      code: "sta = network.WLAN(network.STA_IF); sta.active(True); sta.scan()",
      tip: "ESP32 chips only see 2.4 GHz Wi-Fi (not 5 GHz-only networks). Stronger signal = closer to 0 (e.g. -50 dBm is great; -85 dBm is weak).",
    },
    wifi_connect: {
      title: "Connect & Save Wi-Fi Credentials",
      what: "Connects the ESP32 to your chosen Wi-Fi router and saves the SSID & password cleanly in /wifi_config.json.",
      why: "Storing Wi-Fi settings in wifi_config.json keeps passwords out of your main.py code so you can share code safely and change Wi-Fi easily.",
      how: "Writes /wifi_config.json and runs sta.connect(ssid, password).",
      tip: "Turn on 'AP Hotspot Fallback' below so you can change Wi-Fi later even without a USB cable!",
    },
    wifi_ap_fallback: {
      title: "AP Hotspot Fallback (Change Wi-Fi Without USB Later!)",
      what: "Installs wifi_manager.py and updates boot.py so if saved Wi-Fi fails, the ESP32 creates its own 'ESP32-Setup' Wi-Fi hotspot with a setup web page.",
      why: "Normally you need USB the first time to set Wi-Fi. With AP Fallback, if you move the ESP32 to a new place later, you can connect from your phone to http://192.168.4.1 and update Wi-Fi wirelessly!",
      how: "Runs network.WLAN(AP_IF) on port 80 if STA connection times out after 12 seconds.",
      tip: "Awesome for robots, weather stations, or school projects you carry between locations!",
    },
    webrepl_setup: {
      title: "Enable Wireless WebREPL",
      what: "Configures a 4–9 character password in webrepl_cfg.py, enables WebREPL in boot.py, and starts the wireless WebSocket server on port 8266.",
      why: "Once enabled, you can unplug USB and still upload Python files, edit code, stop loops, and watch logs over Wi-Fi!",
      how: "Writes PASS = '...' to /webrepl_cfg.py and runs import webrepl; webrepl.start().",
      code: "ws://<ESP32-IP>:8266",
      tip: "Your computer and ESP32 must be on the same Wi-Fi network to use WebREPL.",
    },
    ram_gauge: {
      title: "Heap RAM Memory Usage",
      what: "Shows how much fast working memory (RAM) is used vs. free right now.",
      why: "ESP32 has limited RAM (~320 KB on classic ESP32). If RAM hits 0, your program crashes with MemoryError!",
      how: "Calls gc.mem_free() and gc.mem_alloc() in MicroPython (or ESP.getFreeHeap() in C++).",
      code: "import gc; print(gc.mem_free(), gc.mem_alloc())",
      tip: "Use Live Agent helper if you want this gauge to update continuously while main.py is running!",
    },
    gc_collect: {
      title: "Free RAM (Run Garbage Collector)",
      what: "Triggers MicroPython's garbage collector to sweep away leftover unused temporary objects from RAM.",
      why: "Frees trapped memory and reduces heap fragmentation so larger buffers or SSL/Wi-Fi requests succeed.",
      how: "Executes gc.collect() and compares gc.mem_free() before and after.",
      code: "import gc; gc.collect()",
      tip: "In long-running projects, calling gc.collect() once per minute in your loop keeps RAM healthy!",
    },
    flash_gauge: {
      title: "Flash Filesystem Storage",
      what: "Shows used vs. free permanent Flash space available for your Python files and data logs.",
      why: "Prevents 'OSError: ENOSPC' (disk full) when saving sensor logs or uploading new modules.",
      how: "Reads block counts from os.statvfs('/').",
      code: "st = os.statvfs('/'); free_bytes = st[0] * st[3]",
      tip: "Remember: Flash keeps files after power off; RAM does not.",
    },
    cpu_freq: {
      title: "CPU Clock Speed (80 / 160 / 240 MHz)",
      what: "Shows and lets you adjust how fast the ESP32 processor runs.",
      why: "80 MHz saves battery and keeps the chip cooler; 240 MHz gives maximum speed for displays, audio, or fast math.",
      how: "Calls machine.freq(mhz * 1000000).",
      code: "import machine; machine.freq(240000000)",
      tip: "Wi-Fi typically needs at least 80–160 MHz to work smoothly.",
    },
    reset_cause: {
      title: "Last Reset Reason Decoder",
      what: "Explains in plain English WHY the ESP32 restarted last time.",
      why: "If your board randomly reboots while unattended, this reveals whether it was a Power Brownout, a Watchdog Freeze, or a normal Power-On.",
      how: "Reads hardware reset register via machine.reset_cause().",
      code: "import machine; machine.reset_cause()",
      tip: "Seeing BROWNOUT_RESET almost always means a weak USB cable or power supply!",
    },
    live_agent: {
      title: "1-Click Live Telemetry Agent (Monitor While Running)",
      what: "Installs esp_console_agent.py onto your ESP32 (or gives you ESPConsoleAgent.h for C++).",
      why: "Normally, checking RAM over REPL would interrupt main.py! With this tiny helper, your running code emits lightweight @METRIC JSON lines so live charts update WITHOUT pausing your script.",
      how: "Prints @METRIC:{...} frames that the console automatically strips from the terminal and renders in gauges.",
      code: "import esp_console_agent; esp_console_agent.emit_metrics()",
      tip: "Works for both MicroPython (esp_console_agent.py) and Arduino C++ (ESPConsoleAgent.h)!",
    },
    i2c_scan: {
      title: "I2C Bus Hardware Scanner",
      what: "Scans SDA/SCL pins to list every connected sensor or OLED display and identifies common chips (like 0x3C OLED or 0x76 BME280).",
      why: "Solves the classic 'Is my sensor dead or did I swap SDA and SCL?' question in 2 seconds without writing test code.",
      how: "Runs machine.SoftI2C(scl=Pin(scl), sda=Pin(sda)).scan().",
      code: "SoftI2C(scl=Pin(22), sda=Pin(21)).scan()",
      tip: "Classic ESP32 defaults are SCL=22, SDA=21. Check your board pinout if using ESP32-S3 or C3!",
    },
    gpio_probe: {
      title: "Quick GPIO Pin Tester",
      what: "Turns any digital pin HIGH (3.3V), LOW (0V), toggles it, or reads whether a button is pressed.",
      why: "Fastest way to blink the onboard LED (usually GPIO 2) and confirm your board is alive and responding.",
      how: "Configures machine.Pin(n, Pin.OUT) or Pin.IN.",
      code: "Pin(2, Pin.OUT).value(1)",
      tip: "Most classic ESP32 DevKits have their blue LED on Pin 2. Some ESP32-S3/C3 boards use Pin 8 or NeoPixel RGB LEDs.",
    },
    flash_probe: {
      title: "Probe Chip & Flash ID (esptool)",
      what: "Talks directly to the ESP32 ROM bootloader to detect exact chip model, MAC address, crystal speed, and flash chip size (4MB/8MB/16MB).",
      why: "Helps you download the EXACT right MicroPython .bin firmware for your specific board!",
      how: "Runs `python -m esptool --port <port> flash_id`.",
      tip: "Hold down the BOOT button if it stays on 'Connecting.......'.",
    },
    flash_erase: {
      title: "Erase Entire Flash Memory",
      what: "Wipes the ESP32 SPI flash clean, deleting old firmware, broken filesystems, and old Wi-Fi settings.",
      why: "Essential when switching from C++/Arduino to MicroPython (or vice versa) so mismatched partition tables don't cause bootloops.",
      how: "Runs `python -m esptool --port <port> erase_flash`.",
      tip: "Back up any important MicroPython files first—this wipes everything!",
    },
    flash_write: {
      title: "Flash Firmware .bin (MicroPython or Other Languages)",
      what: "Writes compiled binary firmware (.bin) into the ESP32 flash memory at exact memory offsets.",
      why: "This is how you install MicroPython onto a fresh chip OR upload firmware built in C++, Arduino, ESP-IDF, Rust, ESPHome, or Tasmota.",
      how: "Runs `esptool write_flash` and verifies data hashes automatically.",
      code: "MicroPython ESP32: 0x1000 | ESP32-S3/C3: 0x0 | C++ App: 0x10000",
      tip: "Never unplug USB while the progress bar is writing!",
    },
    toolchain_build: {
      title: "Other Languages Local Project Compiler",
      what: "Inspects an Arduino (.ino), PlatformIO (platformio.ini), or ESP-IDF (CMakeLists.txt) folder and compiles it if local CLI tools are installed.",
      why: "Lets you stay in one console even when updating C++ or Arduino projects.",
      how: "Detects arduino-cli, pio, or idf.py on your computer and locates the generated .bin files.",
      tip: "Even if no compiler CLI is installed, you can export .bin files from Arduino IDE and flash them directly above!",
    },
    ota_upload: {
      title: "Wireless OTA Firmware Update (C++ / Arduino / ESP-IDF)",
      what: "Pushes a compiled .bin firmware file directly over Wi-Fi without needing a USB cable.",
      why: "When your ESP32 is mounted inside a box, ceiling, or robot running C++/Arduino OTA firmware, you can update it wirelessly.",
      how: "Supports HTTP Multipart POST (/update) and ArduinoOTA (UDP invite + TCP binary stream).",
      tip: "MicroPython updates individual .py files via WebREPL; compiled C++ updates full .bin images via OTA.",
    },
    crash_decoder: {
      title: "Crash & Guru Meditation Decoder",
      what: "Translates scary hex crash logs ('Guru Meditation Error', 'rst:0x...', 'Brownout') into plain-English explanations.",
      why: "Helps you immediately understand whether a crash came from a bad memory pointer, watchdog freeze, or weak power cable.",
      how: "Matches ESP-IDF panic causes and optionally runs addr2line if you supply your build's .elf file.",
      tip: "Copy the whole crash block from Serial Monitor and paste it here!",
    },
    guide_page: {
      title: "Kid-Friendly Detailed Markdown Guide",
      what: "Opens the separate /guide handbook page written in plain everyday analogies that even a child can read and follow.",
      why: "Great as a step-by-step reference or printable Markdown manual (docs/GUIDE.md) alongside the console.",
      how: "Fetches docs/GUIDE.md and renders it cleanly in HTML with a table of contents and download option.",
      tip: "Keep the Guide open in a second browser tab while practicing!",
    },
    theme_toggle: {
      title: "Light / Dark Theme Switch",
      what: "Switches between Dark Mode (easy on the eyes at night) and Light Mode (bright & clear in classrooms or sunlight).",
      why: "Comfortable visibility in any workshop or classroom setting.",
      how: "Toggles a CSS class on the page body with zero page reload.",
      tip: "The Guide page (/guide) also has its own Dark / Light button!",
    },
    refresh_ports: {
      title: "Refresh USB Serial Ports",
      what: "Re-scans your computer's USB ports so a freshly plugged-in ESP32 shows up immediately.",
      why: "If you plugged in your ESP32 after opening the web page, Refresh detects the new COM or /dev/ttyUSB port.",
      how: "Queries pyserial's list_ports.comports() and identifies ESP32 USB bridge chips.",
      tip: "No new port after Refresh? Swap to a proper USB data cable!",
    },
    terminal_controls: {
      title: "Terminal View Controls (Pause / Copy / Clear)",
      what: "Lets you freeze scrolling to read fast logs, copy output to clipboard, or wipe the terminal window.",
      why: "When main.py prints messages every second, Pause Scroll stops the screen from jumping while you read.",
      how: "Pure browser UI control — does not pause or disturb the ESP32 itself.",
      tip: "Use Copy when pasting crash logs into the Crash Decoder!",
    },
    repl_input: {
      title: "Interactive Python Command Box (REPL)",
      what: "Sends any Python line straight to the ESP32 and prints the answer immediately.",
      why: "Lets you test pins, math, sensors, or imports interactively without editing or uploading files.",
      how: "Sends your text followed by \\r\\n over the live WebSocket to UART or WebREPL.",
      code: "print(2 + 2)   # Press Up/Down arrows for command history!",
      tip: "Make sure status is Idle at REPL (>>>) — click Stop (Ctrl+C) if main.py is busy.",
    },
    code_templates: {
      title: "Beginner Starter Code Templates",
      what: "Loads ready-to-run MicroPython example scripts into the editor so you can learn by reading, tweaking, and running real code.",
      why: "Perfect when you're starting fresh and aren't sure what to put in main.py yet!",
      how: "Fills the editor with commented example code (LED blink, live sensor/RAM metrics, mini web server, or runaway-loop practice).",
      tip: "Try 'Runaway Loop Practice' on the Simulator, then practice rescuing it with Stop / Safe Recovery!",
    },
    file_editor_ops: {
      title: "Create, Save & Delete Files",
      what: "Create new Python files or folders (/lib), save edits directly into ESP32 flash, or delete old files.",
      why: "Lets you fix typos in main.py or wifi_config.json in 2 seconds without leaving the browser.",
      how: "Uses Raw REPL to write UTF-8 bytes or call os.mkdir() / os.remove() on ESP32 flash.",
      tip: "Save edits first before clicking Run File or Soft Reboot!",
    },
    wifi_status_btn: {
      title: "Check Live Wi-Fi & Saved Config",
      what: "Checks whether the ESP32 is connected to a router, what IP address it received, and what SSID is saved in wifi_config.json.",
      why: "Confirms your IP address before switching to wireless WebREPL or opening an ESP32 web server.",
      how: "Queries WLAN(STA_IF).ifconfig(), WLAN(AP_IF).ifconfig(), and /wifi_config.json.",
      tip: "Write down the IP address (like 192.168.1.142) to connect wirelessly!",
    },
    wifi_manual_ap: {
      title: "Manual Wi-Fi Hotspot (AP Mode)",
      what: "Makes the ESP32 broadcast its own Wi-Fi network (default IP 192.168.4.1) so phones or laptops can connect directly to it.",
      why: "Handy outdoors or in classrooms where there is no Wi-Fi router available.",
      how: "Activates network.WLAN(network.AP_IF) with your chosen SSID and password.",
      tip: "AP password must be at least 8 characters long!",
    },
    sample_metrics: {
      title: "Sample Live System Metrics",
      what: "Queries RAM, Flash storage, CPU MHz, MCU temperature, Wi-Fi IP/RSSI, and Last Reset Reason right now.",
      why: "Gives you an instant health checkup of your ESP32 without needing any helper script.",
      how: "Runs a compact inspection script via Raw REPL (pauses running code briefly while sampling).",
      tip: "To watch metrics stream continuously WITHOUT pausing main.py, click 'Install Live Metrics Agent'!",
    },
    mcu_temp: {
      title: "ESP32 Chip Internal Temperature",
      what: "Shows the internal silicon temperature of the ESP32 processor in °C.",
      why: "Helps spot overheating when running heavy Wi-Fi + high CPU speed inside closed plastic boxes.",
      how: "Reads esp32.mcu_temperature() on ESP32-S2/S3/C3/C6 (or esp32.raw_temperature() on classic ESP32).",
      tip: "Normal operating silicon temp is roughly 35°C–65°C depending on room temp and Wi-Fi load.",
    },
    wifi_link_metric: {
      title: "Wi-Fi IP & Signal Strength (RSSI)",
      what: "Shows the board's current IP address and signal quality in dBm.",
      why: "Weak Wi-Fi (-85 dBm or lower) causes dropped WebREPL frames and higher battery drain.",
      how: "Reads wlan.ifconfig()[0] and wlan.status('rssi').",
      tip: "-40 to -65 dBm is strong; -80 dBm+ means move closer to your router.",
    },
    multi_offset: {
      title: "Multi-Offset .bin Parts (C++ / Arduino / ESP-IDF)",
      what: "Lets you flash multiple .bin files into separate flash addresses at the same time (bootloader at 0x1000/0x0, partitions at 0x8000, app at 0x10000).",
      why: "MicroPython uses 1 single .bin file, whereas compiled Arduino/ESP-IDF projects often output 3 separate .bin files!",
      how: "Passes each (offset, file) pair sequentially to `esptool write_flash`.",
      tip: "Click 'C++ / IDF 3-Part Preset' to auto-fill the standard 0x1000, 0x8000, 0x10000 boxes!",
    },
    health_checkup: {
      title: "1-Click Full Board Health Checkup",
      what: "Runs 7 automatic checks at once: MicroPython runtime, Heap RAM headroom, Flash space, Last Reset Reason, Startup files (/boot.py & /main.py), Wi-Fi + WebREPL readiness, and Live Telemetry Agent.",
      why: "Gives you one clear Pass / Warning scorecard instead of hunting through separate commands when troubleshooting a board.",
      how: "Queries gc, os.statvfs, os.stat, machine.reset_cause, and WLAN(STA_IF) in a single Raw REPL check.",
      tip: "Run this anytime after flashing or setting up Wi-Fi to confirm everything is ready!",
    },
    initial_wireless_setup: {
      title: "1-Click Initial Wireless Setup (USB -> Wi-Fi + WebREPL)",
      what: "Performs the entire first-time wireless setup in one step: uploads /wifi_config.json, /wifi_manager.py, /boot.py, and /webrepl_cfg.py, connects to Wi-Fi, and starts WebREPL with your password.",
      why: "On a brand-new ESP32, you do this ONCE over USB—afterward you can unplug USB and upload files or manage code wirelessly via WebREPL!",
      how: "Writes credentials + WebREPL config via Raw REPL, connects WLAN(STA_IF), and runs webrepl.start(password=...).",
      code: "Files uploaded: /wifi_config.json, /wifi_manager.py, /boot.py, /webrepl_cfg.py",
      tip: "Remember: WebREPL password must be 4–9 characters, and your ESP32 needs 2.4 GHz Wi-Fi!",
    },
  };

  const MISSIONS = [
    { id: "connect", label: "1. Connect Board (or Simulator)", tab: "tab-terminal" },
    { id: "stop", label: "2. Stop main.py (Ctrl+C)", tab: "tab-terminal" },
    { id: "files", label: "3. Browse/Edit Files", tab: "tab-files" },
    { id: "metrics", label: "4. Check RAM & gc.collect()", tab: "tab-metrics" },
    { id: "wifi", label: "5. Scan Wi-Fi / Setup WebREPL", tab: "tab-wifi" },
    { id: "flash", label: "6. Probe Chip / Try Flasher", tab: "tab-flash" },
  ];

  const STORAGE_KEY = "esp32_console_missions_v1";
  let completed = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  let learningEnabled = true;

  function openInfo(key) {
    const item = INFO_CATALOG[key];
    if (!item) return;
    document.getElementById("drawerTitle").textContent = item.title;
    document.getElementById("drawerWhat").textContent = item.what;
    document.getElementById("drawerWhy").textContent = item.why;
    document.getElementById("drawerHow").textContent = item.how;
    document.getElementById("drawerTip").textContent = item.tip;
    const codeWrap = document.getElementById("drawerCodeWrap");
    if (item.code) {
      codeWrap.style.display = "block";
      document.getElementById("drawerCode").textContent = item.code;
    } else {
      codeWrap.style.display = "none";
    }
    document.getElementById("infoDrawer").classList.add("open");
    document.getElementById("drawerBackdrop").classList.add("open");
  }

  function closeInfo() {
    document.getElementById("infoDrawer").classList.remove("open");
    document.getElementById("drawerBackdrop").classList.remove("open");
  }

  function renderMissions() {
    const container = document.getElementById("missionsList");
    if (!container) return;
    container.innerHTML = MISSIONS.map((m) => {
      const done = completed.has(m.id);
      return `<button type="button" class="mission-chip ${done ? "done" : ""}" data-mission="${m.id}" data-tab="${m.tab}">
        <span class="check">${done ? "✓" : "○"}</span>
        <span>${m.label}</span>
      </button>`;
    }).join("");

    const doneCount = MISSIONS.filter((m) => completed.has(m.id)).length;
    const prog = document.getElementById("missionsProgress");
    if (prog) prog.textContent = `${doneCount} / ${MISSIONS.length} Completed`;

    container.querySelectorAll(".mission-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.App && window.App.switchTab) {
          window.App.switchTab(btn.dataset.tab);
        }
      });
    });
  }

  function completeMission(id) {
    if (!completed.has(id)) {
      completed.add(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
      renderMissions();
    }
  }

  function resetMissions() {
    completed = new Set();
    localStorage.setItem(STORAGE_KEY, "[]");
    renderMissions();
  }

  function pushXray(trace) {
    if (!learningEnabled) return;
    const strip = document.getElementById("xrayStrip");
    if (!strip) return;
    document.getElementById("xrayAction").textContent = `${trace.action} (${trace.protocol || "Protocol"})`;
    document.getElementById("xrayCode").textContent = trace.code || "";
    document.getElementById("xrayExplain").textContent = trace.explanation || "";
  }

  function init() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".info-btn");
      if (btn && btn.dataset.info) {
        e.preventDefault();
        e.stopPropagation();
        openInfo(btn.dataset.info);
      }
    });

    document.getElementById("closeDrawerBtn").addEventListener("click", closeInfo);
    document.getElementById("drawerBackdrop").addEventListener("click", closeInfo);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeInfo();
    });

    const toggleLearningBtn = document.getElementById("toggleLearningBtn");
    toggleLearningBtn.addEventListener("click", () => {
      learningEnabled = !learningEnabled;
      document.getElementById("xrayStrip").classList.toggle("hidden", !learningEnabled);
      toggleLearningBtn.textContent = learningEnabled ? "Active Learning: ON" : "Active Learning: OFF";
      toggleLearningBtn.classList.toggle("btn-primary", learningEnabled);
    });

    const toggleMissionsBtn = document.getElementById("toggleMissionsBtn");
    toggleMissionsBtn.addEventListener("click", () => {
      const bar = document.getElementById("missionsBar");
      bar.classList.toggle("hidden");
    });

    document.getElementById("resetMissionsBtn").addEventListener("click", resetMissions);
    renderMissions();
  }

  window.Learning = {
    init,
    openInfo,
    closeInfo,
    completeMission,
    pushXray,
    get enabled() {
      return learningEnabled;
    },
  };
})();

