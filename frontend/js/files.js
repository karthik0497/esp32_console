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
  function utf8ByteCount(str) {
    return new TextEncoder().encode(str).length;
  }

  function trackDirectFile(path, size) {
    const norm = path.startsWith("/") ? path : "/" + path;
    const existing = currentFiles.find((f) => f.path === norm);
    if (existing) {
      existing.size = size;
    } else {
      currentFiles.push({ path: norm, is_dir: false, size: size || 1024 });
    }
  }

  async function writeDirectFile(path, content) {
    if (!window.App || !window.App.sendWsInput) {
      throw new Error("No active connection to ESP32 (Web Serial or WebREPL). Please connect first!");
    }
    const normPath = path.startsWith("/") ? path : "/" + path;
    const utf8Bytes = new TextEncoder().encode(content);
    let binary = "";
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const b64 = btoa(binary);

    // 128-char chunk size ensures clean REPL line buffers
    const chunkSize = 128;
    const chunks = [];
    for (let i = 0; i < b64.length; i += chunkSize) {
      chunks.push(b64.slice(i, i + chunkSize));
    }

    // Interrupt any running program to ensure clean REPL
    window.App.sendWsInput("\x03\x03\r\n");
    await new Promise((r) => setTimeout(r, 250));

    // Send open statement
    window.App.sendWsInput(`import binascii; _f = open('${normPath}', 'wb')\r\n`);
    for (const c of chunks) {
      window.App.sendWsInput(`_f.write(binascii.a2b_base64(b'${c}'))\r\n`);
    }
    window.App.sendWsInput(`_f.close(); print('\\n>>> [SAVED] Successfully wrote ${utf8Bytes.length} bytes to ${normPath}!\\n')\r\n`);
    await new Promise((r) => setTimeout(r, 350));
  }

  async function refreshFiles() {
    try {
      const data = await window.App.api("/api/files");
      currentFiles = data.files || [];
      renderList();
      window.Learning.completeMission("files");
    } catch (err) {
      if (window.App?.isDirectActive?.()) {
        if (!currentFiles.length) {
          currentFiles = [
            { path: "/main.py", is_dir: false, size: 2400 },
            { path: "/boot.py", is_dir: false, size: 480 },
            { path: "/webrepl_cfg.py", is_dir: false, size: 16 },
          ];
        }
        renderList();
      } else {
        window.App.toast(err.message, true);
      }
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
      if (window.App?.isDirectActive?.()) {
        document.getElementById("editorPath").value = path;
        const editor = document.getElementById("fileEditor");
        if (editor) {
          editor.disabled = false;
          // Preload template if available
          if (path === "/main.py" && STARTER_TEMPLATES.internet_test) {
            editor.value = STARTER_TEMPLATES.internet_test.code;
          }
        }
      } else {
        window.App.toast(err.message, true);
      }
    }
  }

  async function saveEditorFile() {
    const path = document.getElementById("editorPath").value.trim();
    const content = document.getElementById("fileEditor").value;
    if (!path) return window.App.toast("Enter a destination file path (e.g. /main.py)", true);
    const btn = document.getElementById("saveFileBtn");
    const origText = btn ? btn.textContent : "💾 Save";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving...";
    }
    try {
      if (window.App?.isDirectActive?.()) {
        await writeDirectFile(path, content);
        trackDirectFile(path, utf8ByteCount(content));
        renderList();
        window.App.toast(`Saved ${path} to ESP32!`);
        selectedPath = path;
      } else {
        await window.App.api("/api/file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content }),
        });
        window.App.toast(`Saved ${path} to ESP32!`);
        selectedPath = path;
        await refreshFiles();
      }
    } catch (err) {
      window.App.toast(err.message, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  }

  async function uploadFiles(fileList) {
    if (!fileList || !fileList.length) return;
    const targetDir = (document.getElementById("uploadTargetDir")?.value.trim() || "/").replace(/\/$/, "");

    if (window.App?.isDirectActive?.()) {
      try {
        for (const file of fileList) {
          const filePath = `${targetDir}/${file.name}`;
          window.App.toast(`Uploading ${file.name}...`);
          const text = await file.text();
          await writeDirectFile(filePath, text);
          trackDirectFile(filePath, file.size);
        }
        window.App.toast(`Uploaded ${fileList.length} file(s) to ESP32!`);
        renderList();
      } catch (err) {
        window.App.toast(`Upload error: ${err.message}`, true);
      }
      return;
    }

    const form = new FormData();
    form.append("target_dir", targetDir || "/");
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

    if (window.App?.isDirectActive?.()) {
      window.App.sendWsInput(`import os; os.remove('${selectedPath}'); print('\\n>>> [DELETED] ${selectedPath}\\n')\r\n`);
      currentFiles = currentFiles.filter((f) => f.path !== selectedPath);
      window.App.toast(`Deleted ${selectedPath}`);
      selectedPath = null;
      document.getElementById("editorPath").value = "";
      document.getElementById("fileEditor").value = "";
      renderList();
      return;
    }

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

  async function saveAndRun() {
    const path = document.getElementById("editorPath").value.trim() || selectedPath || "/main.py";
    const content = document.getElementById("fileEditor").value;
    if (!path) return window.App.toast("Enter a destination file path (e.g. /main.py)", true);

    const btn = document.getElementById("runFileBtn");
    const origText = btn ? btn.textContent : "▶ Save & Run";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving & Running...";
    }

    try {
      if (window.App?.isDirectActive?.()) {
        await writeDirectFile(path, content);
        trackDirectFile(path, utf8ByteCount(content));
        renderList();
        selectedPath = path;

        // Run directly in MicroPython REPL and switch to terminal
        const normPath = path.startsWith("/") ? path : "/" + path;
        window.App.sendWsInput(`exec(open('${normPath}').read())\r\n`);
        window.App.toast(`Saved ${path}! Running in Terminal...`);
        window.App.switchTab("tab-terminal");
      } else {
        await window.App.api("/api/file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content }),
        });
        await window.App.api("/api/run-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
        window.App.toast(`Running ${path} — watch Terminal!`);
        window.App.switchTab("tab-terminal");
        refreshFiles().catch(() => {});
      }
    } catch (err) {
      window.App.toast(err.message, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  }

  async function makeMain() {
    const path = document.getElementById("editorPath").value.trim() || selectedPath;
    if (!path) return window.App.toast("Select a .py file first.", true);

    if (window.App?.isDirectActive?.()) {
      window.App.sendWsInput(`with open('${path}', 'rb') as src, open('/main.py', 'wb') as dst: dst.write(src.read())\r\nprint('\\n>>> [COPIED] ${path} is now /main.py!\\n')\r\n`);
      trackDirectFile("/main.py", 1024);
      renderList();
      window.App.toast(`Copied ${path} -> /main.py! Soft Reboot to auto-run on startup.`);
      return;
    }

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
    internet_test: {
      path: "/main.py",
      code: `# =========================================================\n# ESP32 Wi-Fi & Internet Connectivity Test\n# Probes internet via ip-api.com, reveals public IP & city,\n# and blinks onboard LED (GPIO 2) to confirm live web access!\n# =========================================================\n\nimport time\nimport socket\nimport json\nimport network\nimport machine\n\n# 1. Hardware LED Setup (GPIO 2 is standard on ESP32 DevKit)\ntry:\n    led = machine.Pin(2, machine.Pin.OUT)\nexcept Exception:\n    led = None\n\ndef blink(times=3, delay=0.15):\n    if not led:\n        return\n    for _ in range(times):\n        led.value(1)\n        time.sleep(delay)\n        led.value(0)\n        time.sleep(delay)\n\n# 2. Check Wi-Fi Connection\nsta = network.WLAN(network.STA_IF)\nif not sta.isconnected():\n    print("⚠️ Wi-Fi not connected yet! Waiting for router...")\n    for _ in range(8):\n        if sta.isconnected():\n            break\n        time.sleep(1)\n\nif sta.isconnected():\n    ip, mask, gateway, dns = sta.ifconfig()\n    print("==================================================")\n    print("✅ Wi-Fi Connected to Router!")\n    print("   ESP32 Local IP :", ip)\n    print("   Subnet Mask    :", mask)\n    print("   Gateway/Router :", gateway)\n    print("   DNS Server     :", dns)\n    print("==================================================")\nelse:\n    print("❌ Wi-Fi Station is offline. Check Wi-Fi settings in Tab 2.")\n\n# 3. HTTP Request to check Internet & Fetch Public Geo-IP\ndef test_internet():\n    print("\\n🌐 Probing the Internet via http://ip-api.com/json ...")\n    try:\n        s = socket.socket()\n        s.settimeout(8.0)\n        s.connect(("ip-api.com", 80))\n        req = "GET /json HTTP/1.0\\r\\nHost: ip-api.com\\r\\nUser-Agent: MicroPython-ESP32\\r\\n\\r\\n"\n        s.send(req.encode())\n\n        raw = b""\n        while True:\n            chunk = s.recv(512)\n            if not chunk:\n                break\n            raw += chunk\n        s.close()\n\n        header, body = raw.split(b"\\r\\n\\r\\n", 1)\n        data = json.loads(body.decode("utf-8"))\n\n        if data.get("status") == "success":\n            print("🎉 INTERNET ACCESS CONFIRMED!")\n            print("   Public IP   :", data.get("query"))\n            print("   ISP         :", data.get("isp"))\n            print("   Location    :", data.get("city") + ", " + data.get("country"))\n            print("   Timezone    :", data.get("timezone"))\n            blink(5, 0.08)  # Fast celebration blink!\n            return True\n        else:\n            print("⚠️ Server responded with error:", data)\n            return False\n    except Exception as exc:\n        print("❌ Internet check failed:", exc)\n        return False\n\n# Run initial test\nhas_internet = test_internet()\n\n# 4. Continuous live status loop (safe to stop anytime with Ctrl+C)\nprint("\\n📡 Entering live telemetry loop... (Press Stop Ctrl+C anytime)")\ncounter = 1\nwhile True:\n    try:\n        if led:\n            led.value(counter % 2)\n        print(f"[{time.ticks_ms() // 1000}s] [main.py] ESP32 running healthy • Heartbeat #{counter}")\n        counter += 1\n        time.sleep(5)\n    except KeyboardInterrupt:\n        print("\\nStopped by user.")\n        break\n`,
    },
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
    document.getElementById("refreshFilesBtn")?.addEventListener("click", refreshFiles);
    document.getElementById("saveFileBtn")?.addEventListener("click", saveEditorFile);
    document.getElementById("deleteFileBtn")?.addEventListener("click", deleteSelected);
    document.getElementById("runFileBtn")?.addEventListener("click", saveAndRun);
    document.getElementById("makeMainBtn")?.addEventListener("click", makeMain);

    document.getElementById("newFileBtn")?.addEventListener("click", () => {
      const name = prompt("New file path on ESP32 (e.g. /test_led.py):", "/test_led.py");
      if (!name) return;
      const p = document.getElementById("editorPath");
      const ed = document.getElementById("fileEditor");
      if (p) p.value = name.startsWith("/") ? name : "/" + name;
      if (ed) {
        ed.disabled = false;
        ed.value = "# New MicroPython script\nprint('Hello from ESP32!')\n";
      }
    });

    const handleNewDir = async () => {
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
    };
    document.getElementById("newDirBtn")?.addEventListener("click", handleNewDir);
    document.getElementById("mkdirBtn")?.addEventListener("click", handleNewDir);

    const uploadInput = document.getElementById("fileUploadInput") || document.getElementById("uploadFilesInput");
    document.getElementById("pickUploadBtn")?.addEventListener("click", () => uploadInput?.click());
    document.getElementById("uploadBtn")?.addEventListener("click", () => uploadInput?.click());
    uploadInput?.addEventListener("change", (e) => uploadFiles(e.target.files));

    const tplSelect = document.getElementById("templateSelect");
    if (tplSelect) {
      tplSelect.addEventListener("change", () => {
        const key = tplSelect.value;
        if (!key || !STARTER_TEMPLATES[key]) return;
        const p = document.getElementById("editorPath");
        const ed = document.getElementById("fileEditor");
        if (p) p.value = STARTER_TEMPLATES[key].path;
        if (ed) {
          ed.disabled = false;
          ed.value = STARTER_TEMPLATES[key].code;
        }
        tplSelect.value = "";
        window.App.toast("Template loaded into editor! Click Save to ESP32 or Run File.");
      });
    }

    const dropzone = document.getElementById("fileDropzone");
    if (dropzone) {
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
  }

  window.FilesUI = { init, refreshFiles };
})();

