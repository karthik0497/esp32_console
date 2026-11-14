"""Support for other languages (Arduino/C++, PlatformIO, ESP-IDF, .mpy bytecode, and wireless OTA)."""

import asyncio
import hashlib
import os
import shutil
import socket
import urllib.request
from pathlib import Path
from typing import Callable, Optional


def detect_toolchains() -> dict:
    """Detect optional external language toolchains installed on the host PC."""
    return {
        "esptool": True,  # Bundled in .venv
        "mpremote": True,  # Bundled in .venv
        "arduino_cli": shutil.which("arduino-cli"),
        "platformio": shutil.which("pio") or shutil.which("platformio"),
        "idf_py": shutil.which("idf.py"),
        "mpy_cross": shutil.which("mpy-cross"),
    }


def inspect_project_dir(project_dir: str) -> dict:
    p = Path(project_dir).expanduser()
    if not p.exists() or not p.is_dir():
        raise FileNotFoundError(f"Directory does not exist: {project_dir}")

    detected = []
    if (p / "platformio.ini").exists():
        detected.append("platformio")
    if (p / "CMakeLists.txt").exists() and ((p / "sdkconfig").exists() or (p / "main").is_dir()):
        detected.append("esp-idf")
    if list(p.glob("*.ino")):
        detected.append("arduino")
    if list(p.glob("*.py")):
        detected.append("micropython")

    bins = [str(f) for f in sorted(p.rglob("*.bin"))[:20]]
    return {
        "path": str(p),
        "frameworks": detected or ["unknown"],
        "bin_files": bins,
    }


async def build_local_project(
    project_dir: str,
    framework: str,
    fqbn: str = "esp32:esp32:esp32",
    on_xray: Optional[Callable[[dict], None]] = None,
) -> dict:
    """Compile an Arduino, PlatformIO, or ESP-IDF project using local CLI tools."""
    p = Path(project_dir).expanduser()
    if not p.is_dir():
        raise FileNotFoundError(f"Project folder not found: {project_dir}")

    if framework == "arduino":
        exe = shutil.which("arduino-cli")
        if not exe:
            raise RuntimeError("`arduino-cli` is not installed on this machine. Export a compiled `.bin` from Arduino IDE and flash it in the Flash tab!")
        out_dir = p / "build_console"
        out_dir.mkdir(exist_ok=True)
        cmd = [exe, "compile", "--fqbn", fqbn, "--output-dir", str(out_dir), str(p)]
    elif framework == "platformio":
        exe = shutil.which("pio") or shutil.which("platformio")
        if not exe:
            raise RuntimeError("`pio` (PlatformIO CLI) is not installed on this machine. You can still upload PlatformIO `.pio/build/*/firmware.bin` files directly!")
        cmd = [exe, "run", "-d", str(p)]
    elif framework == "esp-idf":
        exe = shutil.which("idf.py")
        if not exe:
            raise RuntimeError("`idf.py` is not in PATH. Run inside an ESP-IDF shell or upload the compiled `build/*.bin` files directly.")
        cmd = [exe, "-C", str(p), "build"]
    else:
        raise ValueError(f"Unsupported build framework: {framework}")

    if on_xray:
        on_xray({
            "action": f"Compile {framework} Project",
            "protocol": "Local Toolchain Build",
            "code": " ".join(cmd),
            "explanation": f"Invokes your installed `{framework}` compiler to produce flashable `.bin` firmware files.",
        })

    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out_bytes, _ = await proc.communicate()
    log = out_bytes.decode("utf-8", "replace")
    if proc.returncode != 0:
        raise RuntimeError(f"Build failed (exit {proc.returncode}):\n{log}")

    bins = [str(f) for f in sorted(p.rglob("*.bin"))[:15]]
    return {"success": True, "log": log, "bin_files": bins}


async def http_ota_upload(url: str, bin_bytes: bytes, filename: str = "firmware.bin", on_xray: Optional[Callable[[dict], None]] = None) -> dict:
    """Push a compiled .bin file wirelessly to an ESP32 running an HTTP OTA endpoint (e.g. AsyncElegantOTA / ESP32 HTTPUpdateServer)."""
    if not url.startswith(("http://", "https://")):
        url = "http://" + url

    if on_xray:
        on_xray({
            "action": f"Wireless HTTP OTA Upload -> {url}",
            "protocol": "HTTP Multipart POST",
            "code": f"POST {url} (Content-Type: multipart/form-data; file={filename}, {len(bin_bytes)} bytes)",
            "explanation": "Sends a compiled C++/Arduino/ESP-IDF `.bin` firmware directly to the ESP32 over Wi-Fi so it flashes the next OTA partition and reboots.",
        })

    boundary = "----ESP32ConsoleOTABoundary987654"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="update"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8") + bin_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    def _post():
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")

    status, resp_text = await asyncio.to_thread(_post)
    return {"status": status, "response": resp_text}


async def arduino_ota_upload(
    esp_ip: str,
    esp_port: int,
    bin_bytes: bytes,
    password: str = "",
    on_xray: Optional[Callable[[dict], None]] = None,
) -> dict:
    """Lightweight pure-Python ArduinoOTA (`espota`) client for updating C++/Arduino ESP32s over Wi-Fi."""
    if on_xray:
        on_xray({
            "action": f"Wireless ArduinoOTA -> {esp_ip}:{esp_port}",
            "protocol": "ArduinoOTA (UDP Invite + TCP Stream)",
            "code": f"UDP {esp_ip}:{esp_port} -> AUTH -> TCP stream {len(bin_bytes)} bytes (MD5 {hashlib.md5(bin_bytes).hexdigest()[:10]}...)",
            "explanation": "Uses ArduinoOTA's UDP invitation + TCP binary transfer protocol to update C++/Arduino firmware wirelessly.",
        })

    def _sync_ota():
        file_md5 = hashlib.md5(bin_bytes).hexdigest()
        size = len(bin_bytes)
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.settimeout(15)
        srv.bind(("0.0.0.0", 0))
        local_port = srv.getsockname()[1]
        srv.listen(1)

        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.settimeout(8)
        try:
            invite = f"0 {local_port} {size} {file_md5}\n".encode("utf-8")
            udp.sendto(invite, (esp_ip, int(esp_port)))
            resp, _ = udp.recvfrom(512)
            msg = resp.decode("utf-8", "ignore").strip()
            if msg.startswith("AUTH "):
                nonce = msg.split(" ", 1)[1].strip()
                cnonce = hashlib.md5(os.urandom(16)).hexdigest()
                pw_md5 = hashlib.md5(password.encode("utf-8")).hexdigest()
                challenge = hashlib.md5(f"{pw_md5}:{nonce}:{cnonce}".encode("utf-8")).hexdigest()
                udp.sendto(f"200 {cnonce} {challenge}\n".encode("utf-8"), (esp_ip, int(esp_port)))
                resp2, _ = udp.recvfrom(512)
                msg = resp2.decode("utf-8", "ignore").strip()
            if not msg.startswith("OK"):
                raise RuntimeError(f"ArduinoOTA rejected request: {msg}")

            conn, _ = srv.accept()
            with conn:
                conn.settimeout(20)
                for i in range(0, size, 1460):
                    conn.sendall(bin_bytes[i : i + 1460])
                ack = conn.recv(256).decode("utf-8", "ignore").strip()
                return {"ok": True, "ack": ack or "OK"}
        finally:
            udp.close()
            srv.close()

    return await asyncio.to_thread(_sync_ota)
