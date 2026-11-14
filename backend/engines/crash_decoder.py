"""Plain-English decoder for ESP32 reset reasons, brownouts, and Guru Meditation panics."""

import re
import shutil
import subprocess
from typing import Optional

MICROPYTHON_RESET_CAUSES = {
    1: {
        "code": "PWRON_RESET",
        "title": "Normal Power-On Reset",
        "meaning": "The ESP32 woke up cleanly from power being plugged in or turned on.",
        "fix": "No issue — normal healthy startup!",
        "severity": "ok",
    },
    2: {
        "code": "HARD_RESET",
        "title": "External / EN Button Hard Reset",
        "meaning": "Someone pressed the EN/RST button or the console toggled the hardware Reset pin.",
        "fix": "Normal if you clicked Hard Reset or pressed EN.",
        "severity": "info",
    },
    3: {
        "code": "WDT_RESET",
        "title": "Watchdog Timer Reset (Code Froze!)",
        "meaning": "Your code stayed busy in a loop too long without pausing (`time.sleep`) or feeding the watchdog, so the ESP32 rebooted itself to recover.",
        "fix": "Add `time.sleep_ms(10)` inside `while True:` loops or yield periodically.",
        "severity": "warn",
    },
    4: {
        "code": "DEEPSLEEP_RESET",
        "title": "Woke Up From Deep Sleep",
        "meaning": "The ESP32 was intentionally saving battery in Deep Sleep and woke up on schedule or via GPIO.",
        "fix": "Normal if using `machine.deepsleep()`.",
        "severity": "info",
    },
    5: {
        "code": "SOFT_RESET",
        "title": "Soft Reboot (Ctrl+D / machine.soft_reset)",
        "meaning": "Python restarted cleanly without cutting hardware power.",
        "fix": "Normal after uploading code or pressing Soft Reset.",
        "severity": "info",
    },
    6: {
        "code": "BROWNOUT_RESET",
        "title": "Brownout Reset (Power Voltage Dropped!)",
        "meaning": "The ESP32 didn't get enough electrical power (voltage dipped below ~2.4V), often when turning on Wi-Fi.",
        "fix": "Try a shorter/thicker USB data cable, a powered USB hub, or an external 5V supply.",
        "severity": "error",
    },
}

PANIC_CAUSES = {
    "LoadProhibited": "Your code tried to read from an invalid or NULL memory address (common in C++ when using an uninitialized pointer).",
    "StoreProhibited": "Your code tried to write to protected or NULL memory (array out of bounds or uninitialized pointer).",
    "InstrFetchProhibited": "CPU tried to jump to an invalid function pointer or corrupted flash memory address.",
    "IllegalInstruction": "Corrupted binary, wrong board/chip selected when flashing, or bad memory jump.",
    "Interrupt wdt timeout": "An interrupt handler (ISR) took too long and starved the CPU.",
    "Task watchdog": "A FreeRTOS task hogged the CPU without calling `delay()` / `vTaskDelay()`.",
    "Stack overflow": "A function nested too deeply or allocated huge local arrays on the stack.",
    "Unhandled C++ exception": "An uncaught C++ exception crashed the firmware.",
}


def explain_reset_cause(cause_code: Optional[int]) -> dict:
    if cause_code is None:
        return {
            "code": "UNKNOWN",
            "title": "Reset Reason Not Checked Yet",
            "meaning": "Connect to MicroPython and read metrics to see why the board last started.",
            "fix": "",
            "severity": "info",
        }
    return MICROPYTHON_RESET_CAUSES.get(
        int(cause_code),
        {
            "code": f"CODE_{cause_code}",
            "title": f"Reset Code {cause_code}",
            "meaning": "Hardware-specific reset code reported by ESP-IDF.",
            "fix": "Check serial boot banner `rst:0x...` for more detail.",
            "severity": "info",
        },
    )


def detect_log_alert(line: str) -> Optional[dict]:
    """Inspect a serial log line and emit a beginner-friendly alert if an error/reset banner appears."""
    lower = line.lower()
    if "brownout detector was triggered" in lower:
        return {
            "severity": "error",
            "title": "Power Brownout Detected!",
            "summary": "Your ESP32 lost voltage (usually right when turning on Wi-Fi) and rebooted itself.",
            "fix": "Use a shorter/stronger USB cable, plug directly into a PC port, or power via a stable 5V pin.",
        }
    if "guru meditation error" in lower:
        panic_match = re.search(r"panic'ed\s*\(([^)]+)\)", line)
        reason = panic_match.group(1) if panic_match else "CPU Panic"
        explanation = next((v for k, v in PANIC_CAUSES.items() if k.lower() in reason.lower()), "Firmware hit a critical memory or CPU fault.")
        return {
            "severity": "error",
            "title": f"ESP32 Crash: {reason}",
            "summary": explanation,
            "fix": "Paste the full crash log in Flash & Other Languages -> Crash Decoder to inspect the Backtrace.",
        }
    if "invalid head of packet" in lower or "flash read err" in lower:
        return {
            "severity": "error",
            "title": "Flash Read Error / Blank or Corrupted Firmware",
            "summary": "The chip could not boot valid firmware from flash memory.",
            "fix": "Go to Flash & Firmware tab, Erase Flash, and re-flash MicroPython or your .bin firmware.",
        }
    return None


def decode_crash_text(log_text: str, elf_path: Optional[str] = None) -> dict:
    """Parse pasted ESP32 serial crash output (and optionally resolve addresses with addr2line)."""
    panic_match = re.search(r"Guru Meditation Error:\s*Core\s*(\d+)\s*panic'ed\s*\(([^)]+)\)", log_text)
    bt_match = re.search(r"Backtrace:\s*([^\r\n]+)", log_text)
    rst_match = re.search(r"rst:(0x[0-9a-fA-F]+)\s*\(([^)]+)\)", log_text)

    findings = []
    if panic_match:
        core, reason = panic_match.group(1), panic_match.group(2)
        findings.append({
            "kind": "Panic",
            "detail": f"Core {core} panicked with `{reason}`",
            "plain_english": next((v for k, v in PANIC_CAUSES.items() if k.lower() in reason.lower()), "Fatal runtime exception."),
        })
    if rst_match:
        findings.append({
            "kind": "Reset Banner",
            "detail": f"{rst_match.group(1)} ({rst_match.group(2)})",
            "plain_english": "Boot ROM reported why the chip restarted.",
        })
    if "brownout" in log_text.lower():
        findings.append({
            "kind": "Power Issue",
            "detail": "Brownout detector triggered",
            "plain_english": "Power supply voltage dropped too low (often caused by thin USB cables).",
        })

    addresses = []
    resolved_lines = []
    if bt_match:
        addresses = re.findall(r"0x4[0-9a-fA-F]{7}", bt_match.group(1))
        if elf_path and addresses:
            for tool in ("xtensa-esp32-elf-addr2line", "xtensa-esp32s3-elf-addr2line", "riscv32-esp-elf-addr2line", "addr2line"):
                exe = shutil.which(tool)
                if exe:
                    try:
                        proc = subprocess.run([exe, "-pfiaC", "-e", elf_path, *addresses], capture_output=True, text=True, timeout=6)
                        if proc.returncode == 0 and proc.stdout.strip():
                            resolved_lines = proc.stdout.strip().splitlines()
                            break
                    except Exception:
                        pass

    if not findings and not addresses:
        findings.append({
            "kind": "No Panic Found",
            "detail": "No Guru Meditation / Backtrace pattern matched.",
            "plain_english": "Paste the full serial output starting from `rst:0x...` or `Guru Meditation Error:`.",
        })

    return {
        "findings": findings,
        "addresses": addresses,
        "resolved_backtrace": resolved_lines,
    }

