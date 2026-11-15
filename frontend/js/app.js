/* Main App Shell: Connection Manager (Web Serial + WebREPL + Local Backend), WebSocket Stream, State Pill, Tabs & Toasts */

(function () {
  let ws = null;
  let backendAvailable = false;
  let wsReconnectAttempts = 0;
  let currentStatus = { connected: false, state: "DISCONNECTED", capabilities: {} };

  // Direct client-side transports for Vercel / standalone browser
  let activeDirectTransport = null; // { type: 'serial'|'webrepl', target: str, write: fn, disconnect: fn, hardReset: fn }
  let serialPort = null;
  let serialReader = null;
  let serialKeepReading = false;
  let serialWriteLock = Promise.resolve();

  function toast(msg, isError = false) {
    const box = document.getElementById("toastContainer");
    if (!box) return;
    const el = document.createElement("div");
    let displayMsg = String(msg || "");
    if (displayMsg.toLowerCase().includes("no esp32 connected") || displayMsg.toLowerCase().includes("connect to an esp32")) {
      displayMsg = "⚠️ Not connected to ESP32! In the top bar, choose Mode (USB Serial or WebREPL) and click Connect.";
      isError = true;
    }
    el.className = `toast ${isError ? "error" : ""}`;
    el.textContent = displayMsg;
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
    const target = tabId.startsWith("tab-") ? tabId : `tab-${tabId}`;
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === target));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === target));
    if (target === "tab-health" && currentStatus.connected && window.MetricsUI?.sampleMetrics) {
      window.MetricsUI.sampleMetrics();
    }
    if (target === "tab-files" && currentStatus.connected && window.FilesUI?.refreshFiles) {
      window.FilesUI.refreshFiles();
    }
  }

  function updateStatusUI(s) {
    currentStatus = s || currentStatus;
    const pill = document.getElementById("statusPill");
    const label = document.getElementById("statusText");
    if (pill) pill.className = `status-pill state-${s.state || "DISCONNECTED"}`;

    const niceNames = {
      DISCONNECTED: "Disconnected",
      CONNECTED: "Connected",
      IDLE_REPL: "Idle at REPL (>>>)",
      RUNNING_MAIN: "Running main.py",
      BOOTLOADER: "Bootloader Mode",
      ERROR: "Crash / Error Detected",
    };
    if (label) {
      label.textContent = `${niceNames[s.state] || s.state}${s.target && s.connected ? " • " + s.target : ""}`;
    }

    const connBtn = document.getElementById("connectBtn");
    if (connBtn) {
      connBtn.textContent = s.connected ? "Disconnect" : "Connect";
      connBtn.classList.toggle("btn-danger", s.connected);
      connBtn.classList.toggle("btn-primary", !s.connected);
    }

    const caps = s.capabilities || {};
    const stopBtn = document.getElementById("stopBtn");
    const forceStopBtn = document.getElementById("forceStopBtn");
    const topWipeBtn = document.getElementById("topWipeBtn");
    const softResetBtn = document.getElementById("softResetBtn");
    const hardResetBtn = document.getElementById("hardResetBtn");
    const safeRecoveryBtn = document.getElementById("safeRecoveryBtn");

    if (stopBtn) stopBtn.disabled = !s.connected;
    if (forceStopBtn) forceStopBtn.disabled = !s.connected;
    if (topWipeBtn) topWipeBtn.disabled = !s.connected;
    if (softResetBtn) softResetBtn.disabled = !s.connected;
    if (hardResetBtn) hardResetBtn.disabled = !s.connected || !caps.hard_reset;
    if (safeRecoveryBtn) safeRecoveryBtn.disabled = !s.connected;

    if (s.connected && window.Learning?.completeMission) {
      window.Learning.completeMission("connect");
    }
    if (s.last_metric && window.MetricsUI?.updateView) {
      window.MetricsUI.updateView(s.last_metric);
    }
  }

  function showAlert(alert) {
    const banner = document.getElementById("alertBanner");
    const textEl = document.getElementById("alertText");
    if (banner && textEl) {
      textEl.innerHTML = `<strong>${alert.title}:</strong> ${alert.summary} <em>(${alert.fix})</em>`;
      banner.classList.remove("hidden");
    }
  }

  // ----------------- Browser Web Serial Transport -----------------

  function writeToSerial(text) {
    serialWriteLock = serialWriteLock.then(async () => {
      if (!serialPort || !serialPort.writable) return;
      const writer = serialPort.writable.getWriter();
      try {
        const encoder = new TextEncoder();
        await writer.write(encoder.encode(text));
      } finally {
        writer.releaseLock();
      }
    }).catch((e) => console.warn("Serial write error:", e));
    return serialWriteLock;
  }

  async function connectWebSerial(baudRate = 115200) {
    if (!("serial" in navigator)) {
      throw new Error("Web Serial API is not supported in this browser. Please use Google Chrome, Brave, or Microsoft Edge on desktop.");
    }

    toast("Click your ESP32 in the browser port popup...");
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: Number(baudRate) });

    // Ensure DTR/RTS are false initially so board doesn't reset unexpectedly
    try {
      await serialPort.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch (e) {}

    serialKeepReading = true;
    const textDecoder = new TextDecoderStream();
    serialPort.readable.pipeTo(textDecoder.writable).catch(() => {});
    const reader = textDecoder.readable.getReader();
    serialReader = reader;

    // Start background reader loop
    (async () => {
      try {
        while (serialKeepReading) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            window.TerminalUI?.append(value);
          }
        }
      } catch (err) {
        if (serialKeepReading) console.warn("Serial read loop error:", err);
      } finally {
        reader.releaseLock().catch(() => {});
      }
    })();

    activeDirectTransport = {
      type: "serial",
      target: "Web Serial (USB)",
      write: (txt) => writeToSerial(txt),
      disconnect: async () => {
        serialKeepReading = false;
        if (serialReader) {
          try { await serialReader.cancel(); } catch (e) {}
          serialReader = null;
        }
        if (serialPort) {
          try { await serialPort.close(); } catch (e) {}
          serialPort = null;
        }
        activeDirectTransport = null;
      },
      hardReset: async () => {
        if (!serialPort) return;
        try {
          await serialPort.setSignals({ dataTerminalReady: false, requestToSend: true });
          await new Promise((r) => setTimeout(r, 120));
          await serialPort.setSignals({ dataTerminalReady: false, requestToSend: false });
        } catch (e) {
          console.warn("Hard reset error:", e);
        }
      },
    };

    updateStatusUI({
      connected: true,
      state: "CONNECTED",
      target: "Web Serial (USB)",
      capabilities: { hard_reset: true, repl: true },
    });
    toast("Connected to ESP32 via Browser Web Serial!");
  }

  // ----------------- Browser Direct WebREPL Transport -----------------

  function connectDirectWebRepl(host, password) {
    return new Promise((resolve, reject) => {
      const cleanHost = host.replace("ws://", "").replace("wss://", "").split("/")[0].trim();
      const url = `ws://${cleanHost}:8266/`;
      toast(`Connecting directly to WebREPL at ${cleanHost}...`);
      window.TerminalUI?.append(`\r\n[WebREPL] Connecting to ${url}...\r\n`);

      let socket;
      try {
        socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
      } catch (err) {
        toast(`Failed to create WebSocket: ${err.message}`, true);
        return reject(err);
      }

      let authenticated = false;
      let passSent = false;
      const authTimer = setTimeout(() => {
        if (!authenticated && socket.readyState === WebSocket.OPEN) {
          toast("WebREPL connection timed out waiting for password.", true);
          socket.close();
        }
      }, 12000);

      const cleanPass = (password || document.getElementById("webreplPassInput")?.value || "1234").trim();

      const sendPass = () => {
        if (!authenticated && !passSent && socket.readyState === WebSocket.OPEN) {
          passSent = true;
          window.TerminalUI?.append(`[WebREPL] Sending password...\r\n`);
          socket.send(cleanPass + "\r\n");
        }
      };

      socket.onopen = () => {
        window.TerminalUI?.append(`[WebREPL] Connected to ESP32! Waiting for password prompt...\r\n`);
        activeDirectTransport = {
          type: "webrepl",
          target: `WebREPL (${cleanHost})`,
          write: async (t) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(t);
            }
          },
          disconnect: async () => {
            socket.close();
            activeDirectTransport = null;
          },
        };
      };

      socket.onmessage = (ev) => {
        let text = "";
        if (typeof ev.data === "string") {
          text = ev.data;
        } else if (ev.data instanceof ArrayBuffer) {
          text = new TextDecoder().decode(ev.data);
        } else if (ev.data instanceof Uint8Array) {
          text = new TextDecoder().decode(ev.data);
        }
        window.TerminalUI?.append(text);

        if (!authenticated && text.includes("Password:")) {
          sendPass();
        }

        if (text.includes("WebREPL connected") || text.includes(">>>")) {
          authenticated = true;
          clearTimeout(authTimer);
          updateStatusUI({
            connected: true,
            state: "CONNECTED",
            target: `WebREPL (${cleanHost})`,
            capabilities: { hard_reset: false, repl: true },
          });
          toast(`Connected to WebREPL (${cleanHost})!`);
          resolve();
        }

        if (text.includes("Access denied")) {
          clearTimeout(authTimer);
          toast("WebREPL: Access denied! Incorrect password. Check PASS in top bar.", true);
        }
      };

      socket.onerror = () => {
        clearTimeout(authTimer);
        if (location.protocol === "https:") {
          toast("⚠️ WebREPL connection failed (Brave Shields or Mixed Content).", true);
          showAlert({
            title: "Local Wi-Fi Connection Blocked",
            summary: `Could not connect to ws://${cleanHost}:8266 from https:// origin.`,
            fix: "In Brave: Click the Orange Lion icon in URL bar -> Turn Shields OFF for this site. Also ensure 'Insecure content: Allow' is set in Site settings.",
          });
        } else {
          toast(`Could not connect to WebREPL at ${cleanHost}:8266. Check Wi-Fi and IP.`, true);
        }
        reject(new Error("WebSocket connection error"));
      };

      socket.onclose = () => {
        clearTimeout(authTimer);
        if (!authenticated) {
          window.TerminalUI?.append(`\r\n[WebREPL] Connection closed. (Note: MicroPython drops connection immediately if password in PASS is rejected! Check PASS in top toolbar).\r\n`);
          toast("WebREPL closed. Verify password (PASS) and retry.", true);
        }
        if (activeDirectTransport && activeDirectTransport.type === "webrepl") {
          activeDirectTransport = null;
          updateStatusUI({ connected: false, state: "DISCONNECTED", capabilities: {} });
          toast("WebREPL connection closed.");
        }
      };
    });
  }

  // ----------------- Unified Ports & Connections -----------------

  async function refreshPorts() {
    const sel = document.getElementById("portSelect");
    if (!sel) return;
    const prev = sel.value;

    try {
      const data = await api("/api/ports");
      backendAvailable = true;
      const options = [];
      const ports = data.ports || [];

      if ("serial" in navigator) {
        options.push(`<option value="WEB_SERIAL">⚡ Web Serial (Direct Browser USB)</option>`);
      }

      ports.sort((a, b) => {
        if (a.likely_esp32 && !b.likely_esp32) return -1;
        if (!a.likely_esp32 && b.likely_esp32) return 1;
        return a.port.localeCompare(b.port);
      });

      for (const p of ports) {
        const star = p.likely_esp32 ? "★ " : "";
        options.push(`<option value="${p.port}">${star}${p.port} — ${p.chip_hint}</option>`);
      }
      if (data.simulator) {
        options.push(`<option value="SIMULATOR">SIMULATOR — Virtual Demo ESP32-S3</option>`);
      }
      sel.innerHTML = options.join("");

      if (data.status && data.status.connected && data.status.target) {
        sel.value = data.status.target;
      } else if (prev && [...sel.options].some((o) => o.value === prev)) {
        sel.value = prev;
      } else if (ports.length > 0) {
        sel.value = ports[0].port;
      } else if (options.length > 0) {
        sel.value = sel.options[0].value;
      }

      if (window.FlasherUI && window.FlasherUI.populatePorts) {
        window.FlasherUI.populatePorts(ports, data.simulator);
      }
      if (data.status) updateStatusUI(data.status);
    } catch (err) {
      backendAvailable = false;
      if ("serial" in navigator) {
        sel.innerHTML = `<option value="WEB_SERIAL" selected>⚡ Web Serial (Direct Browser USB)</option>`;
      } else {
        sel.innerHTML = `<option value="UNSUPPORTED">⚠️ Web Serial not supported (use Chrome/Brave)</option>`;
      }
    }
  }

  async function toggleConnect() {
    if (currentStatus.connected) {
      if (activeDirectTransport) {
        await activeDirectTransport.disconnect();
        updateStatusUI({ connected: false, state: "DISCONNECTED", capabilities: {} });
        toast("Disconnected cleanly.");
        return;
      }
      try {
        await api("/api/disconnect", { method: "POST" });
        toast("Disconnected cleanly.");
      } catch (e) {
        updateStatusUI({ connected: false, state: "DISCONNECTED", capabilities: {} });
      }
      return;
    }

    const mode = document.getElementById("connMode").value;
    const baudrate = Number(document.getElementById("baudSelect")?.value || 115200);

    if (mode === "serial") {
      const portVal = document.getElementById("portSelect")?.value || "";
      const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";

      if (portVal === "WEB_SERIAL" || !backendAvailable || !isLocal) {
        try {
          await connectWebSerial(baudrate);
          return;
        } catch (err) {
          if (err.name === "NotFoundError") {
            // User closed the browser port picker dialog
            return;
          }
          toast(err.message, true);
          return;
        }
      }

      // Local backend connection
      try {
        const payload = {
          mode: portVal === "SIMULATOR" ? "simulator" : "serial",
          target: portVal,
          baudrate,
        };
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
      return;
    }

    if (mode === "webrepl") {
      const host = document.getElementById("webreplHostInput").value.trim();
      const password = document.getElementById("webreplPassInput").value;
      if (!host) return toast("Enter ESP32 IP address for WebREPL.", true);

      const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (!backendAvailable || !isLocal) {
        try {
          await connectDirectWebRepl(host, password);
        } catch (err) {}
        return;
      }

      // Local backend connection
      try {
        const payload = { mode: "webrepl", target: host, password };
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
  }

  async function runControl(action) {
    if (activeDirectTransport) {
      if (action === "interrupt") {
        await activeDirectTransport.write("\x03\x03");
        window.Learning?.completeMission?.("stop");
        toast("Sent Ctrl+C (Interrupt)");
      } else if (action === "aggressive_interrupt") {
        await activeDirectTransport.write("\x03\x03\x03\x03\x03");
        toast("Sent Ctrl+C Burst");
      } else if (action === "soft_reset") {
        await activeDirectTransport.write("\x04");
        toast("Sent Ctrl+D (Soft Reboot)");
      } else if (action === "hard_reset") {
        if (activeDirectTransport.hardReset) {
          await activeDirectTransport.hardReset();
          toast("Hard Reset (EN pin pulse)");
        } else {
          toast("Hard reset is only supported over USB Serial.", true);
        }
      } else if (action === "safe_recovery" || action === "safe_recovery_disable_main") {
        await activeDirectTransport.write("\x03\x03\x04");
        toast("Safe Recovery triggered (Interrupt + Soft Reboot)");
      }
      return;
    }

    try {
      await api(`/api/control/${action}`, { method: "POST" });
      if (action === "interrupt" || action === "aggressive_interrupt") {
        window.Learning?.completeMission?.("stop");
      }
      if (action === "safe_recovery_disable_main") {
        toast("Safe Recovery complete! /main.py renamed to /main.py.bak");
      }
    } catch (err) {
      toast(err.message, true);
    }
  }

  function connectWebSocket() {
    const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (!isLocal && !backendAvailable) {
      return; // Do not spam reconnects on Vercel
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws/console`);
    ws.onopen = () => {
      wsReconnectAttempts = 0;
      backendAvailable = true;
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "term") window.TerminalUI?.append(msg.data);
      else if (msg.type === "state") updateStatusUI(msg.data);
      else if (msg.type === "xray") window.Learning?.pushXray(msg.data);
      else if (msg.type === "metric") window.MetricsUI?.updateView(msg.data);
      else if (msg.type === "flash") window.FlasherUI?.handleProgress(msg.data);
      else if (msg.type === "alert") showAlert(msg.data);
      else if (msg.type === "log" && window.LogsUI) window.LogsUI.appendLiveLog(msg.data);
    };
    ws.onclose = () => {
      wsReconnectAttempts++;
      if (isLocal || wsReconnectAttempts < 3) {
        setTimeout(connectWebSocket, 2000);
      }
    };
    ws.onerror = () => {
      backendAvailable = false;
    };
  }

  function sendWsInput(text) {
    if (activeDirectTransport) {
      activeDirectTransport.write(text);
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data: text }));
    }
  }

  function init() {
    try { window.Learning?.init(); } catch (e) { console.error("Learning init error", e); }
    try { window.TerminalUI?.init(); } catch (e) { console.error("TerminalUI init error", e); }
    try { window.FilesUI?.init(); } catch (e) { console.error("FilesUI init error", e); }
    try { window.WifiUI?.init(); } catch (e) { console.error("WifiUI init error", e); }
    try { window.MetricsUI?.init(); } catch (e) { console.error("MetricsUI init error", e); }
    try { window.FlasherUI?.init(); } catch (e) { console.error("FlasherUI init error", e); }
    try { window.LogsUI?.init(); } catch (e) { console.error("LogsUI init error", e); }

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    const connMode = document.getElementById("connMode");
    if (connMode) {
      connMode.addEventListener("change", () => {
        const isWeb = connMode.value === "webrepl";
        const sInputs = document.getElementById("serialInputs");
        const wInputs = document.getElementById("webreplInputs");
        if (sInputs) sInputs.style.display = isWeb ? "none" : "inline-flex";
        if (wInputs) wInputs.style.display = isWeb ? "inline-flex" : "none";
      });
    }

    document.getElementById("refreshPortsBtn")?.addEventListener("click", refreshPorts);
    document.getElementById("connectBtn")?.addEventListener("click", toggleConnect);
    document.getElementById("stopBtn")?.addEventListener("click", () => runControl("interrupt"));
    document.getElementById("forceStopBtn")?.addEventListener("click", () => runControl("aggressive_interrupt"));
    document.getElementById("softResetBtn")?.addEventListener("click", () => runControl("soft_reset"));
    document.getElementById("hardResetBtn")?.addEventListener("click", () => runControl("hard_reset"));
    document.getElementById("safeRecoveryBtn")?.addEventListener("click", () => {
      const disable = confirm("Do you also want to rename /main.py -> /main.py.bak so a runaway loop won't freeze on next boot?\n\nClick OK to rename main.py, or Cancel to just reset & stop.");
      runControl(disable ? "safe_recovery_disable_main" : "safe_recovery");
    });

    document.getElementById("dismissAlertBtn")?.addEventListener("click", () => {
      document.getElementById("alertBanner")?.classList.add("hidden");
    });

    document.getElementById("themeToggleBtn")?.addEventListener("click", () => {
      document.body.classList.toggle("light-theme");
    });

    refreshPorts();
    connectWebSocket();
  }

  window.App = {
    api,
    toast,
    switchTab,
    sendWsInput,
    refreshPorts,
    isDirectActive: () => Boolean(activeDirectTransport),
    isBackendAvailable: () => backendAvailable,
  };
  document.addEventListener("DOMContentLoaded", init);
})();
