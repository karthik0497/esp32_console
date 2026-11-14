/**
 * ESP32 Active-Learning Console — Clean App Shell
 * Handles Tab Navigation, Theme Toggling, Status Pill, and WebSocket Stream.
 */

(function () {
  let ws = null;
  let currentStatus = { connected: false, state: "DISCONNECTED", capabilities: {} };

  // Toast notifications
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

  // Status updates
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
  }

  // WebSocket Connection
  function initWebSocket() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws/console`;
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          updateStatusUI(msg.data);
        } else if (msg.type === "alert") {
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

    initWebSocket();
  });
})();
