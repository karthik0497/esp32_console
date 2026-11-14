"""MicroPython Raw/Friendly REPL protocol engine with X-Ray learning trace emission."""

import asyncio
import base64
import io
import json
import posixpath
import zipfile
from typing import Callable, Optional

from backend.engines.crash_decoder import explain_reset_cause
from backend.helpers.wifi_ap_fallback import WIFI_MANAGER_MPY

COMMON_I2C_DEVICES = {
    0x20: "PCF8574 I/O Expander",
    0x27: "16x2 / 20x4 LCD (I2C Backpack)",
    0x3C: "SSD1306 / SH1106 OLED Display",
    0x3D: "SSD1306 OLED Display (Alt Addr)",
    0x40: "INA219 Current Sensor / HTU21D",
    0x44: "SHT31 Temp & Humidity Sensor",
    0x48: "ADS1115 ADC / TMP102 Temp",
    0x50: "AT24C32 EEPROM",
    0x57: "MAX30102 Pulse Oximeter / EEPROM",
    0x68: "MPU6050 IMU / DS3231 RTC Clock",
    0x76: "BME280 / BMP280 Env Sensor",
    0x77: "BME280 / BMP280 / BMP180 Env Sensor",
}

AUTH_MODES = {0: "Open", 1: "WEP", 2: "WPA-PSK", 3: "WPA2-PSK", 4: "WPA/WPA2-PSK", 5: "WPA2-Enterprise"}


class MicroPythonReplEngine:
    """Executes Raw REPL & Friendly REPL operations safely over any DeviceTransport."""

    def __init__(
        self,
        get_transport: Callable,
        lock: asyncio.Lock,
        on_xray: Optional[Callable[[dict], None]] = None,
    ):
        self._get_transport = get_transport
        self._lock = lock
        self._on_xray = on_xray
        self._capture_buf = bytearray()
        self._capturing = False
        self._capture_event = asyncio.Event()

    def feed_bytes(self, data: bytes) -> None:
        if self._capturing:
            self._capture_buf.extend(data)
            self._capture_event.set()

    def _emit_xray(self, action: str, code: str, explanation: str, protocol: str = "Raw REPL (Ctrl+A ... Ctrl+D)") -> None:
        if self._on_xray:
            self._on_xray(
                {
                    "action": action,
                    "protocol": protocol,
                    "code": code.strip(),
                    "explanation": explanation,
                }
            )

    async def _wait_for_marker(self, marker: bytes, timeout: float) -> bytes:
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            idx = self._capture_buf.find(marker)
            if idx != -1:
                end = idx + len(marker)
                out = bytes(self._capture_buf[:end])
                del self._capture_buf[:end]
                return out
            remaining = max(0.02, deadline - asyncio.get_running_loop().time())
            self._capture_event.clear()
            try:
                await asyncio.wait_for(self._capture_event.wait(), timeout=min(0.2, remaining))
            except asyncio.TimeoutError:
                pass
        raise TimeoutError(f"Timed out waiting for ESP32 response ({marker!r}). If main.py is in a tight loop, click Stop (Ctrl+C) or Safe Recovery.")

    async def _enter_raw_repl(self, transport) -> None:
        self._capture_buf.clear()
        # Interrupt any running code twice, then enter Raw REPL (Ctrl+A)
        await transport.write(b"\r\x03\x03")
        await asyncio.sleep(0.12)
        self._capture_buf.clear()
        await transport.write(b"\r\x01")
        try:
            await self._wait_for_marker(b"raw REPL; CTRL-B to exit\r\n>", timeout=2.5)
        except TimeoutError:
            # Retry once more with stronger Ctrl+C burst
            await transport.write(b"\x03\x03\x03")
            await asyncio.sleep(0.2)
            self._capture_buf.clear()
            await transport.write(b"\r\x01")
            await self._wait_for_marker(b"raw REPL; CTRL-B to exit\r\n>", timeout=2.5)

    async def _exit_raw_repl(self, transport) -> None:
        try:
            await transport.write(b"\x02")
            await asyncio.sleep(0.05)
        except Exception:
            pass

    async def exec_raw(
        self,
        code: str,
        action: str = "Execute MicroPython",
        explanation: str = "Runs a short Python snippet inside MicroPython Raw REPL.",
        timeout: float = 8.0,
    ) -> str:
        transport = self._get_transport()
        if not transport or not transport.is_connected:
            raise RuntimeError("No ESP32 connected.")

        self._emit_xray(action=action, code=code, explanation=explanation)

        async with self._lock:
            self._capturing = True
            self._capture_buf.clear()
            try:
                await self._enter_raw_repl(transport)
                self._capture_buf.clear()

                payload = code.encode("utf-8")
                # Chunk writes for UART/WebREPL buffer safety
                for i in range(0, len(payload), 256):
                    await transport.write(payload[i : i + 256])
                    if i + 256 < len(payload):
                        await asyncio.sleep(0.01)
                await transport.write(b"\x04")

                # Expect OK<stdout>\x04<stderr>\x04>
                await self._wait_for_marker(b"OK", timeout=timeout)
                stdout_part = await self._wait_for_marker(b"\x04", timeout=timeout)
                stderr_part = await self._wait_for_marker(b"\x04>", timeout=timeout)

                stdout_text = stdout_part[:-1].decode("utf-8", "replace")
                stderr_text = stderr_part[:-2].decode("utf-8", "replace")
                if stderr_text.strip():
                    raise RuntimeError(stderr_text.strip())
                return stdout_text
            finally:
                await self._exit_raw_repl(transport)
                self._capturing = False
                self._capture_buf.clear()

    async def interrupt(self, aggressive: bool = False) -> None:
        transport = self._get_transport()
        if not transport or not transport.is_connected:
            raise RuntimeError("No ESP32 connected.")
        seq = b"\x03\x03\x03\x03\x03" if aggressive else b"\x03\x03"
        self._emit_xray(
            action="Aggressive Stop (Ctrl+C Burst)" if aggressive else "Stop Running Code (Ctrl+C)",
            code=repr(seq),
            explanation="Sends ASCII byte 0x03 (Ctrl+C) to trigger KeyboardInterrupt inside MicroPython so main.py pauses and drops to the >>> prompt.",
            protocol="UART / WebREPL Control Byte",
        )
        async with self._lock:
            await transport.write(seq)

    async def soft_reset(self) -> None:
        transport = self._get_transport()
        if not transport or not transport.is_connected:
            raise RuntimeError("No ESP32 connected.")
        self._emit_xray(
            action="Soft Reboot (Ctrl+D)",
            code="b'\\x04'  # machine.soft_reset()",
            explanation="Sends Ctrl+D at the REPL prompt to restart Python cleanly (re-running boot.py then main.py) without cutting USB power.",
            protocol="UART / WebREPL Control Byte",
        )
        async with self._lock:
            await transport.write(b"\x03\x02\x04")

    async def safe_recovery(self, disable_main: bool = False) -> dict:
        transport = self._get_transport()
        if not transport or not transport.is_connected:
            raise RuntimeError("No ESP32 connected.")
        self._emit_xray(
            action="Safe Recovery Mode",
            code="Hard Reset -> Ctrl+C burst (0x03) -> Optional rename main.py -> main.py.bak",
            explanation="Resets the board and floods Ctrl+C during boot so runaway `while True:` code is caught before locking the serial console.",
            protocol="Hardware RTS Reset + Ctrl+C Flood",
        )
        async with self._lock:
            if transport.capabilities.get("hard_reset"):
                await transport.hard_reset()
                for _ in range(10):
                    await asyncio.sleep(0.08)
                    await transport.write(b"\x03\x03")
            else:
                await transport.write(b"\x03\x03\x03\x03\x03")

        renamed = False
        if disable_main:
            res = await self.exec_raw(
                "import os\n"
                "try:\n"
                "    os.rename('/main.py', '/main.py.bak')\n"
                "    print('RENAMED')\n"
                "except OSError:\n"
                "    print('NO_MAIN')\n",
                action="Disable runaway main.py",
                explanation="Safely renames /main.py to /main.py.bak so the board boots cleanly to >>> on next restart.",
            )
            renamed = "RENAMED" in res
        return {"recovered": True, "main_disabled": renamed}

    async def list_files(self, path: str = "/") -> list[dict]:
        snippet = (
            "import os, json\n"
            f"root = {path!r}\n"
            "items = []\n"
            "def walk(p):\n"
            "    for e in os.ilistdir(p):\n"
            "        name, typ, _, sz = e[0], e[1], e[2], (e[3] if len(e) > 3 else 0)\n"
            "        full = ('/' + name) if p == '/' else (p + '/' + name)\n"
            "        is_dir = bool(typ & 0x4000)\n"
            "        items.append({'path': full, 'name': name, 'is_dir': is_dir, 'size': sz})\n"
            "        if is_dir:\n"
            "            walk(full)\n"
            "walk(root)\n"
            "print(json.dumps(items))\n"
        )
        out = await self.exec_raw(
            snippet,
            action="List Files & Directories",
            explanation="Walks the ESP32 LittleFS/FAT filesystem using `os.ilistdir()` and returns every file, folder, and byte size as JSON.",
        )
        return json.loads(out.strip() or "[]")

    async def read_file(self, path: str) -> bytes:
        snippet = (
            "import binascii\n"
            f"with open({path!r}, 'rb') as f:\n"
            "    while True:\n"
            "        chunk = f.read(512)\n"
            "        if not chunk: break\n"
            "        print(binascii.b2a_base64(chunk).decode().strip())\n"
        )
        out = await self.exec_raw(
            snippet,
            action=f"Read {path}",
            explanation=f"Opens `{path}` in binary mode on the ESP32 and base64-encodes chunks so text or binary files arrive safely without serial corruption.",
            timeout=12.0,
        )
        raw_b64 = "".join(out.strip().splitlines())
        return base64.b64decode(raw_b64) if raw_b64 else b""

    async def write_file(self, path: str, content: bytes) -> None:
        norm_path = posixpath.normpath("/" + path.lstrip("/"))
        parent = posixpath.dirname(norm_path)
        b64 = base64.b64encode(content).decode("ascii")
        lines = [
            "import os, binascii",
            f"p = {parent!r}",
            "if p and p != '/':\n    parts = [x for x in p.split('/') if x]\n    cur = ''\n    for pt in parts:\n        cur += '/' + pt\n        try: os.mkdir(cur)\n        except OSError: pass",
            f"f = open({norm_path!r}, 'wb')",
        ]
        # Send base64 in 384-char chunks so Raw REPL lines stay compact
        for i in range(0, len(b64), 384):
            chunk = b64[i : i + 384]
            lines.append(f"f.write(binascii.a2b_base64({chunk!r}))")
        lines.append("f.close()")
        lines.append("print('OK')")

        snippet = "\n".join(lines) + "\n"
        await self.exec_raw(
            snippet,
            action=f"Upload {norm_path} ({len(content)} bytes)",
            explanation=f"Creates parent directories if needed and writes `{norm_path}` onto ESP32 flash storage using safe Base64 chunks.",
            timeout=20.0,
        )

    async def delete_path(self, path: str) -> None:
        snippet = (
            "import os\n"
            "def rm_rf(p):\n"
            "    try:\n"
            "        st = os.stat(p)\n"
            "        if st[0] & 0x4000:\n"
            "            for name in os.listdir(p):\n"
            "                rm_rf(('/' + name) if p == '/' else (p + '/' + name))\n"
            "            os.rmdir(p)\n"
            "        else:\n"
            "            os.remove(p)\n"
            "    except OSError as e:\n"
            "        raise e\n"
            f"rm_rf({path!r})\n"
        )
        await self.exec_raw(
            snippet,
            action=f"Delete {path}",
            explanation=f"Removes `{path}` (and any nested files if it is a folder) from ESP32 flash memory using `os.remove()` / `os.rmdir()`.",
        )

    async def mkdir(self, path: str) -> None:
        norm = posixpath.normpath("/" + path.lstrip("/"))
        await self.exec_raw(
            f"import os\nos.mkdir({norm!r})\n",
            action=f"Create Folder {norm}",
            explanation=f"Creates directory `{norm}` in the ESP32 flash filesystem via `os.mkdir()`.",
        )

    async def rename_path(self, old_path: str, new_path: str) -> None:
        await self.exec_raw(
            f"import os\nos.rename({old_path!r}, {new_path!r})\n",
            action=f"Rename {old_path} -> {new_path}",
            explanation="Renames or moves a file/folder inside the ESP32 filesystem with `os.rename()`.",
        )

    async def make_main(self, source_path: str) -> None:
        snippet = (
            f"with open({source_path!r}, 'rb') as src, open('/main.py', 'wb') as dst:\n"
            "    while True:\n"
            "        buf = src.read(512)\n"
            "        if not buf: break\n"
            "        dst.write(buf)\n"
        )
        await self.exec_raw(
            snippet,
            action=f"Set {source_path} as /main.py",
            explanation="Copies the selected Python script into `/main.py` so the ESP32 automatically runs it every time it powers on.",
        )

    async def run_file(self, path: str) -> None:
        transport = self._get_transport()
        if not transport or not transport.is_connected:
            raise RuntimeError("No ESP32 connected.")
        cmd = f"exec(open({path!r}).read())\r\n"
        self._emit_xray(
            action=f"Run {path}",
            code=cmd.strip(),
            explanation=f"Drops to Friendly REPL (>>>) and runs `{path}` so all `print()` output streams live into the terminal.",
            protocol="Friendly REPL",
        )
        async with self._lock:
            await transport.write(b"\x03\x02")
            await asyncio.sleep(0.1)
            await transport.write(cmd.encode("utf-8"))

    async def backup_zip(self) -> bytes:
        entries = await self.list_files("/")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for item in entries:
                if not item["is_dir"]:
                    data = await self.read_file(item["path"])
                    zf.writestr(item["path"].lstrip("/"), data)
        return buf.getvalue()

    async def get_metrics(self) -> dict:
        snippet = (
            "import gc, os, sys, json, machine\n"
            "res = {\n"
            "    'ram_free': gc.mem_free(),\n"
            "    'ram_alloc': gc.mem_alloc(),\n"
            "    'cpu_mhz': machine.freq() // 1000000,\n"
            "    'reset_cause': machine.reset_cause(),\n"
            "    'platform': sys.platform,\n"
            "    'version': sys.version,\n"
            "    'machine': os.uname()[4] if hasattr(os, 'uname') else 'ESP32',\n"
            "}\n"
            "try:\n"
            "    st = os.statvfs('/')\n"
            "    res['flash_total'] = st[0] * st[2]\n"
            "    res['flash_free'] = st[0] * st[3]\n"
            "except Exception: pass\n"
            "try:\n"
            "    import esp32\n"
            "    if hasattr(esp32, 'mcu_temperature'):\n"
            "        res['temp_c'] = round(esp32.mcu_temperature(), 1)\n"
            "    elif hasattr(esp32, 'raw_temperature'):\n"
            "        res['temp_c'] = round((esp32.raw_temperature() - 32) * 5 / 9, 1)\n"
            "except Exception: pass\n"
            "try:\n"
            "    import network\n"
            "    w = network.WLAN(network.STA_IF)\n"
            "    res['wifi_active'] = w.active()\n"
            "    res['wifi_connected'] = w.isconnected()\n"
            "    if w.isconnected():\n"
            "        res['ip'] = w.ifconfig()[0]\n"
            "        try: res['rssi'] = w.status('rssi')\n"
            "        except Exception: pass\n"
            "except Exception: pass\n"
            "print(json.dumps(res))\n"
        )
        out = await self.exec_raw(
            snippet,
            action="Sample System & Memory Metrics",
            explanation="Queries `gc` (RAM heap), `os.statvfs` (Flash storage), `machine.freq()` (CPU speed), `machine.reset_cause()`, MCU temperature, and Wi-Fi status.",
        )
        data = json.loads(out.strip())
        data["reset_info"] = explain_reset_cause(data.get("reset_cause"))
        return data

    async def run_health_checkup(self) -> dict:
        snippet = (
            "import gc, os, sys, json, machine\n"
            "def exists(p):\n"
            "    try: return os.stat(p)[6]\n"
            "    except OSError: return -1\n"
            "res = {\n"
            "    'platform': sys.platform,\n"
            "    'version': sys.version,\n"
            "    'machine': os.uname()[4] if hasattr(os, 'uname') else 'ESP32',\n"
            "    'ram_free': gc.mem_free(),\n"
            "    'ram_alloc': gc.mem_alloc(),\n"
            "    'cpu_mhz': machine.freq() // 1000000,\n"
            "    'reset_cause': machine.reset_cause(),\n"
            "    'files': {\n"
            "        'boot_py': exists('/boot.py'),\n"
            "        'main_py': exists('/main.py'),\n"
            "        'wifi_cfg': exists('/wifi_config.json'),\n"
            "        'webrepl_cfg': exists('/webrepl_cfg.py'),\n"
            "        'agent_py': exists('/esp_console_agent.py'),\n"
            "        'wifi_mgr': exists('/wifi_manager.py'),\n"
            "    },\n"
            "}\n"
            "try:\n"
            "    st = os.statvfs('/')\n"
            "    res['flash_total'] = st[0] * st[2]\n"
            "    res['flash_free'] = st[0] * st[3]\n"
            "except Exception: pass\n"
            "try:\n"
            "    import network\n"
            "    sta = network.WLAN(network.STA_IF)\n"
            "    res['wifi_connected'] = sta.isconnected()\n"
            "    if sta.isconnected():\n"
            "        res['ip'] = sta.ifconfig()[0]\n"
            "        try: res['rssi'] = sta.status('rssi')\n"
            "        except Exception: pass\n"
            "except Exception: pass\n"
            "print(json.dumps(res))\n"
        )
        out = await self.exec_raw(
            snippet,
            action="Run Full Board Health Checkup",
            explanation="Runs a single comprehensive check across firmware version, boot/main/Wi-Fi files, Heap RAM, Flash storage, Reset Reason, and wireless WebREPL readiness.",
        )
        raw = json.loads(out.strip())
        reset_info = explain_reset_cause(raw.get("reset_cause"))
        ram_free = raw.get("ram_free", 0)
        ram_total = ram_free + raw.get("ram_alloc", 0)
        ram_free_pct = round((ram_free / ram_total) * 100, 1) if ram_total else 0
        flash_free = raw.get("flash_free", 0)
        flash_total = raw.get("flash_total", 0)
        flash_free_pct = round((flash_free / flash_total) * 100, 1) if flash_total else 0
        f = raw.get("files", {})

        checks = [
            {
                "name": "MicroPython Runtime",
                "status": "pass",
                "detail": f"{raw.get('machine', 'ESP32')} — {raw.get('version', '')}",
                "advice": "Board responded cleanly to Raw REPL.",
            },
            {
                "name": "Heap RAM Health",
                "status": "warn" if ram_free_pct < 20 else "pass",
                "detail": f"{ram_free // 1024} KB free ({ram_free_pct}% of {ram_total // 1024} KB)",
                "advice": "Healthy memory headroom." if ram_free_pct >= 20 else "RAM is getting low — click Free RAM (gc.collect)!",
            },
            {
                "name": "Flash Storage Health",
                "status": "warn" if flash_free_pct < 15 else "pass",
                "detail": f"{flash_free // 1024} KB free ({flash_free_pct}% available)",
                "advice": "Plenty of space for scripts." if flash_free_pct >= 15 else "Flash is almost full — remove unused files.",
            },
            {
                "name": "Last Reset Reason",
                "status": "warn" if reset_info["severity"] in ("warn", "error") else "pass",
                "detail": f"{reset_info['title']} ({reset_info['code']})",
                "advice": reset_info["fix"] or reset_info["meaning"],
            },
            {
                "name": "Startup Files (/boot.py & /main.py)",
                "status": "pass" if f.get("main_py", -1) >= 0 else "info",
                "detail": f"boot.py: {'Yes' if f.get('boot_py', -1) >= 0 else 'Missing'} | main.py: {'Yes' if f.get('main_py', -1) >= 0 else 'None (boots to >>>)'}",
                "advice": "Upload or mark a script with Make main.py to auto-run on power up." if f.get("main_py", -1) < 0 else "Auto-start main.py is present.",
            },
            {
                "name": "Wi-Fi & Wireless WebREPL",
                "status": "pass" if (raw.get("wifi_connected") and f.get("webrepl_cfg", -1) >= 0) else "info",
                "detail": f"Wi-Fi: {raw.get('ip') if raw.get('wifi_connected') else 'Not connected'} | WebREPL cfg: {'Yes' if f.get('webrepl_cfg', -1) >= 0 else 'No'} | AP Fallback: {'Yes' if f.get('wifi_mgr', -1) >= 0 else 'No'}",
                "advice": "Ready for wireless management!" if (raw.get("wifi_connected") and f.get("webrepl_cfg", -1) >= 0) else "Visit Tab 3 (Wi-Fi & WebREPL) to enable wireless uploads.",
            },
            {
                "name": "Live Telemetry Agent",
                "status": "pass" if f.get("agent_py", -1) >= 0 else "info",
                "detail": "/esp_console_agent.py " + ("installed" if f.get("agent_py", -1) >= 0 else "not installed"),
                "advice": "Import esp_console_agent in your loop for live graphs." if f.get("agent_py", -1) >= 0 else "Optional: click Install Live Metrics Agent above.",
            },
        ]
        return {"raw": raw, "checks": checks}

    async def run_gc(self) -> dict:
        snippet = (
            "import gc, json\n"
            "before = gc.mem_free()\n"
            "gc.collect()\n"
            "after = gc.mem_free()\n"
            "print(json.dumps({'before': before, 'after': after, 'freed': max(0, after - before), 'alloc': gc.mem_alloc()}))\n"
        )
        out = await self.exec_raw(
            snippet,
            action="Run Garbage Collector (gc.collect())",
            explanation="Clears unused temporary variables from Heap RAM (`gc.collect()`) so more contiguous memory is available for your code.",
        )
        return json.loads(out.strip())

    async def set_cpu_freq(self, mhz: int) -> dict:
        hz = int(mhz) * 1_000_000
        out = await self.exec_raw(
            f"import machine\nmachine.freq({hz})\nprint(machine.freq() // 1000000)\n",
            action=f"Set CPU Speed to {mhz} MHz",
            explanation="Adjusts ESP32 clock speed via `machine.freq()`. Lower speed (80 MHz) saves battery & heat; 240 MHz gives maximum performance.",
        )
        return {"cpu_mhz": int(out.strip())}

    async def wifi_status(self) -> dict:
        snippet = (
            "import network, json\n"
            "sta = network.WLAN(network.STA_IF)\n"
            "ap = network.WLAN(network.AP_IF)\n"
            "res = {\n"
            "    'sta_active': sta.active(),\n"
            "    'sta_connected': sta.isconnected(),\n"
            "    'sta_ifconfig': sta.ifconfig() if sta.active() else None,\n"
            "    'ap_active': ap.active(),\n"
            "    'ap_ifconfig': ap.ifconfig() if ap.active() else None,\n"
            "}\n"
            "try: res['sta_ssid'] = sta.config('essid')\n"
            "except Exception: pass\n"
            "try: res['rssi'] = sta.status('rssi') if sta.isconnected() else None\n"
            "except Exception: pass\n"
            "try:\n"
            "    with open('/wifi_config.json') as f:\n"
            "        saved = json.load(f)\n"
            "        res['saved_ssid'] = saved.get('ssid', '')\n"
            "except Exception:\n"
            "    res['saved_ssid'] = ''\n"
            "print(json.dumps(res))\n"
        )
        out = await self.exec_raw(
            snippet,
            action="Check Wi-Fi Status",
            explanation="Inspects both Station (router connection) and Access Point (hotspot) interfaces plus saved `wifi_config.json`.",
        )
        return json.loads(out.strip())

    async def wifi_scan(self) -> list[dict]:
        snippet = (
            "import network, json\n"
            "sta = network.WLAN(network.STA_IF)\n"
            "sta.active(True)\n"
            "nets = []\n"
            "for n in sta.scan():\n"
            "    ssid = n[0].decode('utf-8', 'ignore') if isinstance(n[0], bytes) else str(n[0])\n"
            "    nets.append({'ssid': ssid, 'channel': n[2], 'rssi': n[3], 'authmode': n[4]})\n"
            "print(json.dumps(nets))\n"
        )
        out = await self.exec_raw(
            snippet,
            action="Scan Nearby Wi-Fi Networks",
            explanation="Activates the ESP32 Wi-Fi radio (`network.WLAN(STA_IF).active(True)`) and scans 2.4 GHz networks with `sta.scan()`.",
            timeout=12.0,
        )
        nets = json.loads(out.strip() or "[]")
        for n in nets:
            n["security"] = AUTH_MODES.get(n.get("authmode", 0), "Secured")
        nets.sort(key=lambda x: x.get("rssi", -100), reverse=True)
        return nets

    async def wifi_connect(self, ssid: str, password: str, save_config: bool = True, install_ap_fallback: bool = False) -> dict:
        if save_config:
            cfg = json.dumps({"ssid": ssid, "password": password}, indent=2).encode("utf-8")
            await self.write_file("/wifi_config.json", cfg)
            await self.write_file("/wifi_manager.py", WIFI_MANAGER_MPY.encode("utf-8"))
            boot_snippet = (
                "# Auto-generated by ESP32 Console (Wi-Fi + WebREPL)\n"
                "import gc\n"
                "gc.collect()\n"
                "import wifi_manager\n"
                f"wifi_manager.auto_connect(enable_ap_fallback={bool(install_ap_fallback)!r})\n"
                "try:\n"
                "    import webrepl\n"
                "    webrepl.start()\n"
                "except Exception:\n"
                "    pass\n"
            )
            await self.write_file("/boot.py", boot_snippet.encode("utf-8"))

        connect_code = (
            "import network, time, json\n"
            "sta = network.WLAN(network.STA_IF)\n"
            "sta.active(True)\n"
            f"sta.connect({ssid!r}, {password!r})\n"
            "t0 = time.ticks_ms() if hasattr(time, 'ticks_ms') else 0\n"
            "for _ in range(40):\n"
            "    if sta.isconnected(): break\n"
            "    time.sleep(0.25)\n"
            "print(json.dumps({'connected': sta.isconnected(), 'ifconfig': sta.ifconfig() if sta.isconnected() else None}))\n"
        )
        out = await self.exec_raw(
            connect_code,
            action=f"Connect Wi-Fi to '{ssid}'",
            explanation="Uploads `/wifi_config.json`, `/wifi_manager.py`, and `/boot.py` (with optional AP hotspot fallback), then connects `WLAN(STA_IF)`.",
            timeout=16.0,
        )
        return json.loads(out.strip())

    async def initial_wireless_setup(
        self,
        ssid: str,
        wifi_password: str,
        webrepl_password: str = "1234",
        install_ap_fallback: bool = True,
    ) -> dict:
        """Complete 1-step USB provisioning: Wi-Fi config + boot auto-connect + WebREPL password."""
        if len(webrepl_password) < 4 or len(webrepl_password) > 9:
            raise ValueError("WebREPL password must be 4 to 9 characters long.")
        wifi_res = await self.wifi_connect(
            ssid=ssid,
            password=wifi_password,
            save_config=True,
            install_ap_fallback=install_ap_fallback,
        )
        webrepl_res = await self.setup_webrepl(password=webrepl_password)
        return {
            "wifi": wifi_res,
            "webrepl": webrepl_res,
            "files_uploaded": ["/wifi_config.json", "/wifi_manager.py", "/boot.py", "/webrepl_cfg.py"],
        }

    async def wifi_ap(self, ssid: str = "ESP32-Setup", password: str = "12345678") -> dict:
        code = (
            "import network, json\n"
            "ap = network.WLAN(network.AP_IF)\n"
            "ap.active(True)\n"
            f"ap.config(essid={ssid!r}, password={password!r})\n"
            "print(json.dumps({'ap_active': ap.active(), 'ifconfig': ap.ifconfig(), 'ssid': ap.config('essid')}))\n"
        )
        out = await self.exec_raw(
            code,
            action=f"Start Wi-Fi Hotspot '{ssid}'",
            explanation="Turns the ESP32 into its own mini Wi-Fi router (`network.AP_IF`) at IP `192.168.4.1`.",
        )
        return json.loads(out.strip())

    async def setup_webrepl(self, password: str = "1234") -> dict:
        if len(password) < 4 or len(password) > 9:
            raise ValueError("MicroPython WebREPL password must be 4 to 9 characters long.")
        cfg_bytes = f"PASS = {password!r}\n".encode("utf-8")
        await self.write_file("/webrepl_cfg.py", cfg_bytes)

        # Ensure boot.py starts webrepl without duplicating lines
        try:
            existing_boot = (await self.read_file("/boot.py")).decode("utf-8", "replace")
        except Exception:
            existing_boot = ""

        if "webrepl" not in existing_boot:
            addition = "\n# Start wireless WebREPL\ntry:\n    import webrepl\n    webrepl.start()\nexcept Exception:\n    pass\n"
            await self.write_file("/boot.py", (existing_boot + addition).encode("utf-8"))

        out = await self.exec_raw(
            "import network, json\n"
            "try:\n"
            "    import webrepl\n"
            "    if hasattr(webrepl, 'stop'):\n"
            "        try: webrepl.stop()\n"
            "        except Exception: pass\n"
            "    try:\n"
            f"        webrepl.start(password={password!r})\n"
            "    except TypeError:\n"
            "        webrepl.start()\n"
            "    started = True\n"
            "except Exception as e:\n"
            "    started = False\n"
            "sta = network.WLAN(network.STA_IF)\n"
            "ip = sta.ifconfig()[0] if sta.isconnected() else None\n"
            "print(json.dumps({'started': started, 'ip': ip, 'ws_url': f'ws://{ip}:8266' if ip else None}))\n",
            action="Enable & Configure WebREPL Password",
            explanation="Writes `PASS = '...'` to `/webrepl_cfg.py` (exact same file `webrepl_setup` creates), adds `webrepl.start()` to `/boot.py`, and immediately starts/restarts WebREPL on port 8266 with your password.",
        )
        return json.loads(out.strip())

    async def i2c_scan(self, scl: int = 22, sda: int = 21) -> list[dict]:
        code = (
            "import machine, json\n"
            f"i2c = machine.SoftI2C(scl=machine.Pin({int(scl)}), sda=machine.Pin({int(sda)}), freq=100000)\n"
            "print(json.dumps(i2c.scan()))\n"
        )
        out = await self.exec_raw(
            code,
            action=f"Scan I2C Bus (SCL={scl}, SDA={sda})",
            explanation="Probes all 7-bit I2C addresses (0x08–0x77) to confirm sensors or OLED displays are wired properly and responding.",
        )
        addrs = json.loads(out.strip() or "[]")
        return [
            {"dec": a, "hex": f"0x{a:02X}", "guess": COMMON_I2C_DEVICES.get(a, "Unknown I2C Device")}
            for a in addrs
        ]

    async def gpio_action(self, pin: int, action: str = "toggle", value: Optional[int] = None) -> dict:
        if action == "read":
            code = f"import machine\np = machine.Pin({int(pin)}, machine.Pin.IN)\nprint(p.value())\n"
        elif action == "on":
            code = f"import machine\np = machine.Pin({int(pin)}, machine.Pin.OUT)\np.value(1)\nprint(p.value())\n"
        elif action == "off":
            code = f"import machine\np = machine.Pin({int(pin)}, machine.Pin.OUT)\np.value(0)\nprint(p.value())\n"
        else:
            code = (
                f"import machine\np = machine.Pin({int(pin)}, machine.Pin.OUT)\n"
                "v = 0 if p.value() else 1\n"
                "p.value(v)\n"
                "print(v)\n"
            )
        out = await self.exec_raw(
            code,
            action=f"GPIO Pin {pin} ({action.upper()})",
            explanation=f"Configures GPIO {pin} via `machine.Pin()` to test LEDs, relays, or button inputs immediately without writing a script.",
        )
        return {"pin": int(pin), "value": int(out.strip())}

