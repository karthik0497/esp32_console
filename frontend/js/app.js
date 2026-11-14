/**
 * ESP32 Active-Learning Console — Clean App Shell
 * Feature 1: Exact Original Device Connection (USB / WebREPL, Ports Dropdown, Baud Rate, Connect & Controls)
 */

(function () {
  let ws = null;
  let currentStatus = { connected: false, state: "DISCONNECTED", capabilities: {} };

  // Toast notification
  function toast(msg, isError = false) {
    const box = document.getElementById("toastContainer");
    if (!box) return;
    const el = document.createElement("div");
    el.className = `toast ${isError ? "error" : ""}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
  window.toast = toast;

  // API helper
  async function api(url, opts = {}) {
    const resp = await fetch(url, opts);
    const contentType = resp.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await resp.json() : await resp.text();
    if (!resp.ok) {
      throw new Error((data && data.detail) || (typeof data === "string" ? data : "Request failed"));
    }
    return data;
  }

  // Tab switching
  function switchTab(tabId) {
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-pane").forEach((p) => {
      p.classList.toggle("active", p.id === tabId);
    });
  }
  window.switchTab = switchTab;

  // Status & Button state updates
  function updateStatusUI(s) {
    currentStatus = s || currentStatus;
    const pill = document.getElementById("statusPill");
    const label = document.getElementById("statusText");
    if (!pill || !label) return;

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
    if (connBtn) {
      connBtn.textContent = s.connected ? "Disconnect" : "Connect";
      connBtn.classList.toggle("btn-danger", Boolean(s.connected));
      connBtn.classList.toggle("btn-primary", !s.connected);
      connBtn.disabled = false;
    }

    const portSelect = document.getElementById("portSelect");
    const baudSelect = document.getElementById("baudSelect");
    const refreshPortsBtn = document.getElementById("refreshPortsBtn");
    const connMode = document.getElementById("connMode");
    if (portSelect) portSelect.disabled = Boolean(s.connected);
    if (baudSelect) baudSelect.disabled = Boolean(s.connected);
    if (refreshPortsBtn) refreshPortsBtn.disabled = Boolean(s.connected);
    if (connMode) connMode.disabled = Boolean(s.connected);

    const caps = s.capabilities || {};
    const stopBtn = document.getElementById("stopBtn");
    const forceStopBtn = document.getElementById("forceStopBtn");
    const softResetBtn = document.getElementById("softResetBtn");
    const hardResetBtn = document.getElementById("hardResetBtn");
    const safeRecoveryBtn = document.getElementById("safeRecoveryBtn");

    if (stopBtn) stopBtn.disabled = !s.connected;
    if (forceStopBtn) forceStopBtn.disabled = !s.connected;
    if (softResetBtn) softResetBtn.disabled = !s.connected;
    if (hardResetBtn) hardResetBtn.disabled = !s.connected || !caps.hard_reset;
    if (safeRecoveryBtn) safeRecoveryBtn.disabled = !s.connected;

    document.body.classList.toggle("device-connected", Boolean(s.connected));
  }

  // Refresh Ports Dropdown
  async function refreshPorts() {
    try {
      const refreshBtn = document.getElementById("refreshPortsBtn");
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "↻ Scanning...";
      }

      const data = await api("/api/ports");
      const sel = document.getElementById("portSelect");
      if (!sel) return;

      const prev = sel.value;
      const options = [];

      for (const p of data.ports || []) {
        options.push(`<option value="${p.port}">${p.port} — ${p.chip_hint || p.description}</option>`);
      }
      if (data.simulator) {
        options.push(`<option value="SIMULATOR">SIMULATOR — Virtual Demo ESP32-S3 (No Hardware Needed)</option>`);
      }

      sel.innerHTML = options.join("");
      if (prev && [...sel.options].some((o) => o.value === prev)) {
        sel.value = prev;
      } else if (!(data.ports || []).length && data.simulator) {
        sel.value = "SIMULATOR";
      }

      if (data.status) {
        updateStatusUI(data.status);
      }
    } catch (err) {
      toast(`Port scan error: ${err.message}`, true);
    } finally {
      const refreshBtn = document.getElementById("refreshPortsBtn");
      if (refreshBtn) {
        refreshBtn.disabled = Boolean(currentStatus.connected);
        refreshBtn.textContent = "↻ Refresh";
      }
    }
  }

  // Connect / Disconnect Toggle
  async function toggleConnect() {
    const connBtn = document.getElementById("connectBtn");
    if (currentStatus.connected) {
      if (connBtn) {
        connBtn.disabled = true;
        connBtn.textContent = "Disconnecting...";
      }
      try {
        await api("/api/disconnect", { method: "POST" });
        toast("Disconnected cleanly.");
        updateStatusUI({ connected: false, state: "DISCONNECTED", target: "" });
      } catch (err) {
        toast(`Disconnect failed: ${err.message}`, true);
        if (connBtn) connBtn.disabled = false;
      }
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
      if (!portVal) return toast("Select a serial port first.", true);
      payload.mode = portVal === "SIMULATOR" ? "simulator" : "serial";
      payload.target = portVal;
      payload.baudrate = Number(document.getElementById("baudSelect").value || 115200);
    }

    try {
      if (connBtn) {
        connBtn.disabled = true;
        connBtn.textContent = "Connecting...";
      }
      const status = await api("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      updateStatusUI(status);
      toast(`Connected to ${status.target}!`);
    } catch (err) {
      toast(`Connection failed: ${err.message}`, true);
      updateStatusUI({ connected: false, state: "DISCONNECTED", target: "" });
    }
  }

  // Execution Control Handlers
  async function runControl(action) {
    try {
      await api(`/api/control/${action}`, { method: "POST" });
      if (action === "interrupt") {
        toast("Sent interrupt (Ctrl+C).");
      } else if (action === "aggressive_interrupt") {
        toast("Sent aggressive interrupt (Force Stop).");
      } else if (action === "soft_reset") {
        toast("Soft rebooting ESP32 (Ctrl+D)...");
      } else if (action === "hard_reset") {
        toast("Hard resetting ESP32 via EN/RTS line...");
      } else if (action === "safe_recovery") {
        toast("Safe Recovery mode triggered.");
      }
    } catch (err) {
      toast(`Control error: ${err.message}`, true);
    }
  }

  // WebSocket Connection
  function initWebSocket() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws/console`;
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state" && msg.data) {
          updateStatusUI(msg.data);
        } else if (msg.type === "alert" && msg.data) {
          showAlert(msg.data.message || "Alert detected");
        }
      } catch (err) {
        console.error("WS Parse error:", err);
      }
    };

    ws.onclose = () => {
      setTimeout(initWebSocket, 2500);
    };
  }

  // Alert Banner
  function showAlert(msg) {
    const banner = document.getElementById("alertBanner");
    const text = document.getElementById("alertText");
    if (banner && text) {
      text.textContent = msg;
      banner.classList.remove("hidden");
    }
  }

  // Theme Toggle
  function initTheme() {
    const btn = document.getElementById("themeToggleBtn");
    const saved = localStorage.getItem("esp32_theme");
    if (saved === "light") {
      document.body.classList.add("light-theme");
    }
    if (btn) {
      btn.addEventListener("click", () => {
        document.body.classList.toggle("light-theme");
        const isLight = document.body.classList.contains("light-theme");
        localStorage.setItem("esp32_theme", isLight ? "light" : "dark");
      });
    }
  }

  // Initialization
  window.addEventListener("DOMContentLoaded", () => {
    initTheme();

    // Tab buttons
    document.querySelectorAll(".sidebar .nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.tab) {
          switchTab(btn.dataset.tab);
        }
      });
    });

    // Alert dismiss
    const dismissBtn = document.getElementById("dismissAlertBtn");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", () => {
        document.getElementById("alertBanner").classList.add("hidden");
      });
    }

    // Mode Selector (USB Serial vs WebREPL)
    const connMode = document.getElementById("connMode");
    if (connMode) {
      connMode.addEventListener("change", (e) => {
        const isWeb = e.target.value === "webrepl";
        const serialInputs = document.getElementById("serialInputs");
        const webreplInputs = document.getElementById("webreplInputs");
        if (serialInputs) serialInputs.style.display = isWeb ? "none" : "flex";
        if (webreplInputs) webreplInputs.style.display = isWeb ? "flex" : "none";
      });
    }

    // Port refresh and connect
    const refreshPortsBtn = document.getElementById("refreshPortsBtn");
    if (refreshPortsBtn) refreshPortsBtn.addEventListener("click", refreshPorts);

    const connectBtn = document.getElementById("connectBtn");
    if (connectBtn) connectBtn.addEventListener("click", toggleConnect);

    // Board controls
    const stopBtn = document.getElementById("stopBtn");
    if (stopBtn) stopBtn.addEventListener("click", () => runControl("interrupt"));

    const forceStopBtn = document.getElementById("forceStopBtn");
    if (forceStopBtn) forceStopBtn.addEventListener("click", () => runControl("aggressive_interrupt"));

    const softResetBtn = document.getElementById("softResetBtn");
    if (softResetBtn) softResetBtn.addEventListener("click", () => runControl("soft_reset"));

    const hardResetBtn = document.getElementById("hardResetBtn");
    if (hardResetBtn) hardResetBtn.addEventListener("click", () => runControl("hard_reset"));

    const safeRecoveryBtn = document.getElementById("safeRecoveryBtn");
    if (safeRecoveryBtn) safeRecoveryBtn.addEventListener("click", () => runControl("safe_recovery"));

    // Initial load
    refreshPorts();
    initWebSocket();
  });
})();
