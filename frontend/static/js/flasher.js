/* Firmware Flasher (MicroPython & .bin), Multi-Offset Support, Other-Language Toolchains, OTA & Crash Decoder */

(function () {
  function getSelectedFlashPort() {
    const p = document.getElementById("flashPortSelect").value;
    if (!p) throw new Error("Select a target port (or SIMULATOR) first.");
    return p;
  }

  function populatePorts(ports, sim) {
    const sel = document.getElementById("flashPortSelect");
    if (!sel) return;
    const prev = sel.value;
    const opts = [];
    for (const p of ports || []) {
      opts.push(`<option value="${p.port}">${p.port} — ${p.chip_hint}</option>`);
    }
    if (sim) {
      opts.push(`<option value="${sim.port}">SIMULATOR — Practice Flashing Safely</option>`);
    }
    sel.innerHTML = opts.join("");
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function handleProgress(data) {
    const log = document.getElementById("flashLogBox");
    if (data.line) {
      log.textContent += data.line + "\n";
      log.scrollTop = log.scrollHeight;
    }
    if (data.pct != null) {
      document.getElementById("flashProgressBar").style.width = `${data.pct}%`;
      document.getElementById("flashPctLabel").textContent = `${data.pct}%`;
    }
  }

  function addBinPartRow(defaultOffset = "0x10000") {
    const container = document.getElementById("flashPartsList");
    const row = document.createElement("div");
    row.className = "flash-part-row";
    row.innerHTML = `
      <input type="text" class="input part-offset" value="${defaultOffset}" style="width:110px" placeholder="0x1000" />
      <input type="file" class="input part-file" accept=".bin" />
      <button type="button" class="btn btn-sm btn-danger remove-part-btn">Remove</button>
    `;
    row.querySelector(".remove-part-btn").addEventListener("click", () => {
      if (container.children.length > 1) row.remove();
    });
    container.appendChild(row);
  }

  async function probeChip() {
    const log = document.getElementById("flashLogBox");
    try {
      const port = getSelectedFlashPort();
      log.textContent = `Probing chip on ${port}...\n`;
      const res = await window.App.api("/api/flash/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port, baud: 115200 }),
      });
      document.getElementById("probeSummary").innerHTML = `
        <strong>Chip:</strong> ${res.chip} &nbsp;|&nbsp;
        <strong>Flash:</strong> ${res.flash_size} &nbsp;|&nbsp;
        <strong>MAC:</strong> <code>${res.mac}</code>
      `;
      log.textContent += res.raw_log + "\n";
      window.Learning.completeMission("flash");
    } catch (err) {
      log.textContent += err.message + "\n";
      window.App.toast(err.message, true);
    }
  }

  async function eraseFlash() {
    try {
      const port = getSelectedFlashPort();
      if (port !== "SIMULATOR" && !confirm(`Erase ALL flash data on ${port}?`)) return;
      document.getElementById("flashLogBox").textContent = `Erasing flash on ${port}...\n`;
      document.getElementById("flashProgressBar").style.width = "10%";
      await window.App.api("/api/flash/erase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port, baud: 460800 }),
      });
      document.getElementById("flashProgressBar").style.width = "100%";
      document.getElementById("flashPctLabel").textContent = "100%";
      window.App.toast("Flash erased cleanly!");
      window.Learning.completeMission("flash");
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function writeFirmware() {
    const log = document.getElementById("flashLogBox");
    try {
      const port = getSelectedFlashPort();
      const chip = document.getElementById("flashChipSelect").value;
      const baud = document.getElementById("flashBaudSelect").value;
      const eraseFirst = document.getElementById("eraseBeforeFlash").checked;

      const rows = [...document.querySelectorAll(".flash-part-row")];
      const offsets = [];
      const form = new FormData();
      form.append("port", port);
      form.append("chip", chip);
      form.append("baud", baud);
      form.append("erase_first", eraseFirst ? "true" : "false");

      for (const r of rows) {
        const off = r.querySelector(".part-offset").value.trim();
        const fileEl = r.querySelector(".part-file");
        if (fileEl.files.length > 0) {
          offsets.push(off || "0x1000");
          form.append("files", fileEl.files[0], fileEl.files[0].name);
        }
      }

      if (!offsets.length && port === "SIMULATOR") {
        // Allow simulator practice flash even if user didn't pick a .bin file on disk!
        offsets.push(rows[0].querySelector(".part-offset").value.trim() || "0x0");
        const fakeBlob = new Blob(["SIMULATED_MICROPYTHON_FIRMWARE"], { type: "application/octet-stream" });
        form.append("files", fakeBlob, "micropython-esp32s3-demo.bin");
      } else if (!offsets.length) {
        throw new Error("Choose at least one .bin firmware file to flash.");
      }

      form.append("offsets_json", JSON.stringify(offsets));
      log.textContent = `Starting esptool write_flash on ${port}...\n`;
      document.getElementById("flashProgressBar").style.width = "5%";

      const resp = await fetch("/api/flash/write", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Flash failed");
      document.getElementById("flashProgressBar").style.width = "100%";
      document.getElementById("flashPctLabel").textContent = "100%";
      window.App.toast("Firmware flashed successfully!");
      window.Learning.completeMission("flash");
    } catch (err) {
      log.textContent += err.message + "\n";
      window.App.toast(err.message, true);
    }
  }

  async function loadToolchains() {
    try {
      const tc = await window.App.api("/api/toolchains");
      const badges = [
        `esptool: ${tc.esptool ? "Ready" : "Missing"}`,
        `arduino-cli: ${tc.arduino_cli ? "Found" : "Not installed"}`,
        `platformio: ${tc.platformio ? "Found" : "Not installed"}`,
        `idf.py: ${tc.idf_py ? "Found" : "Not installed"}`,
      ];
      document.getElementById("toolchainBadges").textContent = badges.join(" | ");
    } catch (_) {}
  }

  async function flashLocalBin(binPath, offset = "0x10000") {
    try {
      const port = getSelectedFlashPort();
      const chip = document.getElementById("flashChipSelect").value;
      const baud = Number(document.getElementById("flashBaudSelect").value || 460800);
      const erase_first = document.getElementById("eraseBeforeFlash").checked;
      document.getElementById("flashLogBox").textContent = `Flashing local build ${binPath} at ${offset}...\n`;
      await window.App.api("/api/flash/write-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port, chip, baud, erase_first, entries: [{ offset, path: binPath }] }),
      });
      document.getElementById("flashProgressBar").style.width = "100%";
      document.getElementById("flashPctLabel").textContent = "100%";
      window.App.toast(`Flashed ${binPath} at ${offset}!`);
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  function guessBinOffset(binPath, chip) {
    const low = binPath.toLowerCase();
    if (low.includes("bootloader")) return ["esp32s2", "esp32s3", "esp32c3", "esp32c6"].includes(chip) ? "0x0" : "0x1000";
    if (low.includes("partition")) return "0x8000";
    return "0x10000";
  }

  function renderFoundBins(bins) {
    const chip = document.getElementById("flashChipSelect").value;
    if (!bins || !bins.length) return "None yet (compile first)";
    return bins
      .map((b) => {
        const off = guessBinOffset(b, chip);
        return `<div style="margin:4px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <code>${b}</code>
          <button type="button" class="btn btn-sm btn-green flash-found-bin-btn" data-path="${b}" data-offset="${off}">Flash @ ${off}</button>
        </div>`;
      })
      .join("");
  }

  async function inspectProject() {
    const dir = document.getElementById("projectDirInput").value.trim();
    if (!dir) return window.App.toast("Enter a local C++/Arduino/PlatformIO/ESP-IDF folder path.", true);
    try {
      const res = await window.App.api("/api/toolchains/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_dir: dir }),
      });
      const outEl = document.getElementById("projectInspectOut");
      outEl.innerHTML = `
        <div><strong>Detected Frameworks:</strong> ${res.frameworks.join(", ")}</div>
        <div><strong>Compiled .bin files found:</strong> ${renderFoundBins(res.bin_files)}</div>
      `;
      outEl.querySelectorAll(".flash-found-bin-btn").forEach((btn) => {
        btn.addEventListener("click", () => flashLocalBin(btn.dataset.path, btn.dataset.offset));
      });
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function buildProject() {
    const project_dir = document.getElementById("projectDirInput").value.trim();
    const framework = document.getElementById("buildFrameworkSelect").value;
    if (!project_dir) return window.App.toast("Enter project directory path first.", true);
    try {
      const res = await window.App.api("/api/toolchains/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_dir, framework }),
      });
      document.getElementById("flashLogBox").textContent = res.log || "Build succeeded!";
      const outEl = document.getElementById("projectInspectOut");
      outEl.innerHTML = `<div><strong>Compiled .bin files:</strong> ${renderFoundBins(res.bin_files)}</div>`;
      outEl.querySelectorAll(".flash-found-bin-btn").forEach((btn) => {
        btn.addEventListener("click", () => flashLocalBin(btn.dataset.path, btn.dataset.offset));
      });
      window.App.toast(`Build succeeded! Found ${res.bin_files.length} .bin file(s).`);
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function sendOta() {
    const mode = document.getElementById("otaModeSelect").value;
    const target = document.getElementById("otaTargetInput").value.trim();
    const port = document.getElementById("otaPortInput").value.trim() || "3232";
    const password = document.getElementById("otaPassInput").value;
    const fileInput = document.getElementById("otaBinInput");
    if (!target) return window.App.toast("Enter ESP32 OTA URL or IP address.", true);
    if (!fileInput.files.length) return window.App.toast("Choose a compiled .bin firmware file.", true);

    const form = new FormData();
    form.append("mode", mode);
    form.append("target", target);
    form.append("port", port);
    form.append("password", password);
    form.append("file", fileInput.files[0], fileInput.files[0].name);
    try {
      const resp = await fetch("/api/ota/upload", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "OTA upload failed");
      window.App.toast("Wireless OTA update sent successfully!");
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  async function decodeCrash() {
    const log_text = document.getElementById("crashLogInput").value;
    const elf_path = document.getElementById("crashElfInput").value.trim() || null;
    try {
      const res = await window.App.api("/api/crash/decode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log_text, elf_path }),
      });
      const out = document.getElementById("crashDecodeOut");
      const findingsHtml = (res.findings || [])
        .map((f) => `<div style="margin-bottom:6px"><strong>${f.kind}:</strong> ${f.detail}<br><span class="muted">${f.plain_english}</span></div>`)
        .join("");
      const btHtml = res.resolved_backtrace?.length
        ? `<div><strong>Resolved Source Lines:</strong><pre>${res.resolved_backtrace.join("\n")}</pre></div>`
        : res.addresses?.length
        ? `<div class="muted">Backtrace PCs: ${res.addresses.join(", ")} (add .elf path + addr2line to resolve file:line)</div>`
        : "";
      out.innerHTML = findingsHtml + btHtml;
    } catch (err) {
      window.App.toast(err.message, true);
    }
  }

  function init() {
    document.getElementById("probeChipBtn")?.addEventListener("click", probeChip);
    document.getElementById("eraseFlashBtn")?.addEventListener("click", eraseFlash);
    document.getElementById("writeFlashBtn")?.addEventListener("click", writeFirmware);
    document.getElementById("flashWriteBtn")?.addEventListener("click", writeFirmware);
    document.getElementById("addFlashPartBtn")?.addEventListener("click", () => addBinPartRow("0x10000"));
    document.getElementById("flashChipSelect")?.addEventListener("change", (e) => {
      const rows = document.querySelectorAll(".flash-part-row .part-offset");
      if (rows.length === 1) {
        const chip = e.target.value;
        rows[0].value = ["esp32s2", "esp32s3", "esp32c3", "esp32c6"].includes(chip) ? "0x0" : "0x1000";
      }
    });
    document.getElementById("presetCppOffsetsBtn")?.addEventListener("click", () => {
      const c = document.getElementById("flashPartsList");
      if (!c) return;
      const chip = document.getElementById("flashChipSelect")?.value || "esp32";
      const bootOffset = ["esp32s2", "esp32s3", "esp32c3", "esp32c6"].includes(chip) ? "0x0" : "0x1000";
      c.innerHTML = "";
      addBinPartRow(bootOffset);
      addBinPartRow("0x8000");
      addBinPartRow("0x10000");
      window.App.toast(`Added C++ / Arduino / ESP-IDF 3-part offsets (${bootOffset}, 0x8000, 0x10000).`);
    });

    document.getElementById("inspectProjBtn")?.addEventListener("click", inspectProject);
    document.getElementById("buildProjBtn")?.addEventListener("click", buildProject);
    document.getElementById("sendOtaBtn")?.addEventListener("click", sendOta);
    document.getElementById("decodeCrashBtn")?.addEventListener("click", decodeCrash);

    loadToolchains();
  }

  window.FlasherUI = { init, populatePorts, handleProgress };
})();

