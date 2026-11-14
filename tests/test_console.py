"""End-to-end API & Simulator verification suite for the ESP32 Local Web Console."""

import io
import zipfile

from fastapi.testclient import TestClient

from backend.main import app


def test_pages_and_guide_markdown():
    with TestClient(app) as client:
        r_index = client.get("/")
        assert r_index.status_code == 200
        assert "ESP32 Active-Learning Console" in r_index.text

        r_guide = client.get("/guide")
        assert r_guide.status_code == 200
        assert "ESP32 Console" in r_guide.text

        r_md = client.get("/api/guide-md")
        assert r_md.status_code == 200
        assert "School Backpack" in r_md.text

        r_dl = client.get("/api/guide-md?download=1")
        assert r_dl.status_code == 200
        assert "attachment;" in r_dl.headers.get("content-disposition", "")


def test_simulator_full_micropython_workflow():
    with TestClient(app) as client:
        # 1. Ports list includes Simulator
        ports = client.get("/api/ports").json()
        assert ports["simulator"]["port"] == "SIMULATOR"

        # 2. Connect Simulator
        conn = client.post("/api/connect", json={"mode": "simulator", "target": "SIMULATOR"})
        assert conn.status_code == 200
        assert conn.json()["connected"] is True

        # 3. Stop running main.py
        ctrl = client.post("/api/control/interrupt")
        assert ctrl.status_code == 200

        # 4. List files & check /main.py exists
        files = client.get("/api/files").json()["files"]
        paths = [f["path"] for f in files]
        assert "/main.py" in paths
        assert "/boot.py" in paths
        assert "/lib/sensors.py" in paths

        # 5. Create folder, write file, read file, backup zip, delete file
        assert client.post("/api/mkdir", json={"path": "/demo_dir"}).status_code == 200
        assert client.post("/api/file", json={"path": "/demo_dir/hello.py", "content": "print('hi')"}).status_code == 200
        read_res = client.get("/api/file", params={"path": "/demo_dir/hello.py"}).json()
        assert read_res["content"] == "print('hi')"

        zresp = client.get("/api/backup-zip")
        assert zresp.status_code == 200
        with zipfile.ZipFile(io.BytesIO(zresp.content)) as zf:
            assert "demo_dir/hello.py" in zf.namelist()
            assert "main.py" in zf.namelist()

        assert client.delete("/api/file", params={"path": "/demo_dir"}).status_code == 200

        # 6. Upload multipart file
        up = client.post(
            "/api/upload",
            data={"target_dir": "/lib"},
            files={"files": ("custom_mod.py", b"X = 42\n", "text/x-python")},
        )
        assert up.status_code == 200
        assert up.json()["uploaded"][0]["path"] == "/lib/custom_mod.py"

        # 7. System Metrics, gc.collect(), CPU freq, Hardware Quick-Checks
        metrics = client.get("/api/metrics").json()
        assert metrics["ram_free"] > 0
        assert metrics["flash_total"] > 0
        assert "reset_info" in metrics

        gc_res = client.post("/api/metrics/gc").json()
        assert gc_res["after"] >= gc_res["before"]

        freq_res = client.post("/api/metrics/freq", json={"mhz": 160}).json()
        assert freq_res["cpu_mhz"] == 160

        i2c_res = client.post("/api/hardware/i2c-scan", json={"scl": 22, "sda": 21}).json()
        assert any(d["hex"] == "0x3C" for d in i2c_res["devices"])

        gpio_res = client.post("/api/hardware/gpio", json={"pin": 2, "action": "on"}).json()
        assert gpio_res["value"] == 1

        # 8. Wi-Fi Scan, Connect + AP Fallback, WebREPL Setup
        nets = client.post("/api/wifi/scan").json()["networks"]
        assert len(nets) >= 1

        wconn = client.post(
            "/api/wifi/connect",
            json={"ssid": "Lab-WiFi-2.4G", "password": "secret", "save_config": True, "install_ap_fallback": True},
        ).json()
        assert wconn["connected"] is True

        wrepl = client.post("/api/webrepl/setup", json={"password": "4321"}).json()
        assert wrepl["started"] is True
        assert "ws://" in wrepl["ws_url"]

        cfg_file = client.get("/api/file", params={"path": "/webrepl_cfg.py"}).json()
        assert "PASS = '4321'" in cfg_file["content"]

        boot_file = client.get("/api/file", params={"path": "/boot.py"}).json()
        assert "webrepl.start()" in boot_file["content"]

        checkup = client.post("/api/health-checkup").json()
        assert len(checkup["checks"]) == 7
        assert any(c["name"] == "Heap RAM Health" for c in checkup["checks"])

        init_setup = client.post(
            "/api/wifi/initial-setup",
            json={
                "ssid": "Lab-WiFi-2.4G",
                "wifi_password": "secret",
                "webrepl_password": "5678",
                "install_ap_fallback": True,
            },
        )
        assert init_setup.status_code == 200
        init_json = init_setup.json()
        assert init_json["wifi"]["connected"] is True
        assert init_json["webrepl"]["started"] is True
        assert "/wifi_config.json" in init_json["files_uploaded"]
        assert "/webrepl_cfg.py" in init_json["files_uploaded"]

        # 9. Disconnect
        disc = client.post("/api/disconnect").json()
        assert disc["connected"] is False


def test_flasher_simulator_and_crash_decoder():
    with TestClient(app) as client:
        probe = client.post("/api/flash/probe", json={"port": "SIMULATOR"}).json()
        assert "ESP32-S3" in probe["chip"]

        erase = client.post("/api/flash/erase", json={"port": "SIMULATOR"}).json()
        assert erase["ok"] is True

        flash = client.post(
            "/api/flash/write",
            data={"port": "SIMULATOR", "chip": "esp32s3", "baud": "460800", "erase_first": "false", "offsets_json": '["0x0"]'},
            files={"files": ("fw.bin", b"FAKEBIN", "application/octet-stream")},
        ).json()
        assert flash["ok"] is True

        crash = client.post(
            "/api/crash/decode",
            json={"log_text": "rst:0x10 (RTCWDT_RTC_RESET)\nGuru Meditation Error: Core  1 panic'ed (LoadProhibited). Exception was unhandled.\nBacktrace: 0x400d1234:0x3ffb1230"},
        ).json()
        assert any("LoadProhibited" in f["detail"] for f in crash["findings"])
        assert "0x400d1234" in crash["addresses"]


def test_websocket_terminal_and_xray():
    with TestClient(app) as client:
        client.post("/api/connect", json={"mode": "simulator", "target": "SIMULATOR"})
        with client.websocket_connect("/ws/console") as ws:
            first = ws.receive_json()
            assert first["type"] == "state"
            assert first["data"]["connected"] is True

            # Interrupt running main.py and run an expression over WS
            client.post("/api/control/interrupt")
            ws.send_json({"type": "input", "data": "print(6 * 7)\r\n"})

            term_acc = ""
            saw_42 = False
            for _ in range(60):
                msg = ws.receive_json()
                if msg["type"] == "term":
                    term_acc += msg["data"]
                    if "42" in term_acc:
                        saw_42 = True
                        break
            assert saw_42, f"Expected '42' in terminal output, got: {term_acc!r}"
        client.post("/api/disconnect")


def test_info_buttons_coverage_in_html():
    """Verify every data-info key in index.html exists inside learning.js INFO_CATALOG."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    html = (root / "frontend" / "index.html").read_text(encoding="utf-8")
    js = (root / "frontend" / "js" / "learning.js").read_text(encoding="utf-8")

    keys = set(re.findall(r'data-info="([^"]+)"', html))
    assert len(keys) >= 20
    for k in keys:
        assert f"{k}:" in js, f"Missing INFO_CATALOG entry for data-info='{k}'"


def test_static_assets_and_helpers():
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    index_html = (root / "frontend" / "index.html").read_text(encoding="utf-8")
    guide_html = (root / "frontend" / "guide.html").read_text(encoding="utf-8")
    assets = set(re.findall(r'(?:src|href)="(/static/[^"]+)"', index_html + guide_html))
    assert len(assets) >= 9

    with TestClient(app) as client:
        for asset in assets:
            r = client.get(asset)
            assert r.status_code == 200, f"Static asset {asset} returned {r.status_code}"

        for helper in ("esp_console_agent.py", "ESPConsoleAgent.h", "wifi_manager.py"):
            r = client.get(f"/api/helpers/{helper}")
            assert r.status_code == 200

        tc = client.get("/api/toolchains").json()
        assert tc["esptool"] is True

        client.post("/api/connect", json={"mode": "simulator", "target": "SIMULATOR"})
        inst = client.post("/api/helpers/install-agent")
        assert inst.status_code == 200
        assert inst.json()["path"] == "/esp_console_agent.py"
        client.post("/api/disconnect")


def test_local_project_inspect_and_flash_write_local(tmp_path):
    proj = tmp_path / "blink_sketch"
    proj.mkdir()
    (proj / "blink_sketch.ino").write_text("void setup() {}\nvoid loop() {}\n", encoding="utf-8")
    bin_file = proj / "blink_sketch.ino.bin"
    bin_file.write_bytes(b"FAKE_ARDUINO_BIN")

    with TestClient(app) as client:
        insp = client.post("/api/toolchains/inspect", json={"project_dir": str(proj)})
        assert insp.status_code == 200
        j = insp.json()
        assert "arduino" in j["frameworks"]
        assert str(bin_file) in j["bin_files"]

        fl = client.post(
            "/api/flash/write-local",
            json={
                "port": "SIMULATOR",
                "chip": "esp32",
                "baud": 460800,
                "erase_first": False,
                "entries": [{"offset": "0x10000", "path": str(bin_file)}],
            },
        )
        assert fl.status_code == 200
        assert fl.json()["ok"] is True


def test_webrepl_transport_handshake_and_stream():
    import asyncio
    import websockets
    from backend.transports.webrepl_transport import WebReplTransport

    async def _run():
        received_on_client = []

        async def mock_webrepl(ws):
            await ws.send("Password: ")
            pw = await ws.recv()
            if pw.strip() != "1234":
                await ws.send("\r\nAccess denied\r\n")
                await ws.close()
                return
            await ws.send("\r\nWebREPL connected\r\n>>> ")
            async for msg in ws:
                if "ping" in msg:
                    await ws.send("pong\r\n>>> ")

        async with websockets.serve(mock_webrepl, "127.0.0.1", 0) as srv:
            port = srv.sockets[0].getsockname()[1]

            bad = WebReplTransport(host="127.0.0.1", port=port, password="wrong")
            try:
                await bad.connect()
                assert False, "Expected PermissionError"
            except PermissionError:
                pass

            good = WebReplTransport(
                host="127.0.0.1",
                port=port,
                password="1234",
                on_bytes=lambda b: received_on_client.append(b.decode("utf-8", "ignore")),
            )
            info = await good.connect()
            assert info["transport"] == "webrepl"
            await good.write(b"ping\r\n")
            await asyncio.sleep(0.15)
            await good.disconnect()
            assert any("pong" in s for s in received_on_client)

    asyncio.run(_run())
