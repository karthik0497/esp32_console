/* MicroPython File Directory Explorer, Inline Editor, Upload (USB / WebREPL) & Backup */

(function () {
  let selectedPath = null;
  let currentFiles = [];

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function renderList() {
    const list = document.getElementById("fileList");
    if (!currentFiles.length) {
      list.innerHTML = '<div class="file-row"><span class="muted">No files loaded yet. Click Refresh Files.</span></div>';
      return;
    }
    list.innerHTML = currentFiles
      .map((item) => {
        const icon = item.is_dir ? "📁" : item.path === "/main.py" ? "🚀" : item.path === "/boot.py" ? "⚙️" : "📄";
        const sel = item.path === selectedPath ? "selected" : "";
        const sizeLabel = item.is_dir ? "Folder" : formatBytes(item.size || 0);
        return `<div class="file-row ${sel}" data-path="${item.path}" data-dir="${item.is_dir}">
          <span class="mono">${icon} ${item.path}</span>
          <span class="muted">${sizeLabel}</span>
        </div>`;
      })
      .join("");

    list.querySelectorAll(".file-row").forEach((row) => {
      row.addEventListener("click", () => {
        const p = row.dataset.path;
        const isDir = row.dataset.dir === "true";
        selectedPath = p;
        renderList();
        if (!isDir) loadFile(p);
      });
    });
  }

  async function refreshFiles() {
    try {
      const data = await window.App.api("/api/files");
      currentFiles = data.files || [];
      renderList();
      window.Learning.completeMission("files");
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function loadFile(path) {
    try {
      const data = await window.App.api(`/api/file?path=${encodeURIComponent(path)}`);
      document.getElementById("editorPath").value = data.path;
      const editor = document.getElementById("fileEditor");
      if (data.is_binary) {
        editor.value = `[Binary file: ${data.size} bytes — cannot edit as plain text]`;
        editor.disabled = true;
      } else {
        editor.disabled = false;
        editor.value = data.content;
      }
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function saveEditorFile() {
    const path = document.getElementById("editorPath").value.trim();
    const content = document.getElementById("fileEditor").value;
    if (!path) return window.App.toast("Enter a destination file path (e.g. /main.py)", true);
    try {
      await window.App.api("/api/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      window.App.toast(`Saved ${path} to ESP32!`);
      selectedPath = path;
      await refreshFiles();
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function uploadFiles(fileList) {
    if (!fileList || !fileList.length) return;
    const targetDir = document.getElementById("uploadTargetDir").value.trim() || "/";
    const form = new FormData();
    form.append("target_dir", targetDir);
    for (const f of fileList) {
      form.append("files", f, f.name);
    }
    try {
      const resp = await fetch("/api/upload", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Upload failed");
      window.App.toast(`Uploaded ${data.uploaded.length} file(s) to ${targetDir}`);
      await refreshFiles();
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function deleteSelected() {
    if (!selectedPath) return window.App.toast("Select a file or folder first.", true);
    if (!confirm(`Delete ${selectedPath} from ESP32 flash?`)) return;
    try {
      await window.App.api(`/api/file?path=${encodeURIComponent(selectedPath)}`, { method: "DELETE" });
      window.App.toast(`Deleted ${selectedPath}`);
      selectedPath = null;
      document.getElementById("editorPath").value = "";
      document.getElementById("fileEditor").value = "";
      await refreshFiles();
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function runSelected() {
    const path = document.getElementById("editorPath").value.trim() || selectedPath;
    if (!path) return window.App.toast("Select a .py file to run.", true);
    try {
      await window.App.api("/api/run-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      window.App.toast(`Running ${path} — watch Terminal!`);
      window.App.switchTab("tab-terminal");
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function makeMain() {
    const path = document.getElementById("editorPath").value.trim() || selectedPath;
    if (!path) return window.App.toast("Select a .py file first.", true);
    try {
      await window.App.api("/api/make-main", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      window.App.toast(`Copied ${path} -> /main.py! Soft Reboot to auto-run on startup.`);
      await refreshFiles();
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  const STARTER_TEMPLATES = {
    blink: {
      path: "/blink_demo.py",
      code: "# Blink the onboard LED (Pin 2 on most ESP32 boards)\nimport time\nimport machine\n\nled = machine.Pin(2, machine.Pin.OUT)\nfor i in range(6):\n    led.value(i % 2)\n    print('Blink step', i, 'LED =', led.value())\n    time.sleep(0.5)\nprint('Blink demo finished!')\n",
    },
    metrics_loop: {
      path: "/live_monitor_demo.py",
      code: "# Streams live RAM & system metrics to the Console without blocking\nimport time\nimport esp_console_agent\n\nwhile True:\n    esp_console_agent.emit_metrics()\n    print('Doing sensor work... (click Stop Ctrl+C anytime)')\n    time.sleep(2)\n",
    },
    web_hello: {
      path: "/mini_web_server.py",
      code: "# Tiny web server running right on your ESP32\nimport socket\n\nsrv = socket.socket()\nsrv.bind(('0.0.0.0', 80))\nsrv.listen(2)\nprint('Mini web server listening on port 80...')\nwhile True:\n    conn, addr = srv.accept()\n    conn.recv(512)\n    conn.send('HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\n<h1>Hello from ESP32!</h1>')\n    conn.close()\n",
    },
    runaway: {
      path: "/runaway_practice.py",
      code: "# Practice Safe Recovery! Save & Run this, then test Stop / Force Stop / Safe Recovery\nwhile True:\n    pass\n",
    },
  };

  function init() {
    document.getElementById("refreshFilesBtn").addEventListener("click", refreshFiles);
    document.getElementById("saveFileBtn").addEventListener("click", saveEditorFile);
    document.getElementById("deleteFileBtn").addEventListener("click", deleteSelected);
    document.getElementById("runFileBtn").addEventListener("click", runSelected);
    document.getElementById("makeMainBtn").addEventListener("click", makeMain);

    document.getElementById("newFileBtn").addEventListener("click", () => {
      const name = prompt("New file path on ESP32 (e.g. /test_led.py):", "/test_led.py");
      if (!name) return;
      document.getElementById("editorPath").value = name.startsWith("/") ? name : "/" + name;
      document.getElementById("fileEditor").disabled = false;
      document.getElementById("fileEditor").value = "# New MicroPython script\nprint('Hello from ESP32!')\n";
    });

    document.getElementById("newDirBtn").addEventListener("click", async () => {
      const name = prompt("New folder path (e.g. /lib):", "/sensors");
      if (!name) return;
      try {
        await window.App.api("/api/mkdir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: name }),
        });
        await refreshFiles();
      } catch (err) {
        window.App.toast(err.message, true);
      }
    });

    const uploadInput = document.getElementById("fileUploadInput");
    document.getElementById("pickUploadBtn").addEventListener("click", () => uploadInput.click());
    uploadInput.addEventListener("change", (e) => uploadFiles(e.target.files));

    const tplSelect = document.getElementById("templateSelect");
    if (tplSelect) {
      tplSelect.addEventListener("change", () => {
        const key = tplSelect.value;
        if (!key || !STARTER_TEMPLATES[key]) return;
        document.getElementById("editorPath").value = STARTER_TEMPLATES[key].path;
        const ed = document.getElementById("fileEditor");
        ed.disabled = false;
        ed.value = STARTER_TEMPLATES[key].code;
        tplSelect.value = "";
        window.App.toast("Template loaded into editor! Click Save to ESP32 or Run File.");
      });
    }

    const dropzone = document.getElementById("fileDropzone");
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      uploadFiles(e.dataTransfer.files);
    });
  }

  window.FilesUI = { init, refreshFiles };
})();

