/* Wi-Fi Scanner, Config Manager, AP Hotspot Fallback, and WebREPL Setup */

(function () {
  async function refreshStatus() {
    try {
      const s = await window.App.api("/api/wifi/status");
      const box = document.getElementById("wifiStatusCard");
      const ip = s.sta_ifconfig ? s.sta_ifconfig[0] : "0.0.0.0";
      box.innerHTML = `
        <div><strong>Station (Router):</strong> ${s.sta_connected ? `Connected (${s.sta_ssid || ""}) — IP <code>${ip}</code> (RSSI ${s.rssi ?? "?"} dBm)` : "Not connected"}</div>
        <div><strong>Saved wifi_config.json:</strong> ${s.saved_ssid ? `<code>${s.saved_ssid}</code>` : "<span class='muted'>None yet</span>"}</div>
        <div><strong>Hotspot (AP Mode):</strong> ${s.ap_active ? `Active at <code>${s.ap_ifconfig ? s.ap_ifconfig[0] : "192.168.4.1"}</code>` : "Off"}</div>
      `;
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function scanWifi() {
    const tbody = document.getElementById("wifiScanBody");
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Scanning 2.4 GHz Wi-Fi networks...</td></tr>';
    try {
      const data = await window.App.api("/api/wifi/scan", { method: "POST" });
      const nets = data.networks || [];
      window.Learning.completeMission("wifi");
      if (!nets.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">No 2.4 GHz networks found.</td></tr>';
        return;
      }
      tbody.innerHTML = nets
        .map(
          (n) => `<tr>
            <td><strong>${n.ssid || "(Hidden)"}</strong></td>
            <td>${n.rssi} dBm</td>
            <td>${n.security}</td>
            <td><button type="button" class="btn btn-sm pick-ssid-btn" data-ssid="${n.ssid}">Select</button></td>
          </tr>`
        )
        .join("");

      tbody.querySelectorAll(".pick-ssid-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.getElementById("wifiSsid").value = btn.dataset.ssid;
          document.getElementById("wifiPass").focus();
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">${err.message}</td></tr>`;
    }
  }

  async function connectWifi() {
    const ssid = document.getElementById("wifiSsid").value.trim();
    const password = document.getElementById("wifiPass").value;
    const save_config = document.getElementById("wifiSaveCfg").checked;
    const install_ap_fallback = document.getElementById("wifiApFallback").checked;
    if (!ssid) return window.App.toast("Enter or pick a Wi-Fi SSID first.", true);
    try {
      const res = await window.App.api("/api/wifi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, password, save_config, install_ap_fallback }),
      });
      if (res.connected && res.ifconfig) {
        window.App.toast(`Connected to ${ssid}! IP: ${res.ifconfig[0]}`);
        document.getElementById("webreplTargetHint").textContent = `ws://${res.ifconfig[0]}:8266`;
        document.getElementById("webreplTargetHint").dataset.ip = res.ifconfig[0];
      } else {
        window.App.toast("Could not connect — verify SSID/password and ensure 2.4 GHz Wi-Fi.", true);
      }
      window.Learning.completeMission("wifi");
      await refreshStatus();
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function startAp() {
    const ssid = document.getElementById("apSsid").value.trim() || "ESP32-Setup";
    const password = document.getElementById("apPass").value || "12345678";
    try {
      const res = await window.App.api("/api/wifi/ap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, password }),
      });
      window.App.toast(`Hotspot '${res.ssid}' active at 192.168.4.1`);
      await refreshStatus();
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function setupWebRepl() {
    const password = document.getElementById("webreplSetupPass").value;
    try {
      const res = await window.App.api("/api/webrepl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      window.Learning.completeMission("wifi");
      const hint = document.getElementById("webreplTargetHint");
      if (res.ip) {
        hint.textContent = `ws://${res.ip}:8266 (Ready!)`;
        hint.dataset.ip = res.ip;
      } else {
        hint.textContent = "Configured in boot.py! Connect Wi-Fi first to get an IP.";
      }
      window.App.toast("WebREPL enabled and saved to boot.py!");
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function runInitialSetup() {
    const ssid = document.getElementById("wifiSsid").value.trim();
    const wifi_password = document.getElementById("wifiPass").value;
    const webrepl_password = document.getElementById("webreplSetupPass").value || "1234";
    const install_ap_fallback = document.getElementById("wifiApFallback").checked;
    if (!ssid) return window.App.toast("Enter or select your 2.4 GHz Wi-Fi SSID first.", true);
    try {
      const res = await window.App.api("/api/wifi/initial-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, wifi_password, webrepl_password, install_ap_fallback }),
      });
      const ip = res.webrepl?.ip || (res.wifi?.ifconfig ? res.wifi.ifconfig[0] : null);
      const hint = document.getElementById("webreplTargetHint");
      const summary = document.getElementById("initialSetupSummary");
      if (ip) {
        hint.textContent = `ws://${ip}:8266 (Ready!)`;
        hint.dataset.ip = ip;
        summary.innerHTML = `✅ Uploaded <code>${res.files_uploaded.join(", ")}</code>. Ready for WebREPL at <code>ws://${ip}:8266</code> — click <strong>Use in Top Bar</strong> below!`;
        window.App.toast(`Initial Setup Complete! WebREPL ready at ws://${ip}:8266`);
      } else {
        summary.innerHTML = `Uploaded config files (<code>${res.files_uploaded.join(", ")}</code>), but Wi-Fi did not get an IP — check SSID/password.`;
        window.App.toast("Files uploaded, but Wi-Fi could not connect — check password / 2.4 GHz.", true);
      }
      window.Learning.completeMission("wifi");
      await refreshStatus();
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  function init() {
    document.getElementById("wifiStatusBtn").addEventListener("click", refreshStatus);
    document.getElementById("wifiScanBtn").addEventListener("click", scanWifi);
    document.getElementById("wifiConnectBtn").addEventListener("click", connectWifi);
    document.getElementById("initialSetupBtn").addEventListener("click", runInitialSetup);
    document.getElementById("startApBtn").addEventListener("click", startAp);
    document.getElementById("setupWebReplBtn").addEventListener("click", setupWebRepl);

    document.getElementById("switchWebReplBtn").addEventListener("click", () => {
      const ip = document.getElementById("webreplTargetHint").dataset.ip;
      const pw = document.getElementById("webreplSetupPass").value || "1234";
      document.getElementById("connMode").value = "webrepl";
      document.getElementById("connMode").dispatchEvent(new Event("change"));
      if (ip) document.getElementById("webreplHostInput").value = ip;
      document.getElementById("webreplPassInput").value = pw;
      window.App.toast("Switched connection bar to WebREPL — click Connect!");
    });
  }

  window.WifiUI = { init, refreshStatus };
})();

