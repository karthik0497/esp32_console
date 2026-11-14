/**
 * ESP32 Web Console - Step 1: ESP32 Initial Setup & Firmware Preparation
 */

// DOM Elements - Port & Probe
const portSelect = document.getElementById("portSelect");
const refreshPortsBtn = document.getElementById("refreshPortsBtn");
const probeBaudSelect = document.getElementById("probeBaudSelect");
const probeBtn = document.getElementById("probeBtn");
const specChip = document.getElementById("specChip");
const specMac = document.getElementById("specMac");
const specFlash = document.getElementById("specFlash");
const specCrystal = document.getElementById("specCrystal");

// DOM Elements - Flashing
const firmwareSourceSelect = document.getElementById("firmwareSourceSelect");
const flashBaudSelect = document.getElementById("flashBaudSelect");
const customFileSection = document.getElementById("customFileSection");
const customBinFile = document.getElementById("customBinFile");
const customOffset = document.getElementById("customOffset");
const eraseFirstCheck = document.getElementById("eraseFirstCheck");
const flashBtn = document.getElementById("flashBtn");
const eraseOnlyBtn = document.getElementById("eraseOnlyBtn");

const progressContainer = document.getElementById("progressContainer");
const progressBarFill = document.getElementById("progressBarFill");
const progressStatusText = document.getElementById("progressStatusText");
const progressPercentText = document.getElementById("progressPercentText");
const flasherLog = document.getElementById("flasherLog");
const flashSuccessBanner = document.getElementById("flashSuccessBanner");

// DOM Elements - Sidebar & Theme
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const themeToggleBtn = document.getElementById("themeToggleBtn");

let ws = null;

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

    if (previousVal && Array.from(portSelect.options).some((o) => o.value === previousVal)) {
      portSelect.value = previousVal;
    } else if (defaultPort) {
      portSelect.value = defaultPort;
    }

    updateStatusBadge(portSelect.value ? "Ready to Probe" : "No Board Detected", false);
  } catch (err) {
    console.error("Port discovery error:", err);
    portSelect.innerHTML = `<option value="">Error scanning ports</option>`;
  } finally {
    refreshPortsBtn.disabled = false;
    refreshPortsBtn.textContent = "🔄 Refresh";
  }
}

// -------------------- Chip Silicon Probe --------------------

async function probeHardware() {
  const port = portSelect.value;
  if (!port) {
    alert("Please select a serial port first.");
    return;
  }
  const baud = parseInt(probeBaudSelect.value, 10) || 115200;

  try {
    probeBtn.disabled = true;
    probeBtn.textContent = "Probing...";
    specChip.textContent = "Detecting...";
    specMac.textContent = "Reading...";
    specFlash.textContent = "Checking...";
    specCrystal.textContent = "Checking...";

    const res = await fetch("/api/flash/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port, baud }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Probe failed");
    }

    specChip.textContent = data.chip || "ESP32";
    specMac.textContent = data.mac || "Unknown";
    specFlash.textContent = data.flash_size || "Unknown";
    specCrystal.textContent = data.crystal || "40MHz";

    updateStatusBadge(`Probed: ${data.chip}`, true);
  } catch (err) {
    alert(`Hardware probe failed: ${err.message}\n\nTip: On some boards, hold the 'BOOT' button while clicking Probe.`);
    specChip.textContent = "Probe Failed";
    specMac.textContent = "--";
    specFlash.textContent = "--";
    specCrystal.textContent = "--";
    updateStatusBadge("Probe Failed", false);
  } finally {
    probeBtn.disabled = false;
    probeBtn.textContent = "🔍 Probe Hardware";
  }
}

// -------------------- Flasher UI Helpers --------------------

function setProgress(pct, status) {
  progressContainer.classList.add("active");
  flasherLog.style.display = "block";
  if (pct !== null && pct !== undefined) {
    const clamped = Math.max(0, Math.min(100, pct));
    progressBarFill.style.width = `${clamped}%`;
    progressPercentText.textContent = `${clamped}%`;
  }
  if (status) {
    progressStatusText.textContent = status;
  }
}

function appendLog(line) {
  if (!line) return;
  flasherLog.textContent += line + "\n";
  flasherLog.scrollTop = flasherLog.scrollHeight;
}

function clearLog() {
  flasherLog.textContent = "";
  flashSuccessBanner.classList.remove("active");
}

// -------------------- Firmware Flashing --------------------

firmwareSourceSelect.addEventListener("change", () => {
  if (firmwareSourceSelect.value === "custom") {
    customFileSection.style.display = "flex";
    flashBtn.textContent = "⚡ Flash Custom Firmware";
  } else {
    customFileSection.style.display = "none";
    flashBtn.textContent = "⚡ Install MicroPython";
  }
});

async function handleFlash() {
  const port = portSelect.value;
  if (!port) {
    alert("Please select a serial port first.");
    return;
  }
  const baud = parseInt(flashBaudSelect.value, 10) || 460800;
  const eraseFirst = eraseFirstCheck.checked;
  const source = firmwareSourceSelect.value;

  clearLog();
  setProgress(5, "Initializing esptool flasher...");

  try {
    flashBtn.disabled = true;
    eraseOnlyBtn.disabled = true;
    probeBtn.disabled = true;

    if (source === "bundled") {
      appendLog(`[Flasher] Starting 1-click MicroPython installation on ${port}...`);
      appendLog(`[Flasher] Speed: ${baud} baud | Erase first: ${eraseFirst}\n`);

      const res = await fetch("/api/flash/install-bundled-micropython", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port, baud, erase_first: eraseFirst }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Flashing failed");
      }

      setProgress(100, "Installation Complete!");
      flashSuccessBanner.classList.add("active");
      updateStatusBadge("MicroPython Ready", true);
    } else {
      // Custom firmware upload
      const file = customBinFile.files[0];
      if (!file) {
        alert("Please select a .bin firmware file to upload.");
        return;
      }
      const offset = customOffset.value.trim() || "0x1000";

      appendLog(`[Flasher] Flashing custom file '${file.name}' at offset ${offset}...`);
      const form = new FormData();
      form.append("port", port);
      form.append("chip", "auto");
      form.append("baud", baud.toString());
      form.append("erase_first", eraseFirst.toString());
      form.append("offsets_json", JSON.stringify([offset]));
      form.append("files", file);

      const res = await fetch("/api/flash/write", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Flashing failed");
      }

      setProgress(100, "Custom Flash Complete!");
      flashSuccessBanner.classList.add("active");
    }
  } catch (err) {
    appendLog(`\n[Flasher Error] ${err.message}`);
    alert(`Flashing error: ${err.message}\n\nTip: Hold the BOOT button on your ESP32 board while flashing starts.`);
    setProgress(null, "Flashing Failed");
  } finally {
    flashBtn.disabled = false;
    eraseOnlyBtn.disabled = false;
    probeBtn.disabled = false;
  }
}

async function handleEraseOnly() {
  const port = portSelect.value;
  if (!port) {
    alert("Please select a serial port first.");
    return;
  }
  if (!confirm(`Are you sure you want to completely wipe the flash memory of ${port}?\nAll stored files and firmware will be erased.`)) {
    return;
  }

  const baud = parseInt(flashBaudSelect.value, 10) || 460800;
  clearLog();
  setProgress(10, "Erasing flash memory...");

  try {
    flashBtn.disabled = true;
    eraseOnlyBtn.disabled = true;
    probeBtn.disabled = true;

    appendLog(`[Flasher] Erasing entire flash on ${port} @ ${baud} baud...`);
    const res = await fetch("/api/flash/erase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port, baud }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Erase failed");
    }

    setProgress(100, "Erase Complete!");
    appendLog("\n[Flasher] Chip erase completed successfully. The board is now completely clean.");
  } catch (err) {
    appendLog(`\n[Erase Error] ${err.message}`);
    alert(`Erase failed: ${err.message}`);
    setProgress(null, "Erase Failed");
  } finally {
    flashBtn.disabled = false;
    eraseOnlyBtn.disabled = false;
    probeBtn.disabled = false;
  }
}

// -------------------- WebSocket Stream --------------------

function initWebSocket() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${window.location.host}/ws/console`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "flash") {
        const { line, pct } = msg.data || {};
        if (pct !== undefined && pct !== null) {
          setProgress(pct, line || `Progress: ${pct}%`);
        }
        if (line) {
          appendLog(line);
        }
      }
    } catch (err) {
      console.error("WS Parse error:", err);
    }
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 2000);
  };
}

// -------------------- Theme & Helpers --------------------

function updateStatusBadge(text, isGood = false) {
  statusText.textContent = text;
  statusBadge.className = isGood ? "status-badge connected" : "status-badge disconnected";
}

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

// -------------------- Initialization --------------------

refreshPortsBtn.addEventListener("click", fetchPorts);
probeBtn.addEventListener("click", probeHardware);
flashBtn.addEventListener("click", handleFlash);
eraseOnlyBtn.addEventListener("click", handleEraseOnly);

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  fetchPorts();
  initWebSocket();
});
