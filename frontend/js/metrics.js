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

    document.getElementById("ramText").textContent = `${fmtKB(ramFree)} Free / ${fmtKB(ramTotal)} Total (${ramPct}% used)`;
    const ramBar = document.getElementById("ramBar");
    ramBar.style.width = `${ramPct}%`;
    ramBar.classList.toggle("warn", ramPct > 80);

    if (m.flash_total) {
      const fFree = m.flash_free ?? 0;
      const fUsed = Math.max(0, m.flash_total - fFree);
      const fPct = Math.round((fUsed / m.flash_total) * 100);
      document.getElementById("flashText").textContent = `${fmtKB(fFree)} Free / ${(m.flash_total / (1024 * 1024)).toFixed(2)} MB Total (${fPct}% used)`;
      const flashBar = document.getElementById("flashBar");
      flashBar.style.width = `${fPct}%`;
      flashBar.classList.toggle("warn", fPct > 85);
    }

    document.getElementById("cpuStat").textContent = m.cpu_mhz ? `${m.cpu_mhz} MHz` : "--";
    document.getElementById("tempStat").textContent = m.temp_c != null ? `${m.temp_c} °C` : "N/A";
    document.getElementById("wifiMetricStat").textContent = m.ip ? `${m.ip} (${m.rssi ?? "?"} dBm)` : "Offline";

    if (m.reset_info) {
      document.getElementById("resetTitle").textContent = `${m.reset_info.title} (${m.reset_info.code})`;
      document.getElementById("resetMeaning").textContent = `${m.reset_info.meaning} ${m.reset_info.fix ? "Tip: " + m.reset_info.fix : ""}`;
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
    document.getElementById("sampleMetricsBtn").addEventListener("click", sampleMetrics);
    document.getElementById("runCheckupBtn").addEventListener("click", runHealthCheckup);
    document.getElementById("runGcBtn").addEventListener("click", runGc);
    document.getElementById("applyFreqBtn").addEventListener("click", () => {
      setFreq(Number(document.getElementById("cpuFreqSelect").value));
    });
    document.getElementById("installAgentBtn").addEventListener("click", installAgent);
    document.getElementById("scanI2cBtn").addEventListener("click", scanI2C);
    document.getElementById("gpioToggleBtn").addEventListener("click", () => gpioCmd("toggle"));
    document.getElementById("gpioReadBtn").addEventListener("click", () => gpioCmd("read"));
  }

  window.MetricsUI = { init, updateView, sampleMetrics };
})();

