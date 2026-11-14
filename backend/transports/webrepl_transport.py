"""MicroPython WebREPL (ws://<ip>:8266) wireless transport."""

import asyncio
from typing import Callable, Optional

import websockets

from .base import DeviceTransport


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
        self._ws = await websockets.connect(self.url, open_timeout=6, ping_interval=20, ping_timeout=10)
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
                data = msg if isinstance(msg, bytes) else msg.encode("utf-8", "ignore")
                if data and self.on_bytes:
                    self.on_bytes(data)
        except asyncio.CancelledError:
            return
        except Exception as exc:
            self._connected = False
            if self.on_disconnect:
                self.on_disconnect(f"WebREPL connection closed: {exc}")

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
        # MicroPython WebREPL expects UTF-8 text frames for REPL/Raw-REPL commands
        await self._ws.send(data.decode("utf-8", "replace"))

