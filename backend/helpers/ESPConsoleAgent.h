#pragma once
/*
 * ESPConsoleAgent.h — Optional lightweight header for Arduino / C++ ESP32 sketches.
 *
 * Include this header and call `ESPConsoleAgent::loop(2000);` inside Arduino `loop()`
 * to stream live heap RAM, CPU frequency, MCU temperature, and Wi-Fi RSSI to the
 * ESP32 Local Web Console while your C++ firmware runs!
 *
 * Emits lines formatted as:
 *   @METRIC:{"ram_free":210432,"ram_alloc":117248,"cpu_mhz":240,"rssi":-54}
 * The console strips @METRIC lines from the Serial Monitor and updates live gauges.
 */

#include <Arduino.h>
#ifdef ESP32
  #include <WiFi.h>
#endif

namespace ESPConsoleAgent {

inline unsigned long _lastEmitMs = 0;

inline void emitNow() {
  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t totalHeap = ESP.getHeapSize();
  uint32_t allocHeap = (totalHeap >= freeHeap) ? (totalHeap - freeHeap) : 0;
  uint32_t cpuMhz = ESP.getCpuFreqMHz();
  uint32_t flashFree = ESP.getFreeSketchSpace();
  uint32_t flashTotal = ESP.getFlashChipSize();

  Serial.print("@METRIC:{\"ram_free\":");
  Serial.print(freeHeap);
  Serial.print(",\"ram_alloc\":");
  Serial.print(allocHeap);
  Serial.print(",\"flash_free\":");
  Serial.print(flashFree);
  Serial.print(",\"flash_total\":");
  Serial.print(flashTotal);
  Serial.print(",\"cpu_mhz\":");
  Serial.print(cpuMhz);
  Serial.print(",\"uptime_ms\":");
  Serial.print(millis());

#ifdef ESP32
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(",\"ip\":\"");
    Serial.print(WiFi.localIP().toString());
    Serial.print("\",\"rssi\":");
    Serial.print(WiFi.RSSI());
  }
#endif

  Serial.println("}");
}

inline void loop(unsigned long intervalMs = 2000) {
  unsigned long now = millis();
  if (now - _lastEmitMs >= intervalMs) {
    _lastEmitMs = now;
    emitNow();
  }
}

} // namespace ESPConsoleAgent

