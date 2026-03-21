#!/usr/bin/env python3
import base64
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

USER_ACTIVE_UNTIL = 0.0
USER_MUTEX_WINDOW_SECONDS = 3.0
_MONITOR_STARTED = False
_MONITOR_ERRORS: List[str] = []


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def set_user_active() -> None:
    global USER_ACTIVE_UNTIL
    USER_ACTIVE_UNTIL = time.time() + USER_MUTEX_WINDOW_SECONDS


def is_user_active() -> bool:
    return time.time() < USER_ACTIVE_UNTIL


def start_human_mutex_monitor() -> None:
    global _MONITOR_STARTED
    if _MONITOR_STARTED:
        return
    _MONITOR_STARTED = True
    try:
        from pynput import keyboard, mouse  # type: ignore
    except Exception as exc:
        _MONITOR_ERRORS.append(f"pynput unavailable: {exc}")
        return

    def on_mouse_move(*_args: Any) -> None:
        set_user_active()

    def on_mouse_click(*_args: Any) -> None:
        set_user_active()

    def on_mouse_scroll(*_args: Any) -> None:
        set_user_active()

    def on_key_press(*_args: Any) -> None:
        set_user_active()

    try:
        mouse.Listener(on_move=on_mouse_move, on_click=on_mouse_click, on_scroll=on_mouse_scroll, daemon=True).start()
        keyboard.Listener(on_press=on_key_press, daemon=True).start()
    except Exception as exc:
        _MONITOR_ERRORS.append(f"pynput listener failed: {exc}")


def emit(payload: Dict[str, Any]) -> int:
    text = json.dumps(payload, ensure_ascii=False)
    try:
        sys.stdout.write(text + "\n")
    except UnicodeEncodeError:
        sys.stdout.buffer.write(text.encode("utf-8", errors="replace") + b"\n")
    return 0


def error_payload(message: str, **extra: Any) -> Dict[str, Any]:
    return {
        "status": "error",
        "error": message,
        "observed_at": now_iso(),
        **extra,
    }


def power_shell_capture() -> bytes:
    script = r'''
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())
'''
    result = subprocess.run([
        "powershell",
        "-NoProfile",
        "-Command",
        script,
    ], capture_output=True, text=True, check=True)
    return base64.b64decode(result.stdout.strip())


def capture_screen(max_edge: int = 1280, jpeg_quality: int = 60) -> Dict[str, Any]:
    image = None
    source = "unknown"
    pil_error = None
    try:
        from PIL import Image, ImageGrab  # type: ignore
        image = ImageGrab.grab(all_screens=True)
        source = "PIL.ImageGrab"
    except Exception as exc:
        pil_error = str(exc)
        try:
            from PIL import Image  # type: ignore
            image = Image.open(io.BytesIO(power_shell_capture()))
            source = "PowerShell.System.Drawing"
        except Exception as fallback_exc:
            raise RuntimeError(f"screen capture failed: PIL={pil_error}; fallback={fallback_exc}")

    width, height = image.size
    scale = min(1.0, float(max_edge) / float(max(width, height)))
    if scale < 1.0:
        target = (max(1, int(width * scale)), max(1, int(height * scale)))
        image = image.resize(target)
    else:
        target = (width, height)

    rgb = image.convert("RGB")
    buffer = io.BytesIO()
    rgb.save(buffer, format="JPEG", quality=jpeg_quality, optimize=True)
    raw = buffer.getvalue()
    return {
        "status": "ok",
        "kind": "capture",
        "image_base64": base64.b64encode(raw).decode("ascii"),
        "mime": "image/jpeg",
        "width": target[0],
        "height": target[1],
        "bytes": len(raw),
        "source": source,
        "observed_at": now_iso(),
    }


def inspect_ui(max_items: int = 120) -> Dict[str, Any]:
    try:
        import uiautomation as auto  # type: ignore
    except Exception as exc:
        return error_payload(f"uiautomation unavailable: {exc}", kind="inspect_ui")

    try:
        root = auto.GetForegroundControl()
    except Exception as exc:
        return error_payload(f"failed to get foreground control: {exc}", kind="inspect_ui")

    allowed = {"ButtonControl", "EditControl", "TabItemControl", "ListItemControl", "MenuItemControl", "CheckBoxControl", "RadioButtonControl", "HyperlinkControl", "ComboBoxControl"}
    items: List[Dict[str, Any]] = []
    debug_visible: List[Dict[str, Any]] = []

    def walk(control: Any, depth: int = 0) -> None:
        if len(items) >= max_items or control is None:
            return
        try:
            control_type = getattr(control, "ControlTypeName", "") or ""
            is_offscreen = bool(getattr(control, "IsOffscreen", True))
            rect = getattr(control, "BoundingRectangle", None)
            name = (getattr(control, "Name", "") or "").strip()
            enabled = bool(getattr(control, "IsEnabled", True))
            if not is_offscreen and len(debug_visible) < 20:
                debug_visible.append({
                    "name": name,
                    "controlType": control_type,
                    "enabled": enabled,
                })
            if not is_offscreen and control_type in allowed:
                items.append({
                    "index": len(items) + 1,
                    "name": name,
                    "controlType": control_type,
                    "enabled": enabled,
                    "rect": {
                        "left": int(getattr(rect, "left", 0)),
                        "top": int(getattr(rect, "top", 0)),
                        "right": int(getattr(rect, "right", 0)),
                        "bottom": int(getattr(rect, "bottom", 0)),
                    },
                })
            for child in control.GetChildren():
                if len(items) >= max_items:
                    break
                walk(child, depth + 1)
        except Exception:
            return

    walk(root)
    window_rect = getattr(root, "BoundingRectangle", None)
    return {
        "status": "ok",
        "kind": "inspect_ui",
        "window": {
            "name": (getattr(root, "Name", "") or "").strip(),
            "controlType": getattr(root, "ControlTypeName", "") or "",
            "rect": {
                "left": int(getattr(window_rect, "left", 0)),
                "top": int(getattr(window_rect, "top", 0)),
                "right": int(getattr(window_rect, "right", 0)),
                "bottom": int(getattr(window_rect, "bottom", 0)),
            },
        },
        "items": items,
        "count": len(items),
        "max_items": max_items,
        "debug_visible": debug_visible,
        "note": "No standard interactive controls found in the foreground window." if not items else None,
        "observed_at": now_iso(),
    }


def success_payload(kind: str, **extra: Any) -> Dict[str, Any]:
    return {
        "status": "ok",
        "kind": kind,
        "observed_at": now_iso(),
        **extra,
    }


def with_human_mutex(kind: str, dry_run: bool = False) -> Optional[Dict[str, Any]]:
    start_human_mutex_monitor()
    if is_user_active():
        return error_payload(
            "Action aborted: User is actively using the computer.",
            kind=kind,
            human_mutex=True,
            dry_run=dry_run,
        )
    return None


def human_mutex_payload() -> Dict[str, Any]:
    return {
        "active": is_user_active(),
        "window_seconds": USER_MUTEX_WINDOW_SECONDS,
        "monitor_errors": _MONITOR_ERRORS,
    }


def click_point(x: int, y: int, dry_run: bool = False) -> Dict[str, Any]:
    blocked = with_human_mutex("click", dry_run=dry_run)
    if blocked:
        return blocked

    if dry_run:
        return success_payload(
            "click",
            x=x,
            y=y,
            dry_run=True,
            source="dry-run",
            human_mutex=human_mutex_payload(),
        )

    pyauto_error = None
    try:
        import pyautogui  # type: ignore
        pyautogui.click(x=x, y=y)
        source = "pyautogui"
    except Exception as exc:
        pyauto_error = str(exc)
        script = f"Add-Type '[DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint a,uint b,uint c,uint d,UIntPtr e);' -Name U -Namespace Win32; [Win32.U]::SetCursorPos({x},{y}) | Out-Null; [Win32.U]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [Win32.U]::mouse_event(4,0,0,0,[UIntPtr]::Zero)"
        try:
            subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True, capture_output=True, text=True)
            source = "powershell.user32"
        except Exception as fallback_exc:
            return error_payload(f"click failed: pyautogui={pyauto_error}; fallback={fallback_exc}", kind="click", human_mutex=False)

    return success_payload(
        "click",
        x=x,
        y=y,
        source=source,
        human_mutex=human_mutex_payload(),
    )


def activate_window(title: str) -> Dict[str, Any]:
    normalized_title = title.strip()
    if not normalized_title:
        return error_payload("activate_window requires title", kind="activate_window")

    try:
        import uiautomation as auto  # type: ignore

        root = auto.GetRootControl()
        for child in root.GetChildren():
            try:
                name = (getattr(child, "Name", "") or "").strip()
                if normalized_title.lower() in name.lower():
                    child.SetActive()
                    return success_payload(
                        "activate_window",
                        title=normalized_title,
                        matched=name,
                        source="uiautomation",
                    )
            except Exception:
                continue
    except Exception:
        pass

    script = f"""
Add-Type -AssemblyName Microsoft.VisualBasic
$ok = [Microsoft.VisualBasic.Interaction]::AppActivate({json.dumps(normalized_title)})
if ($ok) {{
  Write-Output "ok"
}} else {{
  Write-Error "window not found"
  exit 1
}}
"""
    try:
        subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True, capture_output=True, text=True)
        return success_payload(
            "activate_window",
            title=normalized_title,
            matched=normalized_title,
            source="powershell.appactivate",
        )
    except Exception as exc:
        return error_payload(f"activate_window failed: {exc}", kind="activate_window", title=normalized_title)


def normalize_key_name(key: str) -> str:
    value = key.strip().lower()
    aliases = {
        "control": "ctrl",
        "return": "enter",
        "esc": "escape",
        "win": "winleft",
        "windows": "winleft",
        "cmd": "winleft",
        "del": "delete",
        "ins": "insert",
        "pgup": "pageup",
        "pgdn": "pagedown",
    }
    return aliases.get(value, value)


def send_keys_with_pyautogui(kind: str, keys: List[str], dry_run: bool = False, text: Optional[str] = None) -> Dict[str, Any]:
    blocked = with_human_mutex(kind, dry_run=dry_run)
    if blocked:
        return blocked

    if dry_run:
        return success_payload(
            kind,
            dry_run=True,
            keys=keys or None,
            text=text,
            source="dry-run",
            human_mutex=human_mutex_payload(),
        )

    try:
        import pyautogui  # type: ignore

        if text is not None:
            pyautogui.write(text)
        elif kind == "hotkey":
            pyautogui.hotkey(*keys)
        elif keys:
            pyautogui.press(keys[0])
        return success_payload(
            kind,
            keys=keys or None,
            text=text,
            source="pyautogui",
            human_mutex=human_mutex_payload(),
        )
    except Exception as exc:
        return error_payload(f"{kind} failed: {exc}", kind=kind, human_mutex=False, keys=keys or None, text=text)


def press_key(key: str, dry_run: bool = False) -> Dict[str, Any]:
    normalized = normalize_key_name(key)
    if not normalized:
        return error_payload("press_key requires key", kind="press_key")
    return send_keys_with_pyautogui("press_key", [normalized], dry_run=dry_run)


def hotkey_press(keys: List[str], dry_run: bool = False) -> Dict[str, Any]:
    normalized = [normalize_key_name(key) for key in keys if str(key).strip()]
    if not normalized:
        return error_payload("hotkey requires at least one key", kind="hotkey")
    return send_keys_with_pyautogui("hotkey", normalized, dry_run=dry_run)


def type_text(text: str, dry_run: bool = False) -> Dict[str, Any]:
    if not text:
        return error_payload("type_text requires text", kind="type_text")
    return send_keys_with_pyautogui("type_text", [], dry_run=dry_run, text=text)


def parse_hotkey_argument(raw: str) -> List[str]:
    value = raw.strip()
    if not value:
        return []
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except Exception:
        pass
    return [segment.strip() for segment in re.split(r"[+,]", value) if segment.strip()]


def ping() -> Dict[str, Any]:
    return {
        "status": "pong",
        "vram_free": "mock_data",
        "worker": "python",
        "worker_pid": os.getpid(),
        "observed_at": now_iso(),
    }


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "ping"
    if command == "ping":
        return emit(ping())
    if command == "capture":
        max_edge = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
        jpeg_quality = int(sys.argv[3]) if len(sys.argv) > 3 else 60
        return emit(capture_screen(max_edge=max_edge, jpeg_quality=jpeg_quality))
    if command == "inspect_ui":
        max_items = int(sys.argv[2]) if len(sys.argv) > 2 else 120
        return emit(inspect_ui(max_items=max_items))
    if command == "activate_window":
        title = sys.argv[2] if len(sys.argv) > 2 else ""
        return emit(activate_window(title))
    if command == "click":
        if len(sys.argv) < 4:
            return emit(error_payload("click requires x y", kind="click"))
        dry_run = len(sys.argv) > 4 and sys.argv[4].lower() in {"1", "true", "yes", "dry-run"}
        return emit(click_point(int(sys.argv[2]), int(sys.argv[3]), dry_run=dry_run))
    if command == "press_key":
        if len(sys.argv) < 3:
            return emit(error_payload("press_key requires key", kind="press_key"))
        dry_run = len(sys.argv) > 3 and sys.argv[3].lower() in {"1", "true", "yes", "dry-run"}
        return emit(press_key(sys.argv[2], dry_run=dry_run))
    if command == "hotkey":
        if len(sys.argv) < 3:
            return emit(error_payload("hotkey requires keys", kind="hotkey"))
        dry_run = len(sys.argv) > 3 and sys.argv[3].lower() in {"1", "true", "yes", "dry-run"}
        return emit(hotkey_press(parse_hotkey_argument(sys.argv[2]), dry_run=dry_run))
    if command == "type_text":
        if len(sys.argv) < 3:
            return emit(error_payload("type_text requires text", kind="type_text"))
        dry_run = len(sys.argv) > 3 and sys.argv[3].lower() in {"1", "true", "yes", "dry-run"}
        return emit(type_text(sys.argv[2], dry_run=dry_run))
    return emit(error_payload(f"unsupported command: {command}"))


if __name__ == "__main__":
    raise SystemExit(main())
