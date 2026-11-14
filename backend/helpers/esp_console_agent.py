"""
Optional lightweight helper for MicroPython projects.
Drop this file onto your ESP32 and call `emit_metrics()` inside your loop
(or attach a Timer) to stream live RAM, Flash, CPU, Temp, and Wi-Fi metrics
to the ESP32 Local Console while main.py is actively running!

Protocol line emitted:
  @METRIC:{"ram_free":123456,"ram_alloc":45678,"flash_free":1200000,"cpu_mhz":240,"rssi":-55}
The ESP32 Console strips @METRIC lines from the main terminal and plots them in Live Metrics.
"""

import gc
import json
import os
import time
import machine

try:
    import network
except ImportError:
    network = None

try:
    import esp32
except ImportError:
    esp32 = None


def collect_metrics():
    data = {
        "ram_free": gc.mem_free(),
        "ram_alloc": gc.mem_alloc(),
        "cpu_mhz": machine.freq() // 1_000_000,
        "uptime_ms": time.ticks_ms(),
    }
    try:
        st = os.statvfs("/")
        data["flash_free"] = st[0] * st[3]
        data["flash_total"] = st[0] * st[2]
    except Exception:
        pass

    if esp32 is not None:
        try:
            if hasattr(esp32, "mcu_temperature"):
                data["temp_c"] = round(esp32.mcu_temperature(), 1)
            elif hasattr(esp32, "raw_temperature"):
                # raw_temperature returns Fahrenheit on older classic ESP32
                data["temp_c"] = round((esp32.raw_temperature() - 32) * 5 / 9, 1)
        except Exception:
            pass

    if network is not None:
        try:
            wlan = network.WLAN(network.STA_IF)
            if wlan.active() and wlan.isconnected():
                data["ip"] = wlan.ifconfig()[0]
                try:
                    data["rssi"] = wlan.status("rssi")
                except Exception:
                    pass
        except Exception:
            pass

    return data


def emit_metrics():
    print("@METRIC:" + json.dumps(collect_metrics()))

