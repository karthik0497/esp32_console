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
  }

  window.TerminalUI = { init, append, sendCommand };
})();

