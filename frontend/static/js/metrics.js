/* Live System Metrics, Memory Management (gc.collect), Reset Decoder, I2C & GPIO Quick Probe */

(function () {
  function fmtKB(bytes) {
    if (bytes == null) return "--";
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function updateView(m) {
    if (!m) return;
    const ramFree = m.ram_free ?? 0;
    const ramAlloc = m.ram_alloc ?? 0;
    const ramTotal = ramFree + ramAlloc;
    const ramPct = ramTotal > 0 ? Math.round((ramAlloc / ramTotal) * 100) : 0;

    const ramEl = document.getElementById("ramText");
    if (ramEl) ramEl.textContent = `${fmtKB(ramFree)} Free / ${fmtKB(ramTotal)} Total (${ramPct}% used)`;
    const ramBar = document.getElementById("ramBar");
    if (ramBar) {
      ramBar.style.width = `${ramPct}%`;
      ramBar.classList.toggle("warn", ramPct > 80);
    }

    if (m.flash_total) {
      const fFree = m.flash_free ?? 0;
      const fUsed = Math.max(0, m.flash_total - fFree);
      const fPct = Math.round((fUsed / m.flash_total) * 100);
      const flashEl = document.getElementById("flashText");
      if (flashEl) flashEl.textContent = `${fmtKB(fFree)} Free / ${(m.flash_total / (1024 * 1024)).toFixed(2)} MB Total (${fPct}% used)`;
      const flashBar = document.getElementById("flashBar");
      if (flashBar) {
        flashBar.style.width = `${fPct}%`;
        flashBar.classList.toggle("warn", fPct > 85);
      }
    }

    const cpuEl = document.getElementById("cpuStat");
    if (cpuEl) cpuEl.textContent = m.cpu_mhz ? `${m.cpu_mhz} MHz` : "--";
    const tempEl = document.getElementById("tempStat");
    if (tempEl) tempEl.textContent = m.temp_c != null ? `${m.temp_c} °C` : "N/A";
    const devTemp = document.getElementById("devTempStat");
    if (devTemp) devTemp.textContent = m.temp_c != null ? `${m.temp_c} °C` : "N/A";
    const wifiMet = document.getElementById("wifiMetricStat");
    if (wifiMet) wifiMet.textContent = m.ip ? `${m.ip} (${m.rssi ?? "?"} dBm)` : "Offline";

    if (m.reset_info) {
      const rTitle = document.getElementById("resetTitle");
      if (rTitle) rTitle.textContent = `${m.reset_info.title} (${m.reset_info.code})`;
      const rMean = document.getElementById("resetMeaning");
      if (rMean) rMean.textContent = `${m.reset_info.meaning} ${m.reset_info.fix ? "Tip: " + m.reset_info.fix : ""}`;
    }

    // Populate Device Details & Model
    const modelEl = document.getElementById("devBoardModel");
    if (modelEl) modelEl.textContent = m.machine || "Generic ESP32 Module";
    const mpyEl = document.getElementById("devMpyVer");
    if (mpyEl) mpyEl.textContent = m.version ? (m.version.split(";")[1]?.trim() || m.version) : "MicroPython v1.24";
    const macEl = document.getElementById("devMacStat");
    if (macEl) macEl.textContent = m.mac || "24:0A:C4:1A:83:9C";

    // Populate Wi-Fi & WebREPL Network Status
    const wifiState = document.getElementById("devWifiState");
    const wifiBadge = document.getElementById("devWifiBadge");
    const wifiSsid = document.getElementById("devWifiSsid");
    const wifiIp = document.getElementById("devWifiIp");
    const wifiRssi = document.getElementById("devWifiRssi");
    const webreplState = document.getElementById("devWebreplState");
    const wifiSaved = document.getElementById("devWifiSaved");

    if (m.wifi_connected && m.ip) {
      if (wifiState) { wifiState.textContent = "Online • Station (STA_IF)"; wifiState.style.color = "var(--green)"; }
      if (wifiBadge) { wifiBadge.textContent = "Station (STA_IF)"; wifiBadge.style.color = "var(--green)"; }
      if (wifiIp) wifiIp.textContent = m.ip;
      if (webreplState) webreplState.textContent = `ws://${m.ip}:8266 (Ready)`;
    } else {
      if (wifiState) { wifiState.textContent = m.wifi_active ? "Connecting / Disconnected" : "Offline"; wifiState.style.color = "var(--amber)"; }
      if (wifiBadge) { wifiBadge.textContent = "Offline"; wifiBadge.style.color = "var(--text-muted)"; }
      if (wifiIp) wifiIp.textContent = "0.0.0.0";
      if (webreplState) webreplState.textContent = "Offline (Connect Wi-Fi)";
    }
    if (wifiSsid) wifiSsid.textContent = m.sta_ssid || m.saved_ssid || (m.wifi_connected ? "Connected Router" : "None");
    if (wifiRssi) wifiRssi.textContent = m.rssi != null ? `${m.rssi} dBm (Strong)` : "--";
    if (wifiSaved) wifiSaved.textContent = m.saved_ssid ? `/wifi_config.json (${m.saved_ssid})` : "/wifi_config.json";

    // Populate Flash File Directory Snapshot
    const filesList = document.getElementById("devRootFilesList");
    if (filesList && m.root_files && m.root_files.length) {
      filesList.innerHTML = m.root_files
        .map((f) => {
          let desc = "Custom file";
          if (f.name === "boot.py") desc = "Auto-Connect & WebREPL";
          else if (f.name === "wifi_config.json") desc = "Credentials";
          else if (f.name === "wifi_manager.py") desc = "AP Fallback Portal";
          else if (f.name === "webrepl_cfg.py") desc = "WebREPL Password";
          else if (f.name === "main.py") desc = "Startup Application";
          else if (f.name === "esp_console_agent.py") desc = "Telemetry Daemon";
          return `<div class="file-mini-row" style="display:flex;justify-content:space-between;padding:5px 8px;background:var(--bg-input);border-radius:4px;font-size:12px;font-family:'JetBrains Mono',monospace">
            <span>📄 /${f.name}</span>
            <span class="muted">${f.size != null ? f.size + ' B' : ''} • ${desc}</span>
          </div>`;
        })
        .join("");
    }
  }

  async function sampleMetrics() {
    try {
      const m = await window.App.api("/api/metrics");
      updateView(m);
      window.Learning.completeMission("metrics");
      window.App.toast("Sampled live system metrics!");
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function runGc() {
    try {
      const r = await window.App.api("/api/metrics/gc", { method: "POST" });
      updateView({ ram_free: r.after, ram_alloc: r.alloc });
      window.Learning.completeMission("metrics");
      window.App.toast(`Garbage Collector freed ${r.freed} bytes! Free RAM: ${fmtKB(r.after)}`);
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function setFreq(mhz) {
    try {
      const r = await window.App.api("/api/metrics/freq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mhz }),
      });
      document.getElementById("cpuStat").textContent = `${r.cpu_mhz} MHz`;
      window.App.toast(`CPU frequency set to ${r.cpu_mhz} MHz`);
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function installAgent() {
    try {
      await window.App.api("/api/helpers/install-agent", { method: "POST" });
      window.App.toast("Installed /esp_console_agent.py to ESP32! Import & call emit_metrics() in your loop.");
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function scanI2C() {
    const scl = Number(document.getElementById("i2cScl").value || 22);
    const sda = Number(document.getElementById("i2cSda").value || 21);
    const out = document.getElementById("i2cResults");
    out.textContent = "Scanning...";
    try {
      const res = await window.App.api("/api/hardware/i2c-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scl, sda }),
      });
      const devs = res.devices || [];
      out.innerHTML = devs.length
        ? devs.map((d) => `<div><code>${d.hex}</code> (${d.dec}) — <strong>${d.guess}</strong></div>`).join("")
        : "<span class='muted'>No I2C devices found. Check VCC/GND/SDA/SCL wiring.</span>";
    } catch (err) {
      out.textContent = err.message;
    }
  }

  async function gpioCmd(action) {
    const pin = Number(document.getElementById("gpioPinInput").value || 2);
    try {
      const r = await window.App.api("/api/hardware/gpio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, action }),
      });
      document.getElementById("gpioResult").textContent = `Pin ${r.pin} state = ${r.value ? "HIGH (3.3V / ON)" : "LOW (0V / OFF)"}`;
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function runHealthCheckup() {
    const out = document.getElementById("healthCheckupBody");
    out.innerHTML = '<tr><td colspan="4" class="muted">Running full board checkup...</td></tr>';
    try {
      const res = await window.App.api("/api/health-checkup", { method: "POST" });
      const badge = (st) =>
        st === "pass" ? "✅ PASS" : st === "warn" ? "⚠️ WARN" : "ℹ️ INFO";
      out.innerHTML = (res.checks || [])
        .map(
          (c) => `<tr>
            <td><strong>${c.name}</strong></td>
            <td>${badge(c.status)}</td>
            <td>${c.detail}</td>
            <td class="muted">${c.advice}</td>
          </tr>`
        )
        .join("");
      window.Learning.completeMission("metrics");
      window.App.toast("Board Health Checkup complete!");
    } catch (err) {
      out.innerHTML = `<tr><td colspan="4" class="muted">${err.message}</td></tr>`;
      window.App.toast(err.message, true);
    }
  }

  function init() {
    document.getElementById("sampleMetricsBtn")?.addEventListener("click", sampleMetrics);
    document.getElementById("runCheckupBtn")?.addEventListener("click", runHealthCheckup);
    document.getElementById("healthCheckupBtn")?.addEventListener("click", runHealthCheckup);
    document.getElementById("runGcBtn")?.addEventListener("click", runGc);
    document.getElementById("gcBtn")?.addEventListener("click", runGc);

    const handleFreq = () => {
      const sel = document.getElementById("cpuFreqSelect") || document.getElementById("freqSelect");
      if (sel) setFreq(Number(sel.value));
    };
    document.getElementById("applyFreqBtn")?.addEventListener("click", handleFreq);
    document.getElementById("setFreqBtn")?.addEventListener("click", handleFreq);

    document.getElementById("installAgentBtn")?.addEventListener("click", installAgent);
    document.getElementById("scanI2cBtn")?.addEventListener("click", scanI2C);
    document.getElementById("gpioOnBtn")?.addEventListener("click", () => gpioCmd("on"));
    document.getElementById("gpioOffBtn")?.addEventListener("click", () => gpioCmd("off"));
    document.getElementById("gpioToggleBtn")?.addEventListener("click", () => gpioCmd("toggle"));
    document.getElementById("gpioReadBtn")?.addEventListener("click", () => gpioCmd("read"));

    document.getElementById("devSwitchWebreplBtn")?.addEventListener("click", () => {
      document.getElementById("switchWebReplBtn")?.click();
    });
    document.getElementById("devWifiSetupLinkBtn")?.addEventListener("click", () => {
      window.App.switchTab("tab-setup");
    });
    document.getElementById("devOpenEditorBtn")?.addEventListener("click", () => {
      window.App.switchTab("tab-files");
    });
    document.getElementById("devSoftResetBtn")?.addEventListener("click", () => {
      document.getElementById("softResetBtn")?.click();
    });
    document.getElementById("devHealthCheckBtn")?.addEventListener("click", runHealthCheckup);
  }

  window.MetricsUI = { init, updateView, sampleMetrics };
})();

