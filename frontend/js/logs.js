/* System, Hardware & Error Logs Viewer with Global Action Tracker (Vercel & Local) */

(function () {
  let currentFilter = "ALL";
  let logsCache = [];

  function formatBadge(level) {
    const badges = {
      SUCCESS: '<span class="badge badge-success">SUCCESS</span>',
      ERROR: '<span class="badge badge-danger">ERROR</span>',
      WARN: '<span class="badge badge-warn">WARN</span>',
      INFO: '<span class="badge badge-info">INFO</span>',
      UI_ACTION: '<span class="badge badge-action">UI_ACTION</span>',
    };
    return badges[level] || `<span class="badge">[${level}]</span>`;
  }

  function renderLogs() {
    const box = document.getElementById("logsContainer");
    if (!box) return;
    const query = (document.getElementById("logSearchInput")?.value || "").toLowerCase();

    const filtered = logsCache.filter((log) => {
      if (currentFilter === "ERROR" && log.level !== "ERROR") return false;
      if (currentFilter === "UI_ACTION" && log.level !== "UI_ACTION") return false;
      if (currentFilter === "WIFI" && log.source !== "Wi-Fi" && log.source !== "WebREPL" && log.source !== "Provisioning") return false;
      if (currentFilter === "SERIAL" && log.source !== "Serial" && log.source !== "Transport" && log.source !== "Control") return false;
      if (query) {
        const text = `${log.timestamp} ${log.level} ${log.source} ${log.action} ${log.message} ${log.detail || ''}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });

    // Update log count in top bar header
    const counterEl = document.getElementById("headerLogCount");
    if (counterEl) counterEl.textContent = `${logsCache.length} logs`;

    if (!filtered.length) {
      box.innerHTML = '<div class="muted" style="padding:24px;text-align:center">No logs match the current filter. Logs appear live as actions, connections, and device prints occur.</div>';
      return;
    }

    box.innerHTML = `
      <table class="logs-table mono">
        <thead>
          <tr>
            <th style="width:85px">Time</th>
            <th style="width:90px">Level</th>
            <th style="width:100px">Source</th>
            <th style="width:160px">Action</th>
            <th>Details &amp; Status</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((log) => `
            <tr>
              <td style="color:var(--text-muted)">${log.timestamp}</td>
              <td>${formatBadge(log.level)}</td>
              <td style="color:var(--text-muted);font-weight:600">[${log.source}]</td>
              <td><strong>${log.action}</strong></td>
              <td>
                <span>${log.message}</span>
                ${log.detail ? `<div style="margin-top:2px;font-size:11px;color:${log.level === 'ERROR' ? '#fca5a5' : 'var(--text-muted)'};white-space:pre-wrap;word-break:break-all">${log.detail}</div>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    box.scrollTop = box.scrollHeight;
  }

  function appendLiveLog(entry) {
    if (!entry) return;
    if (!entry.timestamp) {
      entry.timestamp = new Date().toTimeString().split(" ")[0];
    }
    logsCache.push(entry);
    if (logsCache.length > 600) logsCache.shift();
    try {
      sessionStorage.setItem("esp32_activity_logs", JSON.stringify(logsCache.slice(-250)));
    } catch (e) {}
    renderLogs();
  }

  function log(level, source, action, message, detail = "") {
    appendLiveLog({
      timestamp: new Date().toTimeString().split(" ")[0],
      level: (level || "INFO").toUpperCase(),
      source: source || "System",
      action: action || "Event",
      message: String(message || ""),
      detail: String(detail || ""),
    });
  }

  async function fetchLogs() {
    if (window.App && window.App.isBackendAvailable && window.App.isBackendAvailable()) {
      try {
        const data = await window.App.api("/api/logs");
        if (data && data.logs && data.logs.length) {
          logsCache = data.logs;
          renderLogs();
          return;
        }
      } catch (err) {
        console.warn("Backend logs not available, using client logs:", err);
      }
    }
    renderLogs();
  }

  async function clearLogs() {
    logsCache = [];
    try { sessionStorage.removeItem("esp32_activity_logs"); } catch (e) {}
    renderLogs();
    if (window.App && window.App.isBackendAvailable && window.App.isBackendAvailable()) {
      try {
        await window.App.api("/api/logs/clear", { method: "POST" });
      } catch (e) {}
    }
    window.App?.toast?.("Activity logs cleared.");
  }

  function trackAction(source, action, detail = "") {
    log("UI_ACTION", source || "UI", action || "Action", detail || action);
    if (window.App && window.App.isBackendAvailable && window.App.isBackendAvailable()) {
      fetch("/api/logs/track-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, action, detail }),
      }).catch(() => {});
    }
  }

  function init() {
    // Restore cached logs from session if available
    try {
      const saved = sessionStorage.getItem("esp32_activity_logs");
      if (saved) {
        logsCache = JSON.parse(saved) || [];
      }
    } catch (e) {}

    if (!logsCache.length) {
      log("INFO", "System", "Init", "ESP32 Console workbench initialized", "Browser origin: " + location.origin);
    }

    document.getElementById("refreshLogsBtn")?.addEventListener("click", fetchLogs);
    document.getElementById("clearLogsBtn")?.addEventListener("click", clearLogs);

    document.getElementById("downloadLogsBtn")?.addEventListener("click", () => {
      if (window.App && window.App.isBackendAvailable && window.App.isBackendAvailable()) {
        window.location.href = "/api/logs/download";
        return;
      }
      const text = logsCache.map((l) => `[${l.timestamp}] [${l.level}] [${l.source}] ${l.action}: ${l.message} ${l.detail || ''}`).join("\n");
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `esp32_activity_${Date.now()}.log`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.App?.toast?.("Downloaded activity log file.");
    });

    document.getElementById("copyLogsBtn")?.addEventListener("click", async () => {
      const text = logsCache.map((l) => `[${l.timestamp}] [${l.level}] [${l.source}] ${l.action}: ${l.message} ${l.detail || ''}`).join("\n");
      await navigator.clipboard.writeText(text);
      window.App?.toast?.("All logs copied to clipboard!");
    });

    document.querySelectorAll(".log-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".log-filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        renderLogs();
      });
    });

    document.getElementById("logSearchInput")?.addEventListener("input", renderLogs);

    // Global UI Interaction Tracker
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || btn.classList.contains("info-btn")) return;
      const label = (btn.innerText || btn.title || btn.id || "Button").trim().replace(/\s+/g, " ");
      if (label && !["Dismiss", "Clear", "Copy All"].includes(label)) {
        trackAction("UI_CLICK", `Button [${label}]`, `ID: #${btn.id || 'none'}`);
      }
    });

    document.addEventListener("change", (e) => {
      const el = e.target;
      if (el.tagName === "SELECT") {
        const selected = el.options[el.selectedIndex]?.text || el.value;
        trackAction("UI_SELECT", `Dropdown [${el.id || 'select'}]`, `Selected: ${selected}`);
      }
    });

    renderLogs();
    fetchLogs();
  }

  window.LogsUI = { init, fetchLogs, appendLiveLog, trackAction, log, renderLogs, clearLogs };
})();
