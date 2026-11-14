/* Main App Shell: Connection Manager, WebSocket Stream, State Pill, Tabs & Toasts */

(function () {
  let ws = null;
  let currentStatus = { connected: false, state: "DISCONNECTED", capabilities: {} };

  function toast(msg, isError = false) {
    const box = document.getElementById("toastContainer");
    const el = document.createElement("div");
    el.className = `toast ${isError ? "error" : ""}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function api(url, opts = {}) {
    const resp = await fetch(url, opts);
    const contentType = resp.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await resp.json() : await resp.text();
    if (!resp.ok) {
      throw new Error((data && data.detail) || (typeof data === "string" ? data : "Request failed"));
    }
    return data;
  }

  function switchTab(tabId) {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === tabId));
  }

  function updateStatusUI(s) {
    currentStatus = s || currentStatus;
    const pill = document.getElementById("statusPill");
    const label = document.getElementById("statusText");
    pill.className = `status-pill state-${s.state || "DISCONNECTED"}`;

    const niceNames = {
      DISCONNECTED: "Disconnected",
      CONNECTED: "Connected",
      IDLE_REPL: "Idle at REPL (>>>)",
      RUNNING_MAIN: "Running main.py",
      BOOTLOADER: "Bootloader Mode",
      ERROR: "Crash / Error Detected",
    };
    label.textContent = `${niceNames[s.state] || s.state}${s.target && s.connected ? " • " + s.target : ""}`;

    const connBtn = document.getElementById("connectBtn");
    connBtn.textContent = s.connected ? "Disconnect" : "Connect";
    connBtn.classList.toggle("btn-danger", s.connected);
    connBtn.classList.toggle("btn-primary", !s.connected);

    const caps = s.capabilities || {};
    document.getElementById("stopBtn").disabled = !s.connected;
    document.getElementById("forceStopBtn").disabled = !s.connected;
    document.getElementById("softResetBtn").disabled = !s.connected;
    document.getElementById("hardResetBtn").disabled = !s.connected || !caps.hard_reset;
    document.getElementById("safeRecoveryBtn").disabled = !s.connected;

    if (s.connected) window.Learning.completeMission("connect");
    if (s.last_metric) window.MetricsUI.updateView(s.last_metric);
  }

  async function refreshPorts() {
    try {
      const data = await api("/api/ports");
      const sel = document.getElementById("portSelect");
      const prev = sel.value;
      const options = [];
      for (const p of data.ports || []) {
        options.push(`<option value="${p.port}">${p.port} — ${p.chip_hint}</option>`);
      }
      if (data.simulator) {
        options.push(`<option value="SIMULATOR">SIMULATOR — Virtual Demo ESP32-S3 (No Hardware Needed)</option>`);
      }
      sel.innerHTML = options.join("");
      if (prev && [...sel.options].some((o) => o.value === prev)) {
        sel.value = prev;
      } else if (!(data.ports || []).length) {
        sel.value = "SIMULATOR";
      }
      window.FlasherUI.populatePorts(data.ports, data.simulator);
      if (data.status) updateStatusUI(data.status);
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function toggleConnect() {
    if (currentStatus.connected) {
      await api("/api/disconnect", { method: "POST" });
      toast("Disconnected cleanly.");
      return;
    }
    const mode = document.getElementById("connMode").value;
    let payload = { mode };
    if (mode === "webrepl") {
      payload.target = document.getElementById("webreplHostInput").value.trim();
      payload.password = document.getElementById("webreplPassInput").value;
      if (!payload.target) return toast("Enter ESP32 IP address for WebREPL.", true);
    } else {
      const portVal = document.getElementById("portSelect").value;
      payload.mode = portVal === "SIMULATOR" ? "simulator" : "serial";
      payload.target = portVal;
      payload.baudrate = Number(document.getElementById("baudSelect").value || 115200);
    }
    try {
      const status = await api("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      updateStatusUI(status);
      toast(`Connected to ${status.target}!`);
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function runControl(action) {
    try {
      await api(`/api/control/${action}`, { method: "POST" });
      if (action === "interrupt" || action === "aggressive_interrupt") {
        window.Learning.completeMission("stop");
      }
      if (action === "safe_recovery_disable_main") {
        toast("Safe Recovery complete! /main.py renamed to /main.py.bak");
      }
    } catch (err) {
      toast(err.message, true);
    }
  }

  function showAlert(alert) {
    const banner = document.getElementById("alertBanner");
    document.getElementById("alertText").innerHTML = `<strong>${alert.title}:</strong> ${alert.summary} <em>(${alert.fix})</em>`;
    banner.classList.remove("hidden");
  }

  function connectWebSocket() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws/console`);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "term") window.TerminalUI.append(msg.data);
      else if (msg.type === "state") updateStatusUI(msg.data);
      else if (msg.type === "xray") window.Learning.pushXray(msg.data);
      else if (msg.type === "metric") window.MetricsUI.updateView(msg.data);
      else if (msg.type === "flash") window.FlasherUI.handleProgress(msg.data);
      else if (msg.type === "alert") showAlert(msg.data);
    };
    ws.onclose = () => {
      setTimeout(connectWebSocket, 1500);
    };
  }

  function sendWsInput(text) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data: text }));
    }
  }

  function init() {
    window.Learning.init();
    window.TerminalUI.init();
    window.FilesUI.init();
    window.WifiUI.init();
    window.MetricsUI.init();
    window.FlasherUI.init();

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    const connMode = document.getElementById("connMode");
    connMode.addEventListener("change", () => {
      const isWeb = connMode.value === "webrepl";
      document.getElementById("serialInputs").style.display = isWeb ? "none" : "inline-flex";
      document.getElementById("webreplInputs").style.display = isWeb ? "inline-flex" : "none";
    });

    document.getElementById("refreshPortsBtn").addEventListener("click", refreshPorts);
    document.getElementById("connectBtn").addEventListener("click", toggleConnect);
    document.getElementById("stopBtn").addEventListener("click", () => runControl("interrupt"));
    document.getElementById("forceStopBtn").addEventListener("click", () => runControl("aggressive_interrupt"));
    document.getElementById("softResetBtn").addEventListener("click", () => runControl("soft_reset"));
    document.getElementById("hardResetBtn").addEventListener("click", () => runControl("hard_reset"));
    document.getElementById("safeRecoveryBtn").addEventListener("click", () => {
      const disable = confirm("Do you also want to rename /main.py -> /main.py.bak so a runaway loop won't freeze on next boot?\n\nClick OK to rename main.py, or Cancel to just reset & stop.");
      runControl(disable ? "safe_recovery_disable_main" : "safe_recovery");
    });

    document.getElementById("dismissAlertBtn").addEventListener("click", () => {
      document.getElementById("alertBanner").classList.add("hidden");
    });

    document.getElementById("themeToggleBtn").addEventListener("click", () => {
      document.body.classList.toggle("light-theme");
    });

    refreshPorts();
    connectWebSocket();
  }

  window.App = { api, toast, switchTab, sendWsInput, refreshPorts };
  document.addEventListener("DOMContentLoaded", init);
})();

