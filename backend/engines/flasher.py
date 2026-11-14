"""esptool-powered firmware flasher with real-time progress streaming & simulator practice mode."""

import asyncio
import re
import sys
from typing import Callable, Optional


async def _run_esptool_stream(args: list[str], on_line: Optional[Callable[[str, Optional[int]], None]] = None) -> tuple[int, str]:
    cmd = [sys.executable, "-m", "esptool", *args]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    lines = []
    assert proc.stdout is not None
    while True:
        raw = await proc.stdout.readline()
        if not raw:
            break
        line = raw.decode("utf-8", "replace").rstrip("\r\n")
        lines.append(line)
        pct_match = re.search(r"\((\d+)\s*%\)", line)
        pct = int(pct_match.group(1)) if pct_match else None
        if on_line:
            on_line(line, pct)
    rc = await proc.wait()
    return rc, "\n".join(lines)


async def probe_chip(port: str, baud: int = 115200, on_xray: Optional[Callable[[dict], None]] = None) -> dict:
    if port == "SIMULATOR":
        if on_xray:
            on_xray({
                "action": "Probe Chip Info (Simulated)",
                "protocol": "esptool (ROM Bootloader)",
                "code": "python -m esptool --port SIMULATOR chip_id && esptool flash_id",
                "explanation": "Connects to the ESP32 ROM bootloader to read chip silicon type, MAC address, crystal frequency, and SPI flash chip capacity.",
            })
        return {
            "simulated": True,
            "chip": "ESP32-S3 (QFN56) (revision v0.2)",
            "mac": "24:6f:28:ab:cd:ef",
            "flash_size": "8MB",
            "crystal": "40MHz",
            "raw_log": "Connecting....\nDetecting chip type... ESP32-S3\nChip is ESP32-S3 (QFN56)\nMAC: 24:6f:28:ab:cd:ef\nDetected flash size: 8MB",
        }

    args = ["--port", port, "--baud", str(baud), "flash_id"]
    if on_xray:
        on_xray({
            "action": f"Probe Chip on {port}",
            "protocol": "esptool (ROM Bootloader)",
            "code": f"python -m esptool {' '.join(args)}",
            "explanation": "Sends sync frames to the ESP32 ROM bootloader to identify exact chip model, MAC address, and flash memory size.",
        })
    rc, output = await _run_esptool_stream(args)
    if rc != 0:
        raise RuntimeError(f"esptool probe failed (try holding BOOT button while clicking Probe):\n{output}")

    chip = re.search(r"Chip is\s+([^\r\n]+)", output)
    mac = re.search(r"MAC:\s+([0-9a-fA-F:]+)", output)
    flash = re.search(r"Detected flash size:\s+([^\r\n]+)", output)
    crystal = re.search(r"Crystal is\s+([^\r\n]+)", output)
    return {
        "simulated": False,
        "chip": chip.group(1).strip() if chip else "ESP32",
        "mac": mac.group(1).strip() if mac else "Unknown",
        "flash_size": flash.group(1).strip() if flash else "Unknown",
        "crystal": crystal.group(1).strip() if crystal else "40MHz",
        "raw_log": output,
    }


async def erase_flash(
    port: str,
    baud: int = 460800,
    on_progress: Optional[Callable[[str, Optional[int]], None]] = None,
    on_xray: Optional[Callable[[dict], None]] = None,
) -> str:
    if port == "SIMULATOR":
        if on_xray:
            on_xray({
                "action": "Erase Flash (Simulated)",
                "protocol": "esptool erase_flash",
                "code": "python -m esptool --port SIMULATOR erase_flash",
                "explanation": "Wipes all existing firmware, MicroPython files, and Wi-Fi settings cleanly before a fresh firmware install.",
            })
        for step, msg in [(25, "Connecting...."), (60, "Erasing flash (this may take a while)..."), (100, "Chip erase completed successfully in 2.1s (Simulated)")]:
            if on_progress:
                on_progress(msg, step)
            await asyncio.sleep(0.35)
        return "Simulated erase completed."

    args = ["--port", port, "--baud", str(baud), "erase_flash"]
    if on_xray:
        on_xray({
            "action": f"Erase Flash on {port}",
            "protocol": "esptool erase_flash",
            "code": f"python -m esptool {' '.join(args)}",
            "explanation": "Wipes the ESP32 SPI flash memory clean so old partitions or broken code won't conflict with new firmware.",
        })
    rc, output = await _run_esptool_stream(args, on_line=on_progress)
    if rc != 0:
        raise RuntimeError(f"Erase flash failed:\n{output}")
    return output


async def write_flash_bins(
    port: str,
    entries: list[tuple[str, str]],
    chip: str = "auto",
    baud: int = 460800,
    erase_first: bool = False,
    on_progress: Optional[Callable[[str, Optional[int]], None]] = None,
    on_xray: Optional[Callable[[dict], None]] = None,
) -> str:
    """Flash one or multiple (offset, file_path) .bin pairs using esptool."""
    if not entries:
        raise ValueError("At least one .bin file and flash offset is required.")

    flat_pairs: list[str] = []
    for offset, path in entries:
        flat_pairs.extend([offset.strip(), path])

    if port == "SIMULATOR":
        cmd_str = f"python -m esptool --chip {chip} --port SIMULATOR --baud {baud} write_flash " + ("-e " if erase_first else "") + " ".join(flat_pairs)
        if on_xray:
            on_xray({
                "action": "Practice Firmware Flash (Simulated)",
                "protocol": "esptool write_flash",
                "code": cmd_str,
                "explanation": "Writes compiled firmware .bin bytes into the ESP32 flash memory starting at exact hex offsets (like 0x1000 for MicroPython or 0x10000 for C++ app).",
            })
        stages = [
            (10, "Connecting to simulated ESP32 ROM bootloader..."),
            (25, "Configuring flash size... Auto-detected 8MB"),
            (45, f"Writing at {entries[0][0]}... (45 %)"),
            (75, f"Writing at {entries[0][0]}... (75 %)"),
            (95, "Hash of data verified."),
            (100, "Hard resetting via RTS pin... Done! (Simulated)"),
        ]
        for pct, msg in stages:
            if on_progress:
                on_progress(msg, pct)
            await asyncio.sleep(0.35)
        return "Simulated firmware flash complete."

    args = ["--chip", chip, "--port", port, "--baud", str(baud), "write_flash"]
    if erase_first:
        args.append("-e")
    args.extend(flat_pairs)

    if on_xray:
        on_xray({
            "action": f"Flash Firmware to {port}",
            "protocol": "esptool write_flash",
            "code": f"python -m esptool {' '.join(args)}",
            "explanation": "Transfers binary firmware into SPI flash at the specified memory offsets and verifies the SHA-256 hash afterward.",
        })
    rc, output = await _run_esptool_stream(args, on_line=on_progress)
    if rc != 0:
        raise RuntimeError(f"Flashing failed (check BOOT button & cable):\n{output}")
    return output

