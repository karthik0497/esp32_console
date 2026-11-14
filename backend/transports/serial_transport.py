"""USB Serial (UART / Native CDC) transport with safe DTR/RTS management."""

import asyncio
import threading
import time
from typing import Callable, Optional

import serial
import serial.tools.list_ports

from .base import DeviceTransport

KNOWN_ESP_USB = {
    (0x10C4, 0xEA60): "Silicon Labs CP210x (ESP32 DevKit)",
    (0x1A86, 0x7523): "WCH CH340 (ESP32 Clone / NodeMCU)",
    (0x1A86, 0x55D4): "WCH CH9102 (ESP32-S2/S3/C3 DevKit)",
    (0x0403, 0x6001): "FTDI FT232R UART",
    (0x303A, 0x1001): "Espressif Native USB JTAG/Serial",
    (0x303A, 0x0002): "Espressif ESP32-S2 Native USB",
    (0x303A, 0x4001): "Espressif ESP32-S3/C3 MicroPython USB",
}


def list_serial_ports() -> list[dict]:
    """Return available serial ports enriched with ESP32 hardware hints."""
    ports = []
    for p in serial.tools.list_ports.comports():
        vid_pid = (p.vid, p.pid) if p.vid is not None and p.pid is not None else None
        chip_hint = KNOWN_ESP_USB.get(vid_pid, "") if vid_pid else ""
        is_likely_esp = bool(chip_hint) or any(
            k in (p.description or "").lower()
            for k in ("cp210", "ch340", "ch910", "espressif", "esp32", "usb serial", "uart")
        )
        ports.append(
            {
                "port": p.device,
                "description": p.description or p.device,
                "hwid": p.hwid or "",
                "vid": f"0x{p.vid:04X}" if p.vid is not None else None,
                "pid": f"0x{p.pid:04X}" if p.pid is not None else None,
                "chip_hint": chip_hint or ("Likely USB-UART Adapter" if is_likely_esp else "Serial Port"),
                "likely_esp32": is_likely_esp,
            }
        )
    # Put likely ESP32 ports first
    ports.sort(key=lambda item: (not item["likely_esp32"], item["port"]))
    return ports


class SerialTransport(DeviceTransport):
    """Thread-backed pyserial transport safe against accidental DTR/RTS resets."""

    transport_type = "serial"

    def __init__(
        self,
        port: str,
        baudrate: int = 115200,
        on_bytes: Optional[Callable[[bytes], None]] = None,
        on_disconnect: Optional[Callable[[str], None]] = None,
    ):
        super().__init__(on_bytes=on_bytes, on_disconnect=on_disconnect)
        self.port = port
        self.baudrate = baudrate
        self._ser: Optional[serial.Serial] = None
        self._stop_event = threading.Event()
        self._reader_thread: Optional[threading.Thread] = None
        self._write_lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    @property
    def capabilities(self) -> dict:
        return {
            "repl": True,
            "files": True,
            "hard_reset": True,
            "bootloader": True,
            "flash": True,
            "wireless": False,
        }

    async def connect(self) -> dict:
        self._loop = asyncio.get_running_loop()
        ser = serial.Serial()
        ser.port = self.port
        ser.baudrate = self.baudrate
        ser.timeout = 0.05
        ser.write_timeout = 2.0
        # Crucial: prevent DTR/RTS from pulsing EN/IO0 and rebooting running code on open!
        ser.dtr = False
        ser.rts = False
        try:
            ser.open()
        except PermissionError as exc:
            raise PermissionError(
                f"Cannot open {self.port} (Permission denied / Port busy). "
                "On Linux run: `sudo usermod -aG dialout $USER` then re-login. "
                "On Windows/Linux, make sure Arduino IDE, Thonny, or PuTTY is not already using this port."
            ) from exc
        except serial.SerialException as exc:
            raise RuntimeError(
                f"Failed to open {self.port}: {exc}. Unplug and replug your USB data cable, then click Refresh."
            ) from exc
        ser.dtr = False
        ser.rts = False
        self._ser = ser
        self._connected = True
        self._stop_event.clear()

        self._reader_thread = threading.Thread(target=self._read_loop, daemon=True, name="esp32-serial-reader")
        self._reader_thread.start()
        return {
            "transport": "serial",
            "target": self.port,
            "baudrate": self.baudrate,
            "capabilities": self.capabilities,
        }

    def _read_loop(self) -> None:
        while not self._stop_event.is_set() and self._ser and self._ser.is_open:
            try:
                waiting = self._ser.in_waiting
                data = self._ser.read(waiting if waiting > 0 else 1)
                if data and self.on_bytes and self._loop:
                    self._loop.call_soon_threadsafe(self.on_bytes, data)
            except Exception as exc:
                if not self._stop_event.is_set():
                    self._connected = False
                    if self.on_disconnect and self._loop:
                        self._loop.call_soon_threadsafe(self.on_disconnect, f"Serial disconnected: {exc}")
                break

    async def disconnect(self) -> None:
        self._stop_event.set()
        self._connected = False
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=0.5)
        if self._ser:
            try:
                if self._ser.is_open:
                    self._ser.close()
            except Exception:
                pass
            self._ser = None

    async def write(self, data: bytes) -> None:
        if not self._ser or not self._ser.is_open:
            raise RuntimeError("Serial port is not open")

        def _sync_write():
            with self._write_lock:
                self._ser.write(data)
                self._ser.flush()

        await asyncio.to_thread(_sync_write)

    async def hard_reset(self) -> bool:
        if not self._ser or not self._ser.is_open:
            return False

        def _pulse():
            with self._write_lock:
                self._ser.dtr = False
                self._ser.rts = True
                time.sleep(0.12)
                self._ser.rts = False

        await asyncio.to_thread(_pulse)
        return True

    async def enter_bootloader(self) -> bool:
        if not self._ser or not self._ser.is_open:
            return False

        def _seq():
            with self._write_lock:
                # Standard Espressif auto-bootloader DTR/RTS sequence
                self._ser.dtr = False
                self._ser.rts = True
                time.sleep(0.1)
                self._ser.dtr = True
                self._ser.rts = False
                time.sleep(0.05)
                self._ser.dtr = False

        await asyncio.to_thread(_seq)
        return True

