/**
 * ESP32 Web Console - Step 1: USB Serial Connection & Serial Monitor
 */

// UI Elements
const portSelect = document.getElementById("portSelect");
const baudRateSelect = document.getElementById("baudRateSelect");
const refreshPortsBtn = document.getElementById("refreshPortsBtn");
const connectBtn = document.getElementById("connectBtn");
const stopBtn = document.getElementById("stopBtn");
const softResetBtn = document.getElementById("softResetBtn");
const resetBtn = document.getElementById("resetBtn");
const clearTermBtn = document.getElementById("clearTermBtn");
const terminal = document.getElementById("terminal");
const cmdForm = document.getElementById("cmdForm");
const cmdInput = document.getElementById("cmdInput");
const sendBtn = document.getElementById("sendBtn");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const termStatus = document.getElementById("termStatus");
const themeToggleBtn = document.getElementById("themeToggleBtn");

// State
let isConnected = false;
let ws = null;
let commandHistory = [];
let historyIndex = -1;

// -------------------- Terminal Functions --------------------

function appendTerminal(text) {
  if (!text) return;
  terminal.textContent += text;
  // Keep scroll pinned to bottom
  terminal.scrollTop = terminal.scrollHeight;
}

function clearTerminal() {
  terminal.textContent = "";
}

// -------------------- Port Discovery --------------------

async function fetchPorts() {
  try {
    refreshPortsBtn.disabled = true;
    refreshPortsBtn.textContent = "Scanning...";
    const res = await fetch("/api/ports");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const previousVal = portSelect.value;
    portSelect.innerHTML = "";

    const ports = data.ports || [];
    if (ports.length === 0 && !data.simulator) {
      portSelect.innerHTML = `<option value="">No serial devices detected</option>`;
      return;
    }

    let defaultOption = "";

    // Real serial ports
    ports.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.port;
      const label = `${p.port} - ${p.chip_hint || p.description || "Serial Device"}`;
      opt.textContent = label;
      if (p.likely_esp32 && !defaultOption) {
        defaultOption = p.port;
      }
      portSelect.appendChild(opt);
    });

    // Built-in Simulator
    if (data.simulator) {
      const simOpt = document.createElement("option");
      simOpt.value = data.simulator.port;
      simOpt.textContent = `💻 ${data.simulator.port} (${data.simulator.description})`;
      portSelect.appendChild(simOpt);
    }

    // Preserve previously selected port or choose likely ESP32
    if (previousVal && Array.from(portSelect.options).some((o) => o.value === previousVal)) {
      portSelect.value = previousVal;
    } else if (defaultOption) {
      portSelect.value = defaultOption;
    }

    termStatus.textContent = `${ports.length} port(s) detected`;
  } catch (err) {
    console.error("Failed to fetch ports:", err);
    portSelect.innerHTML = `<option value="">Error scanning ports</option>`;
    termStatus.textContent = "Error scanning ports";
  } finally {
    refreshPortsBtn.disabled = false;
    refreshPortsBtn.textContent = "🔄 Refresh";
  }
}

// -------------------- Connection Management --------------------

function setConnectionState(connected, target = "") {
  isConnected = connected;

  if (connected) {
    statusBadge.className = "status-badge connected";
    statusText.textContent = `Connected: ${target || "ESP32"}`;
    connectBtn.textContent = "Disconnect";
    connectBtn.className = "btn btn-danger";

    portSelect.disabled = true;
    baudRateSelect.disabled = true;
    refreshPortsBtn.disabled = true;

    stopBtn.disabled = false;
    softResetBtn.disabled = false;
    resetBtn.disabled = false;
    cmdInput.disabled = false;
    sendBtn.disabled = false;

    termStatus.textContent = `Active stream: ${target}`;
    cmdInput.focus();
  } else {
    statusBadge.className = "status-badge disconnected";
    statusText.textContent = "Disconnected";
    connectBtn.textContent = "Connect";
    connectBtn.className = "btn btn-primary";

    portSelect.disabled = false;
    baudRateSelect.disabled = false;
    refreshPortsBtn.disabled = false;

    stopBtn.disabled = true;
    softResetBtn.disabled = true;
    resetBtn.disabled = true;
    cmdInput.disabled = true;
    sendBtn.disabled = true;

    termStatus.textContent = "Terminal Ready (Offline)";
  }
}

async function handleConnectToggle() {
  if (isConnected) {
    // Disconnect
    try {
      connectBtn.disabled = true;
      connectBtn.textContent = "Disconnecting...";
      await fetch("/api/disconnect", { method: "POST" });
      appendTerminal("\n[System] Disconnected from device.\n");
    } catch (err) {
      console.error("Disconnect error:", err);
    } finally {
      connectBtn.disabled = false;
      setConnectionState(false);
    }
  } else {
    // Connect
    const target = portSelect.value;
    if (!target) {
      alert("Please select a valid serial port or SIMULATOR first.");
      return;
    }
    const baudrate = parseInt(baudRateSelect.value, 10) || 115200;
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

      appendTerminal(`\n[System] Connected to ${target} @ ${baudrate} baud.\n`);
      setConnectionState(true, target);
      initWebSocket();
    } catch (err) {
      alert(`Connection failed: ${err.message}`);
      appendTerminal(`\n[System Error] ${err.message}\n`);
      setConnectionState(false);
    } finally {
      connectBtn.disabled = false;
    }
  }
}

// -------------------- Control Actions --------------------

async function sendControlAction(action) {
  if (!isConnected) return;
  try {
    const res = await fetch(`/api/control/${action}`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.detail || "Action failed");
    }
  } catch (err) {
    appendTerminal(`\n[Control Error] ${err.message}\n`);
  }
}

// -------------------- Terminal Command Input --------------------

function handleCommandSubmit(e) {
  if (e) e.preventDefault();
  const text = cmdInput.value;
  if (!isConnected) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "input", data: text + "\r\n" }));
  }

  if (text.trim()) {
    commandHistory.push(text);
    historyIndex = commandHistory.length;
  }
  cmdInput.value = "";
}

// Keyboard history browsing (Up/Down arrows)
cmdInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") {
    if (historyIndex > 0) {
      historyIndex--;
      cmdInput.value = commandHistory[historyIndex];
    }
    e.preventDefault();
  } else if (e.key === "ArrowDown") {
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      cmdInput.value = commandHistory[historyIndex];
    } else {
      historyIndex = commandHistory.length;
      cmdInput.value = "";
    }
    e.preventDefault();
  } else if (e.key === "c" && e.ctrlKey) {
    e.preventDefault();
    sendControlAction("interrupt");
  } else if (e.key === "d" && e.ctrlKey) {
    e.preventDefault();
    sendControlAction("soft_reset");
  }
});

// -------------------- WebSocket Stream --------------------

function initWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${window.location.host}/ws/console`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("WebSocket console connected");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "term") {
        appendTerminal(msg.data);
      } else if (msg.type === "state") {
        if (msg.data && typeof msg.data.connected === "boolean") {
          if (msg.data.connected !== isConnected) {
            setConnectionState(msg.data.connected, msg.data.target);
          }
        }
      }
    } catch (err) {
      console.error("WS Parse error:", err);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket console closed");
  };

  ws.onerror = (err) => {
    console.error("WebSocket console error:", err);
  };
}

// -------------------- Theme Toggle --------------------

function initTheme() {
  const saved = localStorage.getItem("esp32_theme");
  if (saved === "light") {
    document.body.classList.add("light");
  }
  themeToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("light");
    const isLight = document.body.classList.contains("light");
    localStorage.setItem("esp32_theme", isLight ? "light" : "dark");
  });
}

// -------------------- Event Listeners --------------------

refreshPortsBtn.addEventListener("click", fetchPorts);
connectBtn.addEventListener("click", handleConnectToggle);
cmdForm.addEventListener("submit", handleCommandSubmit);
clearTermBtn.addEventListener("click", clearTerminal);

stopBtn.addEventListener("click", () => sendControlAction("interrupt"));
softResetBtn.addEventListener("click", () => sendControlAction("soft_reset"));
resetBtn.addEventListener("click", () => sendControlAction("hard_reset"));

// -------------------- Initialization --------------------

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  appendTerminal("Welcome to ESP32 Web Console!\nSelect your port (e.g. /dev/ttyUSB0) and click Connect.\n--------------------------------------------------\n");
  fetchPorts();
  initWebSocket();
});
