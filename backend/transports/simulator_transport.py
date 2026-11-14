"""
Built-in Virtual ESP32-S3 MicroPython Simulator Transport.
Emulates Friendly REPL, Raw REPL (Ctrl+A / Ctrl+B / Ctrl+C / Ctrl+D),
virtual flash filesystem, Wi-Fi STA/AP, gc RAM, I2C, GPIO, and running main.py
so anyone can actively learn and test every console feature without hardware.
"""

import asyncio
import contextlib
import io
import json
import os as host_os
import posixpath
import random
import time
from typing import Callable, Optional

from .base import DeviceTransport


class _SimVFS:
    """In-memory LittleFS-like virtual filesystem for the demo ESP32."""

    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.dirs: set[str] = {"/", "/lib"}
        self.reset_defaults()

    def reset_defaults(self):
        self.dirs = {"/", "/lib"}
        self.files = {
            "/boot.py": (
                "# boot.py -- runs once on startup before main.py\n"
                "import gc\n"
                "gc.collect()\n"
                "print('[boot.py] ESP32-S3 starting up...')\n"
            ).encode(),
            "/main.py": (
                "# main.py -- main project loop\n"
                "import time\n"
                "import gc\n"
                "import json\n"
                "import machine\n"
                "\n"
                "led = machine.Pin(2, machine.Pin.OUT)\n"
                "step = 0\n"
                "while True:\n"
                "    step += 1\n"
                "    led.value(step % 2)\n"
                "    temp = 24.5 + (step % 5) * 0.3\n"
                "    print(f'[main.py] Step {step}: LED={\"ON\" if step % 2 else \"OFF\"} | Room Temp={temp:.1f}C')\n"
                "    print('@METRIC:' + json.dumps({'ram_free': gc.mem_free(), 'ram_alloc': gc.mem_alloc(), 'flash_free': 6291456, 'flash_total': 8388608, 'cpu_mhz': machine.freq()//1000000, 'temp_c': 39.2 + (step % 3)*0.4, 'uptime_ms': step*1500, 'ip': '192.168.1.142', 'rssi': -56}))\n"
                "    time.sleep(1.5)\n"
            ).encode(),
            "/lib/sensors.py": (
                "# Demo library module inside /lib\n"
                "def read_bme280():\n"
                "    return {'temp_c': 25.1, 'humidity': 54.2, 'pressure_hpa': 1013.2}\n"
            ).encode(),
            "/wifi_config.json": json.dumps(
                {"ssid": "Lab-WiFi-2.4G", "password": "demo-password"}, indent=2
            ).encode(),
        }

    def norm(self, path: str) -> str:
        p = posixpath.normpath("/" + path.lstrip("/"))
        return p

    def listdir(self, path: str = "/") -> list[str]:
        p = self.norm(path)
        if p not in self.dirs:
            raise OSError(2, "ENOENT")
        prefix = "/" if p == "/" else p + "/"
        entries = set()
        for d in self.dirs:
            if d != p and d.startswith(prefix):
                rest = d[len(prefix):]
                entries.add(rest.split("/", 1)[0])
        for f in self.files:
            if f.startswith(prefix):
                rest = f[len(prefix):]
                entries.add(rest.split("/", 1)[0])
        return sorted(entries)

    def ilistdir(self, path: str = "/") -> list[tuple]:
        p = self.norm(path)
        res = []
        for name in self.listdir(p):
            full = "/" + name if p == "/" else p + "/" + name
            if full in self.dirs:
                res.append((name, 0x4000, 0, 0))
            else:
                res.append((name, 0x8000, 0, len(self.files.get(full, b""))))
        return res

    def stat(self, path: str):
        p = self.norm(path)
        if p in self.dirs:
            return (0x4000, 0, 0, 0, 0, 0, 0, 0, 0, 0)
        if p in self.files:
            return (0x8000, 0, 0, 0, 0, 0, len(self.files[p]), 0, 0, 0)
        raise OSError(2, "ENOENT")

    def mkdir(self, path: str):
        p = self.norm(path)
        if p in self.dirs or p in self.files:
            raise OSError(17, "EEXIST")
        self.dirs.add(p)

    def remove(self, path: str):
        p = self.norm(path)
        if p in self.files:
            del self.files[p]
            return
        raise OSError(2, "ENOENT")

    def rmdir(self, path: str):
        p = self.norm(path)
        if p in self.dirs and p != "/":
            if self.listdir(p):
                raise OSError(39, "ENOTEMPTY")
            self.dirs.remove(p)
            return
        raise OSError(2, "ENOENT")

    def rename(self, old: str, new: str):
        o = self.norm(old)
        n = self.norm(new)
        if o in self.files:
            self.files[n] = self.files.pop(o)
            return
        if o in self.dirs and o != "/":
            self.dirs.remove(o)
            self.dirs.add(n)
            return
        raise OSError(2, "ENOENT")

    def statvfs(self):
        used = sum(len(v) for v in self.files.values())
        block_size = 4096
        total_blocks = 2048  # 8MB flash partition demo
        used_blocks = max(16, (used // block_size) + 12)
        free_blocks = total_blocks - used_blocks
        return (block_size, block_size, total_blocks, free_blocks, free_blocks, 0, 0, 0, 0, 255)


class _SimFile:
    def __init__(self, vfs: _SimVFS, path: str, mode: str):
        self._vfs = vfs
        self._path = vfs.norm(path)
        self._mode = mode
        self._binary = "b" in mode
        if "r" in mode:
            if self._path not in vfs.files:
                raise OSError(2, "ENOENT")
            raw = vfs.files[self._path]
            self._buf = io.BytesIO(raw) if self._binary else io.StringIO(raw.decode("utf-8", "replace"))
        elif "w" in mode:
            self._buf = io.BytesIO() if self._binary else io.StringIO()
        elif "a" in mode:
            existing = vfs.files.get(self._path, b"")
            if self._binary:
                self._buf = io.BytesIO(existing)
                self._buf.seek(0, 2)
            else:
                self._buf = io.StringIO(existing.decode("utf-8", "replace"))
                self._buf.seek(0, 2)
        else:
            raise ValueError("Unsupported mode")

    def read(self, n=-1):
        return self._buf.read(n)

    def write(self, data):
        return self._buf.write(data)

    def close(self):
        if "w" in self._mode or "a" in self._mode:
            val = self._buf.getvalue()
            self._vfs.files[self._path] = val if isinstance(val, bytes) else val.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class SimulatorTransport(DeviceTransport):
    """Simulates a live MicroPython ESP32-S3 device over a virtual serial stream."""

    transport_type = "simulator"

    def __init__(self, on_bytes: Optional[Callable[[bytes], None]] = None, on_disconnect: Optional[Callable[[str], None]] = None):
        super().__init__(on_bytes=on_bytes, on_disconnect=on_disconnect)
        self.vfs = _SimVFS()
        self.mode = "RUNNING_MAIN"  # RUNNING_MAIN | FRIENDLY_REPL | RAW_REPL
        self.raw_buf = bytearray()
        self.line_buf = bytearray()
        self.cpu_freq = 240_000_000
        self.mem_total = 327_680
        self.mem_extra_garbage = 28_400
        self.reset_cause_code = 1  # PWRON_RESET
        self.wifi_connected = True
        self.wifi_ssid = "Lab-WiFi-2.4G"
        self.wifi_ip = "192.168.1.142"
        self.wifi_rssi = -56
        self.ap_active = False
        self.ap_ssid = "ESP32-Setup"
        self.pins: dict[int, int] = {2: 0}
        self._main_task: Optional[asyncio.Task] = None
        self._sim_globals: dict = {}
        self._start_time = time.monotonic()
        self._last_cr = False

    @property
    def capabilities(self) -> dict:
        return {
            "repl": True,
            "files": True,
            "hard_reset": True,
            "bootloader": True,
            "flash": True,
            "wireless": False,
            "simulated": True,
        }

    def _emit(self, text: str) -> None:
        if self.on_bytes:
            self.on_bytes(text.encode("utf-8", "replace"))

    async def connect(self) -> dict:
        self._connected = True
        self._build_sim_modules()
        # Boot straight into simulated running main.py just like a real plugged-in ESP32
        self._emit("\r\nESP-ROM:esp32s3-20210327\r\n")
        self._emit("rst:0x1 (POWERON),boot:0x8 (SPI_FAST_FLASH_BOOT)\r\n")
        self._emit("[boot.py] ESP32-S3 starting up...\r\n")
        self._start_main_loop()
        return {
            "transport": "simulator",
            "target": "Virtual Demo ESP32-S3",
            "capabilities": self.capabilities,
        }

    async def disconnect(self) -> None:
        self._connected = False
        self._stop_main_loop()

    def _stop_main_loop(self) -> None:
        if self._main_task and not self._main_task.done():
            self._main_task.cancel()
            self._main_task = None

    def _start_main_loop(self) -> None:
        self._stop_main_loop()
        if "/main.py" not in self.vfs.files:
            self.mode = "FRIENDLY_REPL"
            self._emit("MicroPython v1.23.0 on 2024-06-02; Generic ESP32S3 module (SIMULATOR) with ESP32S3\r\n")
            self._emit('Type "help()" for more information.\r\n>>> ')
            return

        self.mode = "RUNNING_MAIN"
        main_src = self.vfs.files["/main.py"].decode("utf-8", "replace")
        self._launch_loop_script(main_src, label="main.py")

    def _launch_loop_script(self, src: str, label: str = "script.py") -> None:
        self._stop_main_loop()
        self.mode = "RUNNING_MAIN"

        async def _runner():
            step = 0
            try:
                if "while True" in src and "sleep" not in src:
                    self._emit(f"[{label}] Running tight loop (press Stop / Ctrl+C to interrupt!)...\r\n")
                    while True:
                        await asyncio.sleep(2.0)
                elif "while True" not in src:
                    out = self._exec_python(src)
                    if out:
                        self._emit(out.replace("\n", "\r\n"))
                    self.mode = "FRIENDLY_REPL"
                    self._emit("\r\n>>> ")
                else:
                    while True:
                        step += 1
                        self.pins[2] = step % 2
                        self.mem_extra_garbage = min(65000, self.mem_extra_garbage + 384)
                        ram_alloc = 98_000 + self.mem_extra_garbage
                        ram_free = max(24_000, self.mem_total - ram_alloc)
                        temp_c = round(39.2 + (step % 5) * 0.3, 1)
                        rssi = -54 - (step % 6)
                        self.wifi_rssi = rssi
                        if "Room Temp=" in src:
                            self._emit(
                                f"[{label}] Step {step}: LED={'ON' if self.pins[2] else 'OFF'} | Room Temp={24.5 + (step % 5)*0.3:.1f}C\r\n"
                            )
                        else:
                            self._emit(f"[{label}] Running custom loop iteration #{step}\r\n")
                        metric = {
                            "ram_free": ram_free,
                            "ram_alloc": ram_alloc,
                            "flash_free": self.vfs.statvfs()[0] * self.vfs.statvfs()[3],
                            "flash_total": self.vfs.statvfs()[0] * self.vfs.statvfs()[2],
                            "cpu_mhz": self.cpu_freq // 1_000_000,
                            "temp_c": temp_c,
                            "uptime_ms": int((time.monotonic() - self._start_time) * 1000),
                            "ip": self.wifi_ip if self.wifi_connected else None,
                            "rssi": rssi if self.wifi_connected else None,
                        }
                        self._emit("@METRIC:" + json.dumps(metric) + "\r\n")
                        await asyncio.sleep(1.5)
            except asyncio.CancelledError:
                return

        self._main_task = asyncio.create_task(_runner(), name="esp32-sim-main")

    async def hard_reset(self) -> bool:
        self._stop_main_loop()
        self.reset_cause_code = 2  # HARD / EXT RESET
        self.mem_extra_garbage = 12_000
        self._emit("\r\nrst:0x1 (POWERON),boot:0x8 (SPI_FAST_FLASH_BOOT) [Hard Reset]\r\n")
        self._emit("[boot.py] ESP32-S3 starting up...\r\n")
        self._start_main_loop()
        return True

    async def enter_bootloader(self) -> bool:
        self._stop_main_loop()
        self.mode = "FRIENDLY_REPL"
        self._emit("\r\nrst:0x1 (POWERON),boot:0x0 (DOWNLOAD(USB/UART0))\r\nwaiting for download\r\n")
        return True

    async def write(self, data: bytes) -> None:
        if not self._connected:
            raise RuntimeError("Simulator not connected")

        for b in data:
            if b == 0x03:  # Ctrl+C
                was_running = self.mode == "RUNNING_MAIN"
                self._stop_main_loop()
                self.raw_buf.clear()
                self.line_buf.clear()
                self.mode = "FRIENDLY_REPL"
                if was_running:
                    self._emit("\r\nTraceback (most recent call last):\r\n  File \"main.py\", line 14, in <module>\r\nKeyboardInterrupt: \r\n")
                else:
                    self._emit("\r\n")
                self._emit("MicroPython v1.23.0 on 2024-06-02; Generic ESP32S3 module (SIMULATOR)\r\n>>> ")
            elif b == 0x01:  # Ctrl+A -> Raw REPL
                self._stop_main_loop()
                self.raw_buf.clear()
                self.mode = "RAW_REPL"
                self._emit("\r\nraw REPL; CTRL-B to exit\r\n>")
            elif b == 0x02:  # Ctrl+B -> Exit Raw REPL to Friendly REPL
                self.raw_buf.clear()
                self.mode = "FRIENDLY_REPL"
                self._emit("\r\nMicroPython v1.23.0 on 2024-06-02; Generic ESP32S3 module (SIMULATOR)\r\nType \"help()\" for more information.\r\n>>> ")
            elif b == 0x04:  # Ctrl+D -> Execute raw buffer or soft reset
                if self.mode == "RAW_REPL":
                    code = self.raw_buf.decode("utf-8", "replace")
                    self.raw_buf.clear()
                    self._run_raw_command(code)
                else:
                    # Soft reset in friendly REPL
                    self._stop_main_loop()
                    self.reset_cause_code = 4  # SOFT_RESET
                    self._emit("\r\nMPY: soft reboot\r\n")
                    self._emit("[boot.py] ESP32-S3 starting up...\r\n")
                    self._start_main_loop()
            else:
                if self.mode == "RAW_REPL":
                    self.raw_buf.append(b)
                elif self.mode == "FRIENDLY_REPL":
                    if b == 10 and self._last_cr:
                        self._last_cr = False
                        continue
                    self._last_cr = (b == 13)
                    if b in (13, 10):  # Enter
                        cmd = self.line_buf.decode("utf-8", "replace")
                        self.line_buf.clear()
                        self._emit("\r\n")
                        if cmd.strip():
                            # Handle exec(open('...').read()) cleanly if target has an infinite loop
                            import re
                            m = re.match(r"^exec\s*\(\s*open\s*\(\s*['\"]([^'\"]+)['\"]\s*\)\.read\(\)\s*\)$", cmd.strip())
                            if m:
                                target_path = self.vfs.norm(m.group(1))
                                if target_path in self.vfs.files:
                                    src = self.vfs.files[target_path].decode("utf-8", "replace")
                                    if "while True" in src:
                                        self._launch_loop_script(src, label=target_path.lstrip("/"))
                                        continue
                            out = self._exec_python(cmd, repl_echo=True)
                            if out:
                                self._emit(out.replace("\n", "\r\n"))
                                if not out.endswith("\n"):
                                    self._emit("\r\n")
                        self._emit(">>> ")
                    elif b in (8, 127):  # Backspace
                        if self.line_buf:
                            self.line_buf.pop()
                            self._emit("\b \b")
                    else:
                        self.line_buf.append(b)
                        self._emit(bytes([b]).decode("utf-8", "replace"))

    def _run_raw_command(self, code: str) -> None:
        self._emit("OK")
        stdout_text, stderr_text = self._exec_python_split(code)
        if stdout_text:
            self._emit(stdout_text)
        self._emit("\x04")
        if stderr_text:
            self._emit(stderr_text)
        self._emit("\x04>")

    def _build_sim_modules(self) -> None:
        sim = self

        class _SimOS:
            @staticmethod
            def listdir(path="/"):
                return sim.vfs.listdir(path)

            @staticmethod
            def ilistdir(path="/"):
                return sim.vfs.ilistdir(path)

            @staticmethod
            def stat(path):
                return sim.vfs.stat(path)

            @staticmethod
            def statvfs(path="/"):
                return sim.vfs.statvfs()

            @staticmethod
            def mkdir(path):
                return sim.vfs.mkdir(path)

            @staticmethod
            def remove(path):
                return sim.vfs.remove(path)

            @staticmethod
            def rmdir(path):
                return sim.vfs.rmdir(path)

            @staticmethod
            def rename(old, new):
                return sim.vfs.rename(old, new)

            @staticmethod
            def uname():
                return ("esp32", "esp32", "1.23.0", "v1.23.0 on 2024-06-02", "Generic ESP32S3 module (SIMULATOR) with ESP32S3")

        class _SimGC:
            @staticmethod
            def mem_free():
                alloc = _SimGC.mem_alloc()
                return max(16384, sim.mem_total - alloc)

            @staticmethod
            def mem_alloc():
                return 98_000 + sim.mem_extra_garbage

            @staticmethod
            def collect():
                sim.mem_extra_garbage = 8_200

        class _SimPin:
            OUT = 1
            IN = 0

            def __init__(self, pin_id, mode=None):
                self.id = int(pin_id)
                sim.pins.setdefault(self.id, 0)

            def value(self, v=None):
                if v is None:
                    return sim.pins.get(self.id, 0)
                sim.pins[self.id] = 1 if v else 0
                return sim.pins[self.id]

            def on(self):
                self.value(1)

            def off(self):
                self.value(0)

        class _SimSoftI2C:
            def __init__(self, scl=None, sda=None, freq=100000):
                self.scl = scl
                self.sda = sda

            def scan(self):
                # Demo SSD1306 OLED (0x3C) + BME280 Sensor (0x76)
                return [0x3C, 0x76]

        class _SimMachine:
            Pin = _SimPin
            SoftI2C = _SimSoftI2C
            I2C = _SimSoftI2C

            @staticmethod
            def freq(val=None):
                if val is not None:
                    sim.cpu_freq = int(val)
                return sim.cpu_freq

            @staticmethod
            def reset_cause():
                return sim.reset_cause_code

            @staticmethod
            def reset():
                asyncio.create_task(sim.hard_reset())

            @staticmethod
            def soft_reset():
                asyncio.create_task(sim.write(b"\x04"))

            @staticmethod
            def unique_id():
                return b"\x24\x6f\x28\xab\xcd\xef"

        class _SimWLAN:
            def __init__(self, mode):
                self.mode = mode

            def active(self, val=None):
                if val is not None and self.mode == 1:
                    sim.ap_active = bool(val)
                return True

            def scan(self):
                return [
                    (b"Lab-WiFi-2.4G", b"\xaa\xbb\xcc\x11\x22\x33", 6, -54, 3, False),
                    (b"HomeRouter_IoT", b"\xaa\xbb\xcc\x44\x55\x66", 1, -67, 3, False),
                    (b"Guest_Open", b"\xaa\xbb\xcc\x77\x88\x99", 11, -78, 0, False),
                    (b"Workshop-5G-2G", b"\xaa\xbb\xcc\x99\xaa\xbb", 3, -72, 4, False),
                ]

            def connect(self, ssid, pw=""):
                sim.wifi_ssid = ssid
                sim.wifi_connected = True
                sim.wifi_ip = f"192.168.1.{random.randint(105, 199)}"
                sim.wifi_rssi = -52

            def disconnect(self):
                sim.wifi_connected = False

            def isconnected(self):
                return sim.wifi_connected if self.mode == 0 else sim.ap_active

            def ifconfig(self):
                if self.mode == 0:
                    return (sim.wifi_ip, "255.255.255.0", "192.168.1.1", "8.8.8.8") if sim.wifi_connected else ("0.0.0.0", "0.0.0.0", "0.0.0.0", "0.0.0.0")
                return ("192.168.4.1", "255.255.255.0", "192.168.4.1", "192.168.4.1")

            def config(self, *args, **kwargs):
                if args and args[0] == "essid":
                    return sim.wifi_ssid if self.mode == 0 else sim.ap_ssid
                if "essid" in kwargs and self.mode == 1:
                    sim.ap_ssid = kwargs["essid"]

            def status(self, key=None):
                if key == "rssi":
                    return sim.wifi_rssi
                return 1010 if sim.wifi_connected else 0

        class _SimNetwork:
            STA_IF = 0
            AP_IF = 1
            WLAN = _SimWLAN

        class _SimESP32:
            @staticmethod
            def mcu_temperature():
                return round(39.4 + random.uniform(-0.4, 0.6), 1)

        class _SimTime:
            @staticmethod
            def sleep(s):
                time.sleep(min(float(s), 0.25))

            @staticmethod
            def ticks_ms():
                return int((time.monotonic() - sim._start_time) * 1000)

        class _SimSys:
            platform = "esp32"
            version = "3.4.0; MicroPython v1.23.0 on 2024-06-02"

        class _SimWebREPL:
            @staticmethod
            def start(port=8266, password=None):
                sim.webrepl_started = True

        import binascii

        self._modules = {
            "os": _SimOS,
            "uos": _SimOS,
            "gc": _SimGC,
            "machine": _SimMachine,
            "network": _SimNetwork,
            "esp32": _SimESP32,
            "time": _SimTime,
            "utime": _SimTime,
            "sys": _SimSys,
            "webrepl": _SimWebREPL,
            "json": json,
            "ujson": json,
            "binascii": binascii,
            "ubinascii": binascii,
        }

        def sim_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name in self._modules:
                return self._modules[name]
            # Check virtual /lib or root .py module
            for candidate in (f"/{name}.py", f"/lib/{name}.py"):
                if candidate in sim.vfs.files:
                    import types
                    mod = types.ModuleType(name)
                    mod_dict = {"__name__": name, "__builtins__": self._sim_builtins}
                    exec(sim.vfs.files[candidate].decode("utf-8", "replace"), mod_dict)
                    mod.__dict__.update(mod_dict)
                    return mod
            raise ImportError(f"No module named '{name}'")

        def sim_open(path, mode="r", *args, **kwargs):
            return _SimFile(sim.vfs, str(path), mode)

        import builtins
        safe_builtins = dict(vars(builtins))
        safe_builtins["open"] = sim_open
        safe_builtins["__import__"] = sim_import
        self._sim_builtins = safe_builtins
        self._sim_globals = {"__builtins__": safe_builtins, "__name__": "__main__"}

    def _exec_python(self, code: str, repl_echo: bool = False) -> str:
        out, err = self._exec_python_split(code, repl_echo=repl_echo)
        return (out + err)

    def _exec_python_split(self, code: str, repl_echo: bool = False) -> tuple[str, str]:
        stdout_io = io.StringIO()
        stderr_io = io.StringIO()
        with contextlib.redirect_stdout(stdout_io), contextlib.redirect_stderr(stderr_io):
            try:
                stripped = code.strip()
                if repl_echo and stripped and "\n" not in stripped:
                    try:
                        val = eval(stripped, self._sim_globals)
                        if val is not None:
                            print(repr(val))
                    except SyntaxError:
                        exec(code, self._sim_globals)
                else:
                    exec(code, self._sim_globals)
            except Exception as exc:
                import traceback
                traceback.print_exc(file=stderr_io)
        return stdout_io.getvalue(), stderr_io.getvalue()
