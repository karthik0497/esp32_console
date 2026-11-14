/**
 * ESP32 Active-Learning Console — App Logic
 * Feature 1: USB Connection & Live Status Display (Connected or Not Connected)
 */

(function () {
  let ws = null;
  let isConnected = false;
  let currentTarget = "";
  let currentBaud = 115200;

  // DOM Elements
  const portSelect = document.getElementById("portSelect");
  const baudSelect = document.getElementById("baudSelect");
  const refreshPortsBtn = document.getElementById("refreshPortsBtn");
  const connectBtn = document.getElementById("connectBtn");

  const connectionStatusBox = document.getElementById("connectionStatusBox");
  const connectionStateLabel = document.getElementById("connectionStateLabel");
  const connectionStateHint = document.getElementById("connectionStateHint");

  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const toastContainer = document.getElementById("toastContainer");

  // Toast Helper
  function toast(msg, isError = false) {
    if (!toastContainer) return;
    const el = document.createElement("div");
    el.className = `toast ${isError ? "error" : ""}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
  window.toast = toast;

  // Tab Switching
  function switchTab(tabId) {
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-pane").forEach((p) => {
      p.classList.toggle("active", p.id === tabId);
    });
  }
  window.switchTab = switchTab;

  // -------------------- Update Connection UI --------------------
  function updateConnectionUI(connected, target = "", baudrate = 115200) {
    isConnected = Boolean(connected);
    currentTarget = target;
    currentBaud = baudrate;

    // 1. Topbar Status Pill
    if (statusPill && statusText) {
      statusPill.className = `status-pill state-${isConnected ? "CONNECTED" : "DISCONNECTED"}`;
      statusText.textContent = isConnected
        ? `Connected • ${currentTarget || "ESP32"}`
        : "Disconnected";
    }

    // 2. Connect Button
    if (connectBtn) {
      connectBtn.textContent = isConnected ? "Disconnect" : "Connect";
      connectBtn.className = isConnected
        ? "btn btn-danger btn-connect"
        : "btn btn-primary btn-connect";
      connectBtn.disabled = false;
    }

    // 3. Form Inputs
    if (portSelect) portSelect.disabled = isConnected;
    if (baudSelect) baudSelect.disabled = isConnected;
    if (refreshPortsBtn) refreshPortsBtn.disabled = isConnected;

    // 4. Prominent Status Box in Tab 1
    if (connectionStatusBox && connectionStateLabel && connectionStateHint) {
      if (isConnected) {
        connectionStatusBox.className = "connection-status-box connected";
        connectionStateLabel.textContent = "Connected";
        connectionStateHint.textContent = `Connected to ${currentTarget} @ ${currentBaud} baud. Serial communication line is open and active.`;
      } else {
        connectionStatusBox.className = "connection-status-box disconnected";
        connectionStateLabel.textContent = "Not Connected";
        connectionStateHint.textContent = "Select your serial port (e.g. /dev/ttyUSB0) and click Connect.";
      }
    }

    document.body.classList.toggle("device-connected", isConnected);
  }

  // -------------------- Port Discovery --------------------
  async function fetchPorts() {
    try {
      if (refreshPortsBtn) {
        refreshPortsBtn.disabled = true;
        refreshPortsBtn.textContent = "↻ Scanning...";
      }

      const res = await fetch("/api/ports");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const prev = portSelect.value;
      portSelect.innerHTML = "";

      const ports = data.ports || [];
      let defaultPort = "";

      ports.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.port;
        opt.textContent = `${p.port} - ${p.chip_hint || p.description || "Serial Device"}`;
        if (p.likely_esp32 && !defaultPort) {
          defaultPort = p.port;
        }
        portSelect.appendChild(opt);
      });

      if (data.simulator) {
        const simOpt = document.createElement("option");
        simOpt.value = data.simulator.port;
        simOpt.textContent = `💻 ${data.simulator.port} (${data.simulator.description})`;
        portSelect.appendChild(simOpt);
      }

      if (ports.length === 0 && !data.simulator) {
        portSelect.innerHTML = `<option value="">No serial devices detected</option>`;
      } else if (prev && Array.from(portSelect.options).some((o) => o.value === prev)) {
        portSelect.value = prev;
      } else if (defaultPort) {
        portSelect.value = defaultPort;
      }

      // Check current status from server
      if (data.status && typeof data.status.connected === "boolean") {
        updateConnectionUI(data.status.connected, data.status.target);
      }
    } catch (err) {
      console.error("Port discovery error:", err);
      portSelect.innerHTML = `<option value="">Error scanning ports</option>`;
    } finally {
      if (refreshPortsBtn) {
        refreshPortsBtn.disabled = isConnected;
        refreshPortsBtn.textContent = "↻ Refresh";
      }
    }
  }

  // -------------------- Connect / Disconnect Toggle --------------------
  async function handleConnectToggle() {
    if (isConnected) {
      // Disconnect
      try {
        connectBtn.disabled = true;
        connectBtn.textContent = "Disconnecting...";
        const res = await fetch("/api/disconnect", { method: "POST" });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || "Disconnect failed");
        }
        toast("Disconnected from ESP32.");
        updateConnectionUI(false);
      } catch (err) {
        toast(`Disconnect error: ${err.message}`, true);
        connectBtn.disabled = false;
      }
    } else {
      // Connect
      const target = portSelect.value;
      if (!target) {
        toast("Please select a serial port or SIMULATOR first.", true);
        return;
      }
      const baudrate = parseInt(baudSelect.value, 10) || 115200;
      const mode = target === "SIMULATOR" ? "simulator" : "serial";

      try {
        connectBtn.disabled = true;
        connectBtn.textContent = "Connecting...";

        const res = await fetch("/api/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, target, baudrate }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || "Connection failed");
        }

        toast(`Connected to ${target} @ ${baudrate} baud.`);
        updateConnectionUI(true, target, baudrate);
      } catch (err) {
        toast(`Connection failed: ${err.message}`, true);
        updateConnectionUI(false);
      }
    }
  }

  // -------------------- WebSocket Connection --------------------
  function initWebSocket() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws/console`;
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state" && msg.data) {
          updateConnectionUI(
            msg.data.connected,
            msg.data.target,
            currentBaud
          );
        }
      } catch (err) {
        console.error("WS Parse error:", err);
      }
    };

    ws.onclose = () => {
      setTimeout(initWebSocket, 2500);
    };
  }

  // -------------------- Theme Toggle --------------------
  function initTheme() {
    const saved = localStorage.getItem("esp32_theme");
    if (saved === "light") {
      document.body.classList.add("light-theme");
    }
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener("click", () => {
        document.body.classList.toggle("light-theme");
        const isLight = document.body.classList.contains("light-theme");
        localStorage.setItem("esp32_theme", isLight ? "light" : "dark");
      });
    }
  }

  // -------------------- Initialization --------------------
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

    if (refreshPortsBtn) refreshPortsBtn.addEventListener("click", fetchPorts);
    if (connectBtn) connectBtn.addEventListener("click", handleConnectToggle);

    fetchPorts();
    initWebSocket();
  });
})();
