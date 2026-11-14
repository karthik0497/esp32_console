"""Abstract base interface for ESP32 device transports."""

from abc import ABC, abstractmethod
from typing import Callable, Optional


class DeviceTransport(ABC):
    """Unified byte-stream + hardware control transport for USB Serial, WebREPL, or Simulator."""

    transport_type: str = "base"

    def __init__(self, on_bytes: Optional[Callable[[bytes], None]] = None, on_disconnect: Optional[Callable[[str], None]] = None):
        self.on_bytes = on_bytes
        self.on_disconnect = on_disconnect
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def capabilities(self) -> dict:
        return {
            "repl": True,
            "files": True,
            "hard_reset": False,
            "bootloader": False,
            "flash": False,
            "wireless": False,
        }

    @abstractmethod
    async def connect(self) -> dict:
        """Open transport connection and return initial connection metadata."""

    @abstractmethod
    async def disconnect(self) -> None:
        """Close transport connection cleanly."""

    @abstractmethod
    async def write(self, data: bytes) -> None:
        """Send raw bytes to the device."""

    async def hard_reset(self) -> bool:
        """Trigger hardware EN/RST reset if supported by transport."""
        return False

    async def enter_bootloader(self) -> bool:
        """Trigger DTR/RTS bootloader entry if supported by transport."""
        return False

