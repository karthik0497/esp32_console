"""
ESP32 Network & Internet Data Monitor (MicroPython main.py)
-----------------------------------------------------------
1. Verifies Wi-Fi connection and keeps WebREPL alive.
2. Periodically fetches live network information & weather via HTTP JSON API.
3. Prints real-time statistics (Location, Public IP, Temp, Free RAM) to the terminal.
4. Blinks the onboard LED (Pin 2) on every network transmission.
5. Press Ctrl+C in the web console anytime to safely stop and return to >>> prompt.
"""

import gc
import json
import machine
import network
import socket
import time

try:
    import urequests
except ImportError:
    class URequestsFallback:
        @staticmethod
        def get(url, timeout=6):
            # Lightweight socket HTTP GET fallback for vanilla MicroPython
            proto, dummy, host, path = url.split("/", 3) if url.count("/") >= 3 else (url.split("/")[0], "", url.split("/")[2], "")
            path = "/" + path
            s = socket.socket()
            s.settimeout(timeout)
            s.connect((host, 80))
            s.send(f"GET {path} HTTP/1.0\r\nHost: {host}\r\nUser-Agent: MicroPython-ESP32\r\n\r\n".encode())
            res = b""
            while True:
                c = s.recv(512)
                if not c:
                    break
                res += c
            s.close()
            parts = res.split(b"\r\n\r\n", 1)
            body = parts[1].decode("utf-8") if len(parts) > 1 else "{}"
            class Response:
                def __init__(self, text):
                    self.text = text
                def json(self):
                    return json.loads(self.text)
                def close(self):
                    pass
            return Response(body)
    urequests = URequestsFallback()

# Onboard blue LED (Pin 2 on standard ESP32 boards)
led = machine.Pin(2, machine.Pin.OUT)

# Ensure WebREPL stays active in the background
try:
    import webrepl
    webrepl.start()
except Exception:
    pass

print("\n" + "=" * 52)
print("  🚀 ESP32 IoT Live Network Monitor (main.py)")
print("=" * 52)

# Verify Wi-Fi status
sta = network.WLAN(network.STA_IF)
if sta.isconnected():
    ip, mask, gateway, dns = sta.ifconfig()
    print("[Wi-Fi] Status   : Connected to Router")
    print(f"[Wi-Fi] Local IP : {ip}")
    print(f"[Wi-Fi] Gateway  : {gateway}")
else:
    print("[Wi-Fi] Status   : Disconnected. (Configure in Setup tab)")

print("\nStarting live data polling loop (every 10s)...")
print("Tip: Click '🛑 Stop (Ctrl+C)' in the console to exit.\n")

loop_count = 0

try:
    while True:
        loop_count += 1
        gc.collect()

        # Blink LED ON to show transmission activity
        led.value(1)

        print("-" * 52)
        print(f"📡 [Update #{loop_count}] Fetching live network data...")

        try:
            # 1. Fetch public IP, city, and ISP (fast, lightweight HTTP JSON)
            r = urequests.get("http://ip-api.com/json", timeout=6)
            info = r.json()
            r.close()

            city = info.get("city", "Unknown")
            region = info.get("regionName", "")
            country = info.get("country", "")
            isp = info.get("isp", "")
            pub_ip = info.get("query", "Unknown")

            print(f"📍 Location  : {city}, {region}, {country}")
            print(f"🌐 Public IP : {pub_ip} ({isp})")
        except Exception as e:
            print(f"⚠️ Network fetch error: {e}")

        try:
            # 2. Fetch live local weather (lat=12.97, lon=77.59 - customize as needed)
            w_res = urequests.get(
                "http://api.open-meteo.com/v1/forecast?latitude=12.97&longitude=77.59&current_weather=true",
                timeout=6,
            )
            w_data = w_res.json()
            w_res.close()
            cw = w_data.get("current_weather", {})
            temp = cw.get("temperature", "N/A")
            wind = cw.get("windspeed", "N/A")
            print(f"⛅ Weather   : {temp}°C | Wind: {wind} km/h")
        except Exception:
            pass

        # Print system memory health
        free_ram = gc.mem_free()
        print(f"💾 Free RAM  : {free_ram:,} bytes")
        print("-" * 52)

        # LED OFF after fetch completes
        led.value(0)

        # Non-blocking pause (allows REPL / WebREPL interrupts)
        for _ in range(10):
            time.sleep(1)

except KeyboardInterrupt:
    led.value(0)
    print("\n🛑 Program stopped by user (Ctrl+C). Returning to MicroPython REPL >>>\n")
