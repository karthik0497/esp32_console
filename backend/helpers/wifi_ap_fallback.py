"""
MicroPython Wi-Fi + AP Fallback Helper (`wifi_manager.py`).
Saved onto the ESP32 and imported from `boot.py`:
1. Reads `wifi_config.json`.
2. Tries connecting to the saved Wi-Fi network for up to `timeout_s`.
3. If no config exists OR connection fails, starts a temporary AP hotspot
   (default: `ESP32-Setup` at http://192.168.4.1) with a mini setup page
   so you can change Wi-Fi credentials without plugging in USB!
"""

WIFI_MANAGER_MPY = '''import json
import time
import network
import socket

CONFIG_PATH = "wifi_config.json"


def load_config():
    try:
        with open(CONFIG_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(ssid, password):
    data = {"ssid": ssid, "password": password}
    with open(CONFIG_PATH, "w") as f:
        json.dump(data, f)


def connect_sta(ssid, password, timeout_s=12):
    wlan = network.WLAN(network.STA_IF)
    if not wlan.active():
        wlan.active(True)
        time.sleep(0.5)
    else:
        time.sleep(0.1)
    if wlan.isconnected():
        return wlan.ifconfig()[0]
    for _ in range(3):
        try:
            wlan.connect(ssid, password)
            break
        except OSError:
            time.sleep(0.4)
    start = time.time()
    while not wlan.isconnected():
        if time.time() - start > timeout_s:
            return None
        time.sleep(0.25)
    return wlan.ifconfig()[0]


def _urldecode(s):
    res = ""
    i = 0
    s = s.replace("+", " ")
    while i < len(s):
        if s[i] == "%" and i + 2 < len(s):
            try:
                res += chr(int(s[i + 1 : i + 3], 16))
                i += 3
                continue
            except Exception:
                pass
        res += s[i]
        i += 1
    return res


def start_ap_portal(ap_ssid="ESP32-Setup", ap_pass="12345678", max_wait_s=90):
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    try:
        ap.config(essid=ap_ssid, password=ap_pass, authmode=3)
    except Exception:
        ap.config(essid=ap_ssid)
    print("[WiFi AP Fallback] Hotspot active:", ap_ssid, "-> http://192.168.4.1")
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", 80))
    srv.listen(2)
    srv.settimeout(1.0)
    start = time.time()
    try:
        while time.time() - start < max_wait_s:
            try:
                conn, _ = srv.accept()
            except OSError:
                continue
            req = conn.recv(1024).decode("utf-8", "ignore")
            if "GET /save?" in req:
                q = req.split("GET /save?", 1)[1].split(" ", 1)[0]
                params = {}
                for part in q.split("&"):
                    if "=" in part:
                        k, v = part.split("=", 1)
                        params[k] = _urldecode(v)
                ssid = params.get("ssid", "")
                pw = params.get("pw", "")
                if ssid:
                    save_config(ssid, pw)
                    conn.send("HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\n"
                              "<h2>Saved! Rebooting to connect...</h2>")
                    conn.close()
                    time.sleep(1)
                    import machine
                    machine.reset()
            html = (
                "HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\n"
                "<html><body style='font-family:sans-serif;max-width:400px;margin:40px auto'>"
                "<h2>ESP32 Wi-Fi Setup</h2>"
                "<form action='/save' method='get'>"
                "<p>Wi-Fi Name (SSID):<br><input name='ssid' style='width:100%;padding:8px'></p>"
                "<p>Password:<br><input name='pw' type='password' style='width:100%;padding:8px'></p>"
                "<button type='submit' style='padding:10px 18px'>Save & Connect</button>"
                "</form></body></html>"
            )
            conn.send(html)
            conn.close()
    finally:
        srv.close()


def auto_connect(enable_ap_fallback=True):
    cfg = load_config()
    ssid = cfg.get("ssid")
    pw = cfg.get("password", "")
    if ssid:
        ip = connect_sta(ssid, pw)
        if ip:
            print("[WiFi] Connected:", ssid, "IP:", ip)
            return ip
        print("[WiFi] Could not reach:", ssid)
    if enable_ap_fallback:
        start_ap_portal()
    return None
'''

