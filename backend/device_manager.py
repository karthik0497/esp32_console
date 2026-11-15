"""Central session manager owning the active ESP32 transport, REPL lock, and WebSocket broadcasts."""

import asyncio
import json
from collections import deque
from datetime import datetime
from typing import Any, Optional

from fastapi import WebSocket

from backend.engines.crash_decoder import detect_log_alert
from backend.engines.micropython_repl import MicroPythonReplEngine
from backend.transports.base import DeviceTransport
from backend.transports.serial_transport import SerialTransport, list_serial_ports
from pathlib import Path
from backend.transports.simulator_transport import SimulatorTransport
from backend.transports.webrepl_transport import WebReplTransport

LOG_FILE_PATH = Path(__file__).resolve().parent.parent / "esp32_activity.log"


class DeviceManager:
    """Coordinates transport lifecycle, Raw REPL locking, log parsing, and UI subscribers."""

    def __init__(self):
        self.transport: Optional[DeviceTransport] = None
        self.lock = asyncio.Lock()
        self.state: str = "DISCONNECTED"
        self.target_label: str = "Not Connected"
        self.capabilities: dict = {}
        self.last_metric: dict = {}
        self._ws_clients: set[WebSocket] = set()
        self._line_buf: str = ""
        self.term_history: deque[str] = deque(maxlen=150)
        self.xray_history: deque[dict] = deque(maxlen=40)
        self.activity_logs: deque[dict] = deque(maxlen=300)
        self.repl = MicroPythonReplEngine(
            get_transport=lambda: self.transport,
            lock=self.lock,
            on_xray=self._handle_xray,
        )
        self.log_event("INFO", "System", "Server Started", "ESP32 Console backend initialized and ready")

    def log_event(self, level: str, source: str, action: str, message: str, detail: Optional[str] = None) -> dict:
        now_dt = datetime.now()
        entry = {
            "id": len(self.activity_logs) + 1,
            "timestamp": now_dt.strftime("%H:%M:%S"),
            "level": level.upper(),
            "source": source,
            "action": action,
            "message": message,
            "detail": detail or "",
        }
        self.activity_logs.append(entry)

        # Write to persistent log file on disk
        try:
            line = f"[{now_dt.strftime('%Y-%m-%d %H:%M:%S')}] [{entry['level']}] [{entry['source']}] {entry['action']}: {entry['message']}"
            if entry["detail"]:
                line += f" | {entry['detail']}"
            with open(LOG_FILE_PATH, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass

        self._broadcast_sync({"type": "log", "data": entry})
        return entry

    def _broadcast_sync(self, payload: dict) -> None:
        if not self._ws_clients:
            return
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(payload))
        except RuntimeError:
            pass

    async def broadcast(self, payload: dict) -> None:
        dead = []
        txt = json.dumps(payload)
        for ws in list(self._ws_clients):
            try:
                await ws.send_text(txt)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._ws_clients.discard(ws)

    def _handle_xray(self, trace: dict) -> None:
        self.xray_history.append(trace)
        self._broadcast_sync({"type": "xray", "data": trace})

    def _set_state(self, new_state: str) -> None:
        if self.state != new_state:
            self.state = new_state
            self._broadcast_sync({"type": "state", "data": self.status_snapshot()})

    def status_snapshot(self) -> dict:
        return {
            "connected": bool(self.transport and self.transport.is_connected),
            "state": self.state,
            "transport": self.transport.transport_type if self.transport else None,
            "target": self.target_label,
            "capabilities": self.capabilities,
            "last_metric": self.last_metric,
        }

    def list_targets(self) -> dict:
        return {
            "ports": list_serial_ports(),
            "simulator": {
                "port": "SIMULATOR",
                "description": "Virtual Demo ESP32-S3 (Learn & Test Without Hardware)",
                "chip_hint": "Built-in MicroPython Simulator",
                "likely_esp32": True,
            },
            "status": self.status_snapshot(),
        }

    def _on_transport_bytes(self, data: bytes) -> None:
        self.repl.feed_bytes(data)

        # Avoid polluting visible terminal with Raw REPL internal frames while executing Raw REPL ops
        if self.repl._capturing:
            return

        text = data.decode("utf-8", "replace")
        self._line_buf += text

        # Process complete lines for @METRIC, prompt state, and crash alerts
        visible_chunks: list[str] = []
        while "\n" in self._line_buf:
            line, self._line_buf = self._line_buf.split("\n", 1)
            stripped = line.strip()
            if stripped.startswith("@METRIC:"):
                raw_json = stripped[len("@METRIC:"):].strip()
                try:
                    metric = json.loads(raw_json)
                    self.last_metric = metric
                    self._set_state("RUNNING_MAIN")
                    self._broadcast_sync({"type": "metric", "data": metric})
                    continue  # Hide raw @METRIC line from user terminal
                except Exception:
                    pass

            if "[main.py]" in stripped or "Running custom loop" in stripped:
                self._set_state("RUNNING_MAIN")
            elif "waiting for download" in stripped.lower():
                self._set_state("BOOTLOADER")

            alert = detect_log_alert(stripped)
            if alert:
                self._set_state("ERROR")
                self._broadcast_sync({"type": "alert", "data": alert})

            visible_chunks.append(line + "\n")

        # Handle partial prompt line like `>>> ` without trailing newline
        if self._line_buf.endswith(">>> "):
            self._set_state("IDLE_REPL")
            visible_chunks.append(self._line_buf)
            self._line_buf = ""
        elif len(self._line_buf) > 0 and "\r" not in self._line_buf:
            stripped_left = self._line_buf.lstrip()
            could_be_metric = stripped_left.startswith("@") and (
                (len(stripped_left) < 8 and "@METRIC:".startswith(stripped_left))
                or stripped_left.startswith("@METRIC:")
            )
            if not could_be_metric:
                # Flush interactive typed characters immediately for snappy REPL feel
                visible_chunks.append(self._line_buf)
                self._line_buf = ""

        if visible_chunks:
            out = "".join(visible_chunks)
            self.term_history.append(out)
            self._broadcast_sync({"type": "term", "data": out})

    def _on_transport_disconnect(self, reason: str) -> None:
        self.state = "DISCONNECTED"
        self.target_label = "Not Connected"
        self.capabilities = {}
        self.log_event("WARN", "Transport", "Disconnected", reason)
        self._broadcast_sync({"type": "alert", "data": {"severity": "warn", "title": "Device Disconnected", "summary": reason, "fix": "Check USB cable or Wi-Fi connection and click Connect again."}})
        self._broadcast_sync({"type": "state", "data": self.status_snapshot()})

    async def connect(self, mode: str, target: str = "", baudrate: int = 115200, password: str = "1234") -> dict:
        await self.disconnect()
        self._line_buf = ""
        if mode == "simulator" or target == "SIMULATOR":
            tr = SimulatorTransport(on_bytes=self._on_transport_bytes, on_disconnect=self._on_transport_disconnect)
            self._handle_xray({
                "action": "Connect Virtual Demo ESP32",
                "protocol": "In-Memory MicroPython Simulator",
                "code": "SimulatorTransport.connect() -> boots /boot.py -> runs /main.py",
                "explanation": "Starts a simulated ESP32-S3 with real Raw REPL, virtual flash files, RAM metrics, Wi-Fi scan, and GPIO/I2C.",
            })
        elif mode == "webrepl":
            tr = WebReplTransport(host=target, password=password, on_bytes=self._on_transport_bytes, on_disconnect=self._on_transport_disconnect)
            self._handle_xray({
                "action": f"Connect WebREPL ({target})",
                "protocol": "WebSocket ws://<ip>:8266",
                "code": f"websockets.connect('ws://{target}:8266') + password auth",
                "explanation": "Connects wirelessly to MicroPython's built-in WebREPL server over Wi-Fi so no USB cable is needed.",
            })
        else:
            tr = SerialTransport(port=target, baudrate=baudrate, on_bytes=self._on_transport_bytes, on_disconnect=self._on_transport_disconnect)
            self._handle_xray({
                "action": f"Connect USB Serial ({target} @ {baudrate})",
                "protocol": "UART Serial (Safe DTR=False, RTS=False)",
                "code": f"serial.Serial(port={target!r}, baudrate={baudrate}, dtr=False, rts=False)",
                "explanation": "Opens the USB-UART connection with DTR/RTS disabled so your ESP32 doesn't accidentally reboot when the console opens.",
            })

        try:
            info = await tr.connect()
            self.transport = tr
            self.target_label = info["target"]
            self.capabilities = info["capabilities"]
            self.state = "CONNECTED"
            self.log_event("SUCCESS", "Serial" if mode != "webrepl" else "WebREPL", "Connected", f"Connected to {self.target_label}")
            await self.broadcast({"type": "state", "data": self.status_snapshot()})
            return self.status_snapshot()
        except Exception as exc:
            self.log_event("ERROR", "Transport", "Connection Failed", str(exc))
            raise

    async def disconnect(self) -> dict:
        if self.transport:
            try:
                await self.transport.disconnect()
            except Exception:
                pass
            self.transport = None
            self.log_event("INFO", "Transport", "Disconnected", f"Closed connection to {self.target_label}")
        self.state = "DISCONNECTED"
        self.target_label = "Not Connected"
        self.capabilities = {}
        self.last_metric = {}
        await self.broadcast({"type": "state", "data": self.status_snapshot()})
        return self.status_snapshot()

    async def send_terminal_text(self, text: str) -> None:
        if not self.transport or not self.transport.is_connected:
            raise RuntimeError("Connect to an ESP32 (or Virtual Demo ESP32) first.")
        async with self.lock:
            await self.transport.write(text.encode("utf-8"))

    async def release_serial_if_busy(self, port: str) -> bool:
        """Temporarily disconnect if serial transport currently holds `port` (required before esptool)."""
        if isinstance(self.transport, SerialTransport) and self.transport.port == port and self.transport.is_connected:
            await self.disconnect()
            await asyncio.sleep(0.2)
            return True
        return False

