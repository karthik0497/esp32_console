"""FastAPI local server for the ESP32 Active-Learning Web Console."""

import json
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.device_manager import DeviceManager
from backend.engines import crash_decoder, firmware_updater, flasher
from backend.helpers.wifi_ap_fallback import WIFI_MANAGER_MPY

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
DOCS_DIR = BASE_DIR / "docs"
HELPERS_DIR = BASE_DIR / "backend" / "helpers"

app = FastAPI(title="ESP32 Active-Learning Local Console", version="1.0.0")
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

dm = DeviceManager()


class ConnectReq(BaseModel):
    mode: str = "serial"  # serial | webrepl | simulator
    target: str = ""
    baudrate: int = 115200
    password: str = "1234"


class SaveFileReq(BaseModel):
    path: str
    content: str


class PathReq(BaseModel):
    path: str


class RenameReq(BaseModel):
    old_path: str
    new_path: str


class FreqReq(BaseModel):
    mhz: int


class WifiConnectReq(BaseModel):
    ssid: str
    password: str = ""
    save_config: bool = True
    install_ap_fallback: bool = False


class WifiApReq(BaseModel):
    ssid: str = "ESP32-Setup"
    password: str = "12345678"


class WebReplSetupReq(BaseModel):
    password: str = "1234"


class InitialWirelessSetupReq(BaseModel):
    ssid: str
    wifi_password: str = ""
    webrepl_password: str = "1234"
    install_ap_fallback: bool = True


class I2CScanReq(BaseModel):
    scl: int = 22
    sda: int = 21


class GpioReq(BaseModel):
    pin: int = 2
    action: str = "toggle"


class ProbeReq(BaseModel):
    port: str
    baud: int = 115200


class EraseReq(BaseModel):
    port: str
    baud: int = 460800


class FlashLocalEntry(BaseModel):
    offset: str = "0x10000"
    path: str


class FlashLocalReq(BaseModel):
    port: str
    chip: str = "auto"
    baud: int = 460800
    erase_first: bool = False
    entries: list[FlashLocalEntry]


class ToolchainInspectReq(BaseModel):
    project_dir: str


class ToolchainBuildReq(BaseModel):
    project_dir: str
    framework: str
    fqbn: str = "esp32:esp32:esp32"


class CrashDecodeReq(BaseModel):
    log_text: str
    elf_path: Optional[str] = None


# -------------------- Pages & Guide --------------------

@app.get("/")
async def index_page():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/guide")
async def guide_page():
    return FileResponse(str(FRONTEND_DIR / "guide.html"))


@app.get("/api/guide-md")
async def get_guide_markdown(download: int = 0):
    guide_path = DOCS_DIR / "GUIDE.md"
    if not guide_path.exists():
        raise HTTPException(status_code=404, detail="GUIDE.md not found")
    content = guide_path.read_text(encoding="utf-8")
    if download:
        return Response(
            content=content,
            media_type="text/markdown",
            headers={"Content-Disposition": 'attachment; filename="ESP32_Console_Child_Friendly_Guide.md"'},
        )
    return PlainTextResponse(content, media_type="text/markdown; charset=utf-8")


# -------------------- Connection & Control --------------------

@app.get("/api/ports")
async def get_ports():
    return dm.list_targets()


@app.post("/api/connect")
async def connect_device(req: ConnectReq):
    try:
        return await dm.connect(mode=req.mode, target=req.target, baudrate=req.baudrate, password=req.password)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/disconnect")
async def disconnect_device():
    return await dm.disconnect()


@app.post("/api/control/{action}")
async def control_device(action: str):
    try:
        if action == "interrupt":
            await dm.repl.interrupt(aggressive=False)
        elif action == "aggressive_interrupt":
            await dm.repl.interrupt(aggressive=True)
        elif action == "soft_reset":
            await dm.repl.soft_reset()
        elif action == "hard_reset":
            if not dm.transport or not dm.transport.capabilities.get("hard_reset"):
                raise RuntimeError("Hard Reset requires USB Serial (or Simulator) connection.")
            dm._handle_xray({
                "action": "Hard Reset (RTS/EN Pulse)",
                "protocol": "Hardware UART Control Pin",
                "code": "ser.rts = True -> sleep(120ms) -> ser.rts = False",
                "explanation": "Temporarily pulls the ESP32 EN (Reset) pin LOW just like pressing the physical RST button on the board.",
            })
            await dm.transport.hard_reset()
        elif action == "enter_bootloader":
            if not dm.transport or not dm.transport.capabilities.get("bootloader"):
                raise RuntimeError("Bootloader entry requires USB Serial (or Simulator).")
            dm._handle_xray({
                "action": "Enter ROM Bootloader",
                "protocol": "DTR/RTS Auto-Flash Sequence",
                "code": "Toggle IO0 (DTR) + EN (RTS)",
                "explanation": "Puts the ESP32 into firmware download mode (`waiting for download`) so esptool can flash .bin files.",
            })
            await dm.transport.enter_bootloader()
        elif action == "safe_recovery":
            return await dm.repl.safe_recovery(disable_main=False)
        elif action == "safe_recovery_disable_main":
            return await dm.repl.safe_recovery(disable_main=True)
        else:
            raise ValueError(f"Unknown control action: {action}")
        return {"ok": True, "action": action}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -------------------- MicroPython Filesystem --------------------

@app.get("/api/files")
async def list_files(path: str = "/"):
    try:
        return {"files": await dm.repl.list_files(path)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/file")
async def read_file(path: str = Query(...)):
    try:
        raw = await dm.repl.read_file(path)
        try:
            text = raw.decode("utf-8")
            is_binary = False
        except UnicodeDecodeError:
            text = ""
            is_binary = True
        return {"path": path, "size": len(raw), "is_binary": is_binary, "content": text}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/file")
async def save_file(req: SaveFileReq):
    try:
        await dm.repl.write_file(req.path, req.content.encode("utf-8"))
        return {"ok": True, "path": req.path}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/upload")
async def upload_files(
    target_dir: str = Form("/"),
    files: list[UploadFile] = File(...),
):
    try:
        uploaded = []
        base = "/" if target_dir in ("", "/") else "/" + target_dir.strip("/")
        for f in files:
            raw = await f.read()
            rel_name = (f.filename or "uploaded.py").lstrip("/")
            dest = f"/{rel_name}" if base == "/" else f"{base}/{rel_name}"
            await dm.repl.write_file(dest, raw)
            uploaded.append({"path": dest, "size": len(raw)})
        return {"ok": True, "uploaded": uploaded}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/api/file")
async def delete_file(path: str = Query(...)):
    try:
        await dm.repl.delete_path(path)
        return {"ok": True, "deleted": path}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/mkdir")
async def create_dir(req: PathReq):
    try:
        await dm.repl.mkdir(req.path)
        return {"ok": True, "path": req.path}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/rename")
async def rename_item(req: RenameReq):
    try:
        await dm.repl.rename_path(req.old_path, req.new_path)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/run-file")
async def run_file(req: PathReq):
    try:
        await dm.repl.run_file(req.path)
        return {"ok": True, "ran": req.path}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/make-main")
async def make_main(req: PathReq):
    try:
        await dm.repl.make_main(req.path)
        return {"ok": True, "source": req.path}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/backup-zip")
async def backup_zip():
    try:
        data = await dm.repl.backup_zip()
        return Response(
            content=data,
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="esp32_flash_backup.zip"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -------------------- System Metrics & Hardware Probes --------------------

@app.get("/api/metrics")
async def get_metrics():
    try:
        data = await dm.repl.get_metrics()
        dm.last_metric = data
        return data
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/health-checkup")
async def run_health_checkup():
    try:
        return await dm.repl.run_health_checkup()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/metrics/gc")
async def run_gc():
    try:
        return await dm.repl.run_gc()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/metrics/freq")
async def set_cpu_freq(req: FreqReq):
    try:
        return await dm.repl.set_cpu_freq(req.mhz)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/hardware/i2c-scan")
async def i2c_scan(req: I2CScanReq):
    try:
        return {"devices": await dm.repl.i2c_scan(scl=req.scl, sda=req.sda)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/hardware/gpio")
async def gpio_control(req: GpioReq):
    try:
        return await dm.repl.gpio_action(pin=req.pin, action=req.action)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -------------------- Wi-Fi & WebREPL --------------------

@app.get("/api/wifi/status")
async def wifi_status():
    try:
        return await dm.repl.wifi_status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/wifi/scan")
async def wifi_scan():
    try:
        return {"networks": await dm.repl.wifi_scan()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/wifi/connect")
async def wifi_connect(req: WifiConnectReq):
    try:
        return await dm.repl.wifi_connect(
            ssid=req.ssid,
            password=req.password,
            save_config=req.save_config,
            install_ap_fallback=req.install_ap_fallback,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/wifi/ap")
async def wifi_ap(req: WifiApReq):
    try:
        return await dm.repl.wifi_ap(ssid=req.ssid, password=req.password)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/webrepl/setup")
async def setup_webrepl(req: WebReplSetupReq):
    try:
        return await dm.repl.setup_webrepl(password=req.password)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/wifi/initial-setup")
async def initial_wireless_setup(req: InitialWirelessSetupReq):
    try:
        return await dm.repl.initial_wireless_setup(
            ssid=req.ssid,
            wifi_password=req.wifi_password,
            webrepl_password=req.webrepl_password,
            install_ap_fallback=req.install_ap_fallback,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -------------------- Flasher & Other Languages --------------------

@app.post("/api/flash/probe")
async def flash_probe(req: ProbeReq):
    try:
        await dm.release_serial_if_busy(req.port)
        return await flasher.probe_chip(port=req.port, baud=req.baud, on_xray=dm._handle_xray)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/flash/erase")
async def flash_erase(req: EraseReq):
    try:
        await dm.release_serial_if_busy(req.port)

        def on_prog(line: str, pct: Optional[int]):
            dm._broadcast_sync({"type": "flash", "data": {"line": line, "pct": pct}})

        out = await flasher.erase_flash(port=req.port, baud=req.baud, on_progress=on_prog, on_xray=dm._handle_xray)
        return {"ok": True, "log": out}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/flash/write")
async def flash_write(
    port: str = Form(...),
    chip: str = Form("auto"),
    baud: int = Form(460800),
    erase_first: bool = Form(False),
    offsets_json: str = Form("[]"),
    files: list[UploadFile] = File(...),
):
    temp_paths: list[str] = []
    try:
        await dm.release_serial_if_busy(port)
        offsets: list[str] = json.loads(offsets_json)
        if len(offsets) != len(files):
            offsets = ["0x1000"] * len(files)

        entries: list[tuple[str, str]] = []
        for off, f in zip(offsets, files):
            raw = await f.read()
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".bin")
            tmp.write(raw)
            tmp.close()
            temp_paths.append(tmp.name)
            entries.append((off, tmp.name))

        def on_prog(line: str, pct: Optional[int]):
            dm._broadcast_sync({"type": "flash", "data": {"line": line, "pct": pct}})

        log = await flasher.write_flash_bins(
            port=port,
            entries=entries,
            chip=chip,
            baud=baud,
            erase_first=erase_first,
            on_progress=on_prog,
            on_xray=dm._handle_xray,
        )
        return {"ok": True, "log": log}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        for p in temp_paths:
            try:
                os.unlink(p)
            except OSError:
                pass


@app.post("/api/flash/write-local")
async def flash_write_local(req: FlashLocalReq):
    try:
        await dm.release_serial_if_busy(req.port)
        pairs: list[tuple[str, str]] = []
        for entry in req.entries:
            p = Path(entry.path).expanduser().resolve()
            if not p.is_file() or p.suffix.lower() != ".bin":
                raise ValueError(f"Invalid .bin file path: {entry.path}")
            pairs.append((entry.offset, str(p)))

        def on_prog(line: str, pct: Optional[int]):
            dm._broadcast_sync({"type": "flash", "data": {"line": line, "pct": pct}})

        log = await flasher.write_flash_bins(
            port=req.port,
            entries=pairs,
            chip=req.chip,
            baud=req.baud,
            erase_first=req.erase_first,
            on_progress=on_prog,
            on_xray=dm._handle_xray,
        )
        return {"ok": True, "log": log}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/toolchains")
async def get_toolchains():
    return firmware_updater.detect_toolchains()


@app.post("/api/toolchains/inspect")
async def inspect_project(req: ToolchainInspectReq):
    try:
        return firmware_updater.inspect_project_dir(req.project_dir)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/toolchains/build")
async def build_project(req: ToolchainBuildReq):
    try:
        return await firmware_updater.build_local_project(
            project_dir=req.project_dir,
            framework=req.framework,
            fqbn=req.fqbn,
            on_xray=dm._handle_xray,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/ota/upload")
async def ota_upload(
    mode: str = Form("http"),  # http | arduino
    target: str = Form(...),  # http://ip/update or ip
    port: int = Form(3232),
    password: str = Form(""),
    file: UploadFile = File(...),
):
    try:
        raw = await file.read()
        if mode == "arduino":
            return await firmware_updater.arduino_ota_upload(
                esp_ip=target, esp_port=port, bin_bytes=raw, password=password, on_xray=dm._handle_xray
            )
        return await firmware_updater.http_ota_upload(
            url=target, bin_bytes=raw, filename=file.filename or "firmware.bin", on_xray=dm._handle_xray
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/crash/decode")
async def crash_decode(req: CrashDecodeReq):
    return crash_decoder.decode_crash_text(req.log_text, req.elf_path)


# -------------------- Helper Downloads & 1-Click Install --------------------

@app.get("/api/helpers/{name}")
async def get_helper_file(name: str):
    if name == "wifi_manager.py":
        return PlainTextResponse(WIFI_MANAGER_MPY)
    target = HELPERS_DIR / name
    if name not in ("esp_console_agent.py", "ESPConsoleAgent.h") or not target.exists():
        raise HTTPException(status_code=404, detail="Helper not found")
    return PlainTextResponse(target.read_text(encoding="utf-8"))


@app.post("/api/helpers/install-agent")
async def install_micropython_agent():
    try:
        agent_path = HELPERS_DIR / "esp_console_agent.py"
        await dm.repl.write_file("/esp_console_agent.py", agent_path.read_bytes())
        return {"ok": True, "path": "/esp_console_agent.py"}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -------------------- Real-Time WebSocket Stream --------------------

@app.websocket("/ws/console")
async def console_ws(ws: WebSocket):
    await ws.accept()
    dm._ws_clients.add(ws)
    try:
        await ws.send_text(json.dumps({"type": "state", "data": dm.status_snapshot()}))
        for chunk in list(dm.term_history):
            await ws.send_text(json.dumps({"type": "term", "data": chunk}))
        for trace in list(dm.xray_history)[-10:]:
            await ws.send_text(json.dumps({"type": "xray", "data": trace}))

        while True:
            msg_text = await ws.receive_text()
            msg = json.loads(msg_text)
            if msg.get("type") == "input":
                await dm.send_terminal_text(msg.get("data", ""))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        dm._ws_clients.discard(ws)

