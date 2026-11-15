/* Wi-Fi Scanner, Config Manager, AP Hotspot Fallback, and WebREPL Setup */

(function () {
  async function refreshStatus() {
    try {
      const s = await window.App.api("/api/wifi/status");
      const box = document.getElementById("wifiStatusCard");
      const ip = (s.sta_ifconfig && s.sta_ifconfig[0] !== "0.0.0.0") ? s.sta_ifconfig[0] : null;
      let staHtml = "";
      if (s.sta_connected && ip) {
        staHtml = `<span style="color:var(--emerald);font-weight:600">Connected (${s.sta_ssid || ""})</span> — IP <code>${ip}</code> (RSSI ${s.rssi ?? "?"} dBm)`;
      } else if (s.sta_status === 202) {
        staHtml = `<span style="color:var(--red);font-weight:600">⚠️ Wrong Password (Error 202)</span> — Router rejected password for <code>${s.sta_ssid || s.saved_ssid}</code>`;
      } else if (s.sta_status === 201) {
        staHtml = `<span style="color:var(--red);font-weight:600">⚠️ Network Not Found (Error 201)</span> — SSID out of range`;
      } else if (s.sta_status === 203) {
        staHtml = `<span style="color:var(--red);font-weight:600">⚠️ Association Failed (Error 203)</span>`;
      } else if (s.sta_status === 1001) {
        staHtml = `<span style="color:var(--amber);font-weight:600">Connecting to ${s.sta_ssid || s.saved_ssid}...</span>`;
      } else {
        staHtml = "<span class='muted'>Not connected</span>";
      }

      box.innerHTML = `
        <div><strong>Station (Router):</strong> ${staHtml}</div>
        <div><strong>Saved wifi_config.json:</strong> ${s.saved_ssid ? `<code>${s.saved_ssid}</code>` : "<span class='muted'>None yet</span>"}</div>
        <div><strong>Hotspot (AP Mode):</strong> ${s.ap_active ? `Active at <code>${s.ap_ifconfig ? s.ap_ifconfig[0] : "192.168.4.1"}</code>` : "Off"}</div>
      `;
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function scanWifi() {
    const btn = document.getElementById("wifiScanBtn");
    const tbody = document.getElementById("wifiScanBody");
    btn.disabled = true;
    btn.textContent = "Scanning...";
    tbody.innerHTML = '<tr><td colspan="4" class="muted" style="padding:16px;text-align:center">🔍 Scanning for 2.4 GHz Wi-Fi networks (takes ~3-5s)...</td></tr>';
    try {
      const data = await window.App.api("/api/wifi/scan", { method: "POST" });
      const nets = data.networks || [];
      window.Learning.completeMission("wifi");
      if (!nets.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted" style="padding:14px;text-align:center">No 2.4 GHz networks found. Make sure Wi-Fi router is in range.</td></tr>';
        return;
      }
      tbody.innerHTML = nets
        .map(
          (n) => `<tr>
            <td><strong>${n.ssid || "(Hidden SSID)"}</strong></td>
            <td>${n.rssi} dBm</td>
            <td>${n.security}</td>
            <td><button type="button" class="btn btn-sm pick-ssid-btn" data-ssid="${n.ssid}">Select</button></td>
          </tr>`
        )
        .join("");

      tbody.querySelectorAll(".pick-ssid-btn").forEach((b) => {
        b.addEventListener("click", () => {
          document.getElementById("wifiSsid").value = b.dataset.ssid;
          document.getElementById("wifiPass").focus();
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" style="color:var(--red);padding:14px;text-align:center">⚠️ Wi-Fi scan error: ${err.message}<br><small class="muted">Check System Logs tab for full trace.</small></td></tr>`;
      window.App.toast("Wi-Fi Scan Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Scan Wi-Fi";
    }
  }

  async function connectWifi() {
    const btn = document.getElementById("wifiConnectBtn");
    const ssid = document.getElementById("wifiSsid").value.trim();
    const password = document.getElementById("wifiPass").value;
    const save_config = document.getElementById("wifiSaveCfg").checked;
    const install_ap_fallback = document.getElementById("wifiApFallback").checked;
    if (!ssid) return window.App.toast("Enter or pick a Wi-Fi SSID first.", true);

    btn.disabled = true;
    btn.textContent = "Connecting...";
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
        const detail = res.status_detail || "Could not connect — verify SSID/password and ensure 2.4 GHz Wi-Fi.";
        window.App.toast(detail, true);
      }
      window.Learning.completeMission("wifi");
      await refreshStatus();
    } catch (err) {
      window.App.toast("Connect Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Connect & Save Wi-Fi";
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
    const btn = document.getElementById("setupWebReplBtn");
    const password = document.getElementById("webreplSetupPass").value;
    btn.disabled = true;
    btn.textContent = "Configuring...";
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
        hint.textContent = "Configured in boot.py & /webrepl_cfg.py! Connect Wi-Fi to get IP.";
      }
      window.App.toast("WebREPL enabled and saved to /webrepl_cfg.py and boot.py!");
      await refreshStatus();
    } catch (err) {
      window.App.toast("WebREPL Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Enable WebREPL";
    }
  }

  async function runInitialSetup() {
    const btn = document.getElementById("initialSetupBtn");
    const ssid = document.getElementById("wifiSsid").value.trim();
    const wifi_password = document.getElementById("wifiPass").value;
    const webrepl_password = document.getElementById("webreplSetupPass").value || "1234";
    const install_ap_fallback = document.getElementById("wifiApFallback")?.checked;
    if (!ssid) return window.App.toast("Enter or select your 2.4 GHz Wi-Fi SSID first.", true);

    btn.disabled = true;
    btn.textContent = "Provisioning...";

    const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (!isLocal || !window.App.isBackendAvailable?.()) {
      try {
        window.App.toast("Provisioning Wi-Fi & WebREPL via Web Serial...");
        if (window.App.sendWsInput) {
          window.App.sendWsInput("\x03\x03");
        }
        await new Promise((r) => setTimeout(r, 350));

        const setupScript =
          "import os, network, time\r\n" +
          "with open('/webrepl_cfg.py', 'w') as f: f.write('PASS = " + JSON.stringify(webrepl_password).slice(1, -1) + "\\n')\r\n" +
          "with open('/wifi_config.json', 'w') as f: f.write(" + JSON.stringify(JSON.stringify({ ssid, password: wifi_password })) + ")\r\n" +
          "boot_code = '''import network, time\\ntry:\\n import webrepl\\n webrepl.start()\\nexcept:\\n pass\\nw=network.WLAN(network.STA_IF)\\nw.active(True)\\nif not w.isconnected():\\n w.connect(" + JSON.stringify(ssid) + ", " + JSON.stringify(wifi_password) + ")\\n for _ in range(12):\\n  if w.isconnected(): break\\n  time.sleep(1)\\nif w.isconnected():\\n try:\\n  import webrepl\\n  webrepl.start()\\n except:\\n  pass\\n'''\r\n" +
          "with open('/boot.py', 'w') as f: f.write(boot_code)\r\n" +
          "w = network.WLAN(network.STA_IF); w.active(True); w.connect(" + JSON.stringify(ssid) + ", " + JSON.stringify(wifi_password) + ")\r\n" +
          "for _ in range(15):\r\n" +
          " if w.isconnected(): break\r\n" +
          " time.sleep(1)\r\n" +
          "if w.isconnected():\r\n" +
          " ip = w.ifconfig()[0]\r\n" +
          " print('\\n>>> [SUCCESS] Connected! IP:', ip, '| WebREPL ready at ws://' + ip + ':8266 <<<\\n')\r\n" +
          " try:\r\n" +
          "  import webrepl\r\n" +
          "  webrepl.start()\r\n" +
          " except:\r\n" +
          "  pass\r\n" +
          "else:\r\n" +
          " print('\\n>>> [FAILED] Could not connect to Wi-Fi. Check SSID/Password. <<<\\n')\r\n";

        window.App.sendWsInput(setupScript);

        const summary = document.getElementById("initialSetupSummary");
        if (summary) {
          summary.innerHTML = `✅ Provisioning command sent to ESP32! Connecting to <code>${ssid}</code>... Check <strong>1. Connect</strong> terminal to see assigned IP address.`;
        }
        window.App.toast("Setup command sent to ESP32! Check Terminal.");
        return;
      } catch (err) {
        window.App.toast("Setup Error: " + err.message, true);
        return;
      } finally {
        btn.disabled = false;
        btn.textContent = "1-Click Full Wi-Fi + WebREPL Setup";
      }
    }

    try {
      const res = await window.App.api("/api/wifi/initial-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, wifi_password, webrepl_password, install_ap_fallback }),
      });
      const ip = (res.webrepl?.ip && res.webrepl.ip !== "0.0.0.0") ? res.webrepl.ip : ((res.wifi?.ifconfig && res.wifi.ifconfig[0] !== "0.0.0.0") ? res.wifi.ifconfig[0] : null);
      const hint = document.getElementById("webreplTargetHint");
      const summary = document.getElementById("initialSetupSummary");
      if (ip) {
        hint.textContent = `ws://${ip}:8266 (Ready!)`;
        hint.dataset.ip = ip;
        summary.innerHTML = `✅ Uploaded <code>${res.files_uploaded.join(", ")}</code>. Ready for WebREPL at <code>ws://${ip}:8266</code> — click <strong>Use in Top Bar</strong> below!`;
        window.App.toast(`Initial Setup Complete! WebREPL ready at ws://${ip}:8266`);
      } else {
        const detail = res.wifi?.status_detail || "Check Wi-Fi password / 2.4 GHz router frequency.";
        summary.innerHTML = `⚠️ Config files uploaded (<code>${res.files_uploaded.join(", ")}</code>), but Wi-Fi did not connect:<br><strong style="color:var(--red)">${detail}</strong>`;
        window.App.toast(detail, true);
      }
      window.Learning.completeMission("wifi");
      await refreshStatus();
    } catch (err) {
      window.App.toast("Initial Setup Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "1-Click Full Wi-Fi + WebREPL Setup";
    }
  }

  function init() {
    document.getElementById("wifiStatusBtn")?.addEventListener("click", refreshStatus);
    document.getElementById("wifiScanBtn")?.addEventListener("click", scanWifi);
    document.getElementById("wifiConnectBtn")?.addEventListener("click", connectWifi);
    document.getElementById("initialSetupBtn")?.addEventListener("click", runInitialSetup);
    document.getElementById("startApBtn")?.addEventListener("click", startAp);
    document.getElementById("setupWebReplBtn")?.addEventListener("click", setupWebRepl);

    document.getElementById("switchWebReplBtn")?.addEventListener("click", () => {
      const hint = document.getElementById("webreplTargetHint");
      const ip = (hint ? hint.dataset.ip || hint.textContent.match(/\d+\.\d+\.\d+\.\d+/)?.[0] : null) || "192.168.1.11";
      const pwInput = document.getElementById("webreplSetupPass");
      const pw = pwInput ? pwInput.value || "12346789" : "12346789";
      const connMode = document.getElementById("connMode");
      if (connMode) {
        connMode.value = "webrepl";
        connMode.dispatchEvent(new Event("change"));
      }
      const hostIn = document.getElementById("webreplHostInput");
      const passIn = document.getElementById("webreplPassInput");
      if (ip && hostIn) hostIn.value = ip;
      if (passIn) passIn.value = pw;
      window.App.switchTab?.("terminal");
      window.App.toast(`Switched Top Bar to WebREPL (ws://${ip}:8266) — click Connect!`);
    });
  }

  window.WifiUI = { init, refreshStatus };
})();
