import asyncio
import struct
from typing import Callable, Optional

import websockets

from .base import DeviceTransport

WEBREPL_REQ_S = "<2sBBQLH64s"
WEBREPL_PUT_FILE = 1
WEBREPL_GET_FILE = 2
WEBREPL_GET_VER = 3


class WebReplTransport(DeviceTransport):
    """Wireless WebSocket transport compatible with MicroPython's built-in WebREPL."""

    transport_type = "webrepl"

    def __init__(
        self,
        host: str,
        port: int = 8266,
        password: str = "1234",
        on_bytes: Optional[Callable[[bytes], None]] = None,
        on_disconnect: Optional[Callable[[str], None]] = None,
    ):
        super().__init__(on_bytes=on_bytes, on_disconnect=on_disconnect)
        self.host = host.replace("ws://", "").replace("wss://", "").split("/")[0].strip()
        if ":" in self.host:
            h, p = self.host.rsplit(":", 1)
            self.host = h
            if p.isdigit():
                port = int(p)
        self.port = port
        self.password = password
        self._ws = None
        self._recv_task: Optional[asyncio.Task] = None
        self._bin_queue: asyncio.Queue[bytes] = asyncio.Queue()

    @property
    def url(self) -> str:
        return f"ws://{self.host}:{self.port}"

    @property
    def capabilities(self) -> dict:
        return {
            "repl": True,
            "files": True,
            "hard_reset": False,
            "bootloader": False,
            "flash": False,
            "wireless": True,
        }

    async def connect(self) -> dict:
        self._ws = await websockets.connect(
            self.url,
            open_timeout=8,
            ping_interval=None,
            ping_timeout=None,
            max_size=10 * 1024 * 1024,
        )
        # Perform WebREPL password handshake
        banner = ""
        deadline = asyncio.get_running_loop().time() + 5.0
        while asyncio.get_running_loop().time() < deadline:
            msg = await asyncio.wait_for(self._ws.recv(), timeout=4.0)
            chunk = msg.decode("utf-8", "ignore") if isinstance(msg, bytes) else str(msg)
            banner += chunk
            if "Password:" in banner:
                await self._ws.send(self.password + "\r\n")
                break
        # Read auth confirmation
        auth_buf = ""
        deadline = asyncio.get_running_loop().time() + 4.0
        while asyncio.get_running_loop().time() < deadline:
            msg = await asyncio.wait_for(self._ws.recv(), timeout=3.0)
            chunk = msg.decode("utf-8", "ignore") if isinstance(msg, bytes) else str(msg)
            auth_buf += chunk
            if "WebREPL connected" in auth_buf or ">>>" in auth_buf:
                break
            if "Access denied" in auth_buf:
                await self._ws.close()
                raise PermissionError("WebREPL Access denied: wrong password")

        self._connected = True
        self._recv_task = asyncio.create_task(self._recv_loop(), name="esp32-webrepl-recv")
        return {
            "transport": "webrepl",
            "target": self.url,
            "capabilities": self.capabilities,
        }

    async def _recv_loop(self) -> None:
        try:
            async for msg in self._ws:
                if isinstance(msg, bytes):
                    await self._bin_queue.put(msg)
                else:
                    data = msg.encode("utf-8", "ignore")
                    if data and self.on_bytes:
                        self.on_bytes(data)
        except asyncio.CancelledError:
            return
        except Exception as exc:
            self._connected = False
            if self.on_disconnect:
                self.on_disconnect(f"WebREPL connection closed: {exc}")
            return
        self._connected = False
        if self.on_disconnect:
            self.on_disconnect("WebREPL connection closed by ESP32")

    async def disconnect(self) -> None:
        self._connected = False
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except Exception:
                pass
            self._recv_task = None
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

    async def write(self, data: bytes) -> None:
        if not self._ws or not self._connected:
            raise RuntimeError("WebREPL is not connected")
        try:
            # MicroPython WebREPL expects UTF-8 text frames for REPL/Raw-REPL commands
            await self._ws.send(data.decode("utf-8", "replace"))
        except Exception as exc:
            self._connected = False
            if self.on_disconnect:
                self.on_disconnect(f"WebREPL write failed: {exc}")
            raise

    async def put_file(self, remote_file: str, data: bytes) -> bool:
        """Transfers a file using official MicroPython WebREPL binary framing (WEBREPL_PUT_FILE)."""
        if not self._ws or not self._connected:
            raise RuntimeError("WebREPL is not connected")
        sz = len(data)
        dest_fname = remote_file.encode("utf-8")
        rec = struct.pack(WEBREPL_REQ_S, b"WA", WEBREPL_PUT_FILE, 0, 0, sz, len(dest_fname), dest_fname)
        await self._ws.send(rec[:10])
        await self._ws.send(rec[10:])

        resp = await asyncio.wait_for(self._bin_queue.get(), timeout=5.0)
        sig, code = struct.unpack("<2sH", resp[:4])
        if sig != b"WB" or code != 0:
            raise RuntimeError(f"WebREPL PUT rejected: sig={sig!r}, code={code}")

        chunk_size = 1024
        for i in range(0, sz, chunk_size):
            await self._ws.send(data[i : i + chunk_size])

        final_resp = await asyncio.wait_for(self._bin_queue.get(), timeout=10.0)
        sig, code = struct.unpack("<2sH", final_resp[:4])
        if sig != b"WB" or code != 0:
            raise RuntimeError(f"WebREPL PUT confirmation failed: sig={sig!r}, code={code}")
        return True

    async def get_file(self, remote_file: str) -> bytes:
        """Retrieves a file using official MicroPython WebREPL binary framing (WEBREPL_GET_FILE)."""
        if not self._ws or not self._connected:
            raise RuntimeError("WebREPL is not connected")
        src_fname = remote_file.encode("utf-8")
        rec = struct.pack(WEBREPL_REQ_S, b"WA", WEBREPL_GET_FILE, 0, 0, 0, len(src_fname), src_fname)
        await self._ws.send(rec)

        resp = await asyncio.wait_for(self._bin_queue.get(), timeout=5.0)
        sig, code = struct.unpack("<2sH", resp[:4])
        if sig != b"WB" or code != 0:
            raise RuntimeError(f"WebREPL GET rejected: sig={sig!r}, code={code}")

        out = bytearray()
        while True:
            await self._ws.send(b"\0")
            chunk = await asyncio.wait_for(self._bin_queue.get(), timeout=5.0)
            if len(chunk) < 2:
                break
            sz = struct.unpack("<H", chunk[:2])[0]
            if sz == 0:
                break
            out.extend(chunk[2 : 2 + sz])

        final_resp = await asyncio.wait_for(self._bin_queue.get(), timeout=5.0)
        return bytes(out)

