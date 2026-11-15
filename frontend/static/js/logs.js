/* System, Hardware & Error Logs Viewer with Global Action Tracker */

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

    // Update log count in header if element exists
    const counterEl = document.getElementById("headerLogCount");
    if (counterEl) counterEl.textContent = `${logsCache.length} logs`;

    if (!filtered.length) {
      box.innerHTML = '<div class="muted" style="padding:24px;text-align:center">No logs match the current filter.</div>';
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
                ${log.detail ? `<div style="margin-top:2px;font-size:11px;color:#fca5a5;white-space:pre-wrap;word-break:break-all">${log.detail}</div>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    box.scrollTop = box.scrollHeight;
  }

  async function fetchLogs() {
    try {
      const data = await window.App.api("/api/logs");
      logsCache = data.logs || [];
      renderLogs();
    } catch (err) {
      console.error("Failed to load logs:", err);
    }
  }

  async function clearLogs() {
    try {
      await window.App.api("/api/logs/clear", { method: "POST" });
      logsCache = [];
      renderLogs();
      window.App.toast("Activity logs and log file cleared.");
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  function appendLiveLog(entry) {
    logsCache.push(entry);
    if (logsCache.length > 500) logsCache.shift();
    renderLogs();
  }

  function trackAction(source, action, detail = "") {
    fetch("/api/logs/track-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, action, detail }),
    }).catch(() => {});
  }

  function init() {
    document.getElementById("refreshLogsBtn")?.addEventListener("click", fetchLogs);
    document.getElementById("clearLogsBtn")?.addEventListener("click", clearLogs);
    document.getElementById("downloadLogsBtn")?.addEventListener("click", () => {
      window.location.href = "/api/logs/download";
    });
    document.getElementById("copyLogsBtn")?.addEventListener("click", async () => {
      const text = logsCache.map((l) => `[${l.timestamp}] [${l.level}] [${l.source}] ${l.action}: ${l.message} ${l.detail || ''}`).join("\n");
      await navigator.clipboard.writeText(text);
      window.App.toast("All logs copied to clipboard!");
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
      if (label && !["Dismiss"].includes(label)) {
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

    fetchLogs();
  }

  window.LogsUI = { init, fetchLogs, appendLiveLog, trackAction };
})();
