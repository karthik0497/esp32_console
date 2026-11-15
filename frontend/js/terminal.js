/* Interactive Serial / WebREPL Terminal & Quick Learning Macros */

(function () {
  const cmdHistory = [];
  let histIdx = -1;
  let paused = false;

  function cleanText(chunk) {
    if (!chunk) return "";
    // Strip common ANSI escape codes
    let text = chunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    // Filter non-printable control characters except \r, \n, \t, and \b
    text = text.replace(/[\x00-\x07\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
    return text;
  }

  function append(text) {
    const box = document.getElementById("terminalBox");
    if (!box) return;
    box.textContent += cleanText(text);
    if (box.textContent.length > 60000) {
      box.textContent = box.textContent.slice(-45000);
    }
    if (!paused) {
      box.scrollTop = box.scrollHeight;
    }
  }

  function sendCommand(cmd) {
    if (!window.App || !window.App.sendWsInput) return;
    window.App.sendWsInput(cmd + "\r\n");
  }

  function init() {
    const input = document.getElementById("termInput");
    const sendBtn = document.getElementById("termSendBtn");
    const clearBtn = document.getElementById("termClearBtn");
    const pauseBtn = document.getElementById("termPauseBtn");
    const copyBtn = document.getElementById("termCopyBtn");

    function submit() {
      const val = input.value;
      if (val.trim()) {
        cmdHistory.unshift(val);
        if (cmdHistory.length > 50) cmdHistory.pop();
        histIdx = -1;
      }
      sendCommand(val);
      input.value = "";
    }

    sendBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (histIdx + 1 < cmdHistory.length) {
          histIdx++;
          input.value = cmdHistory[histIdx];
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (histIdx > 0) {
          histIdx--;
          input.value = cmdHistory[histIdx];
        } else {
          histIdx = -1;
          input.value = "";
        }
      }
    });

    clearBtn.addEventListener("click", () => {
      document.getElementById("terminalBox").textContent = "";
    });

    pauseBtn.addEventListener("click", () => {
      paused = !paused;
      pauseBtn.textContent = paused ? "Resume Scroll" : "Pause Scroll";
    });

    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(document.getElementById("terminalBox").textContent);
      window.App.toast("Terminal log copied!");
    });

    document.querySelectorAll(".macro-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        sendCommand(btn.dataset.cmd);
      });
    });

    function performFactoryWipe() {
      if (!window.App?.isDirectActive?.() && (!window.App?.state || !window.App?.state.connected)) {
        window.App?.toast("Please connect to ESP32 (via USB or WebREPL) first!", true);
        return;
      }
      const ok = confirm("⚠️ FACTORY WIPE ESP32?\n\nThis will DELETE all files (main.py, boot.py, wifi_config.json, webrepl_cfg.py) and reset Wi-Fi credentials.\n\nAre you sure you want to start from scratch?");
      if (!ok) return;

      window.App?.toast("💣 Wiping all files and resetting Wi-Fi...");
      append("\r\n[WIPE] Resetting Wi-Fi and deleting all flash files...\r\n");

      // Interrupt running program first
      if (window.App?.sendWsInput) {
        window.App.sendWsInput("\x03\x03");
      }

      setTimeout(() => {
        const wipeCmd = "import os, network, machine\r\n" +
          "w = network.WLAN(network.STA_IF); w.active(True); w.disconnect(); w.active(False)\r\n" +
          "ap = network.WLAN(network.AP_IF); ap.active(False)\r\n" +
          "def _w(p=''):\r\n" +
          " for f in os.ilistdir(p):\r\n" +
          "  x = (p + '/' + f[0]) if p else f[0]\r\n" +
          "  if f[1] == 0x4000:\r\n" +
          "   _w(x)\r\n" +
          "   try: os.rmdir(x)\r\n" +
          "   except: pass\r\n" +
          "  else:\r\n" +
          "   try: os.remove(x)\r\n" +
          "   except: pass\r\n" +
          "_w()\r\n" +
          "print('\\n>>> [WIPE SUCCESSFUL] All files deleted & Wi-Fi reset! Rebooting ESP32...\\n')\r\n" +
          "machine.reset()\r\n";
        sendCommand(wipeCmd);
      }, 350);
    }

    document.getElementById("wipeAllBtn")?.addEventListener("click", performFactoryWipe);
    document.getElementById("wipeFilesTabBtn")?.addEventListener("click", performFactoryWipe);
  }

  window.TerminalUI = { init, append, sendCommand };
})();

