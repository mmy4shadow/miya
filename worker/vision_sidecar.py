#!/usr/bin/env python3
import base64
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def emit(payload: Dict[str, Any]) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return 0


def read_input() -> Dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def sanitize_json_value(value: Any) -> Any:
    if isinstance(value, str):
        return value.encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, list):
        return [sanitize_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): sanitize_json_value(item) for key, item in value.items()}
    return value


def find_model_file(model_path: str) -> Optional[Path]:
    path = Path(model_path)
    if path.is_file():
        return path
    if not path.exists():
        return None
    matches = sorted(path.glob("*.gguf"))
    model_matches = [item for item in matches if not item.name.lower().startswith("mmproj")]
    return model_matches[0] if model_matches else None


def find_mmproj_file(model_path: str, explicit_mmproj_path: str) -> Optional[Path]:
    if explicit_mmproj_path:
        path = Path(explicit_mmproj_path)
        return path if path.is_file() else None

    model_dir = Path(model_path)
    if model_dir.is_file():
        model_dir = model_dir.parent
    if not model_dir.exists():
        return None

    candidates = sorted(model_dir.glob("mmproj*.gguf"))
    if not candidates:
        return None
    q8 = [item for item in candidates if "q8" in item.name.lower()]
    return q8[0] if q8 else candidates[0]


def find_binary(runtime_root: str, explicit_binary_path: str) -> Optional[Path]:
    if explicit_binary_path:
        path = Path(explicit_binary_path)
        return path if path.is_file() else None

    root = Path(runtime_root)
    if not root.exists():
        return None

    binary_names = ["llama-server.exe", "llama-server"]
    for name in binary_names:
        direct = root / name
        if direct.is_file():
            return direct
    for name in binary_names:
        matches = list(root.rglob(name))
        if matches:
            return matches[0]
    return None


def can_connect(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except OSError:
        return False


def http_json(method: str, url: str, payload: Optional[Dict[str, Any]] = None, timeout: float = 10.0) -> Dict[str, Any]:
    data = None
    headers = {"content-type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
        return json.loads(body) if body.strip() else {}


def server_state_path(runtime_root: Path, port: int) -> Path:
    state_dir = runtime_root / "miya-sidecar"
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir / f"server-{port}.json"


def write_state(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def wait_for_health(url: str, timeout_s: float) -> bool:
    started = time.time()
    while time.time() - started < timeout_s:
        try:
            http_json("GET", url, timeout=2.0)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def ensure_server(
    binary: Path,
    model_file: Path,
    mmproj_file: Path,
    runtime_root: Path,
    timeout_ms: int,
    host: str = "127.0.0.1",
    port: int = 43112,
) -> Tuple[str, Dict[str, Any]]:
    base_url = f"http://{host}:{port}"
    health_url = f"{base_url}/health"
    state_file = server_state_path(runtime_root, port)

    if can_connect(host, port):
        return base_url, {"status": "reused", "baseUrl": base_url, "stateFile": str(state_file)}

    runtime_root.mkdir(parents=True, exist_ok=True)
    log_dir = runtime_root / "miya-sidecar"
    log_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = log_dir / "llama-server.out.log"
    stderr_path = log_dir / "llama-server.err.log"
    stdout_handle = open(stdout_path, "ab")
    stderr_handle = open(stderr_path, "ab")

    command = [
        str(binary),
        "-m",
        str(model_file),
        "--mmproj",
        str(mmproj_file),
        "--host",
        host,
        "--port",
        str(port),
        "--alias",
        "miya-vision",
        "-c",
        "8192",
        "--jinja",
    ]

    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS  # type: ignore[attr-defined]

    process = subprocess.Popen(
        command,
        cwd=str(binary.parent),
        stdout=stdout_handle,
        stderr=stderr_handle,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
    )

    write_state(
        state_file,
        {
            "pid": process.pid,
            "baseUrl": base_url,
            "binary": str(binary),
            "model": str(model_file),
            "mmproj": str(mmproj_file),
            "stdout": str(stdout_path),
            "stderr": str(stderr_path),
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    )

    if not wait_for_health(health_url, max(timeout_ms / 1000.0, 5.0)):
        return base_url, {
            "status": "startup_failed",
            "baseUrl": base_url,
            "stateFile": str(state_file),
            "stdout": str(stdout_path),
            "stderr": str(stderr_path),
        }

    return base_url, {
        "status": "started",
        "baseUrl": base_url,
        "stateFile": str(state_file),
        "stdout": str(stdout_path),
        "stderr": str(stderr_path),
    }


def build_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "action": {"type": "string", "enum": ["activate_window", "click", "hotkey", "type_text", "press_key"]},
            "targetIndex": {"type": ["integer", "null"]},
            "x": {"type": ["number", "null"]},
            "y": {"type": ["number", "null"]},
            "windowTitle": {"type": ["string", "null"]},
            "text": {"type": ["string", "null"]},
            "key": {"type": ["string", "null"]},
            "hotkey": {
                "type": ["array", "null"],
                "items": {"type": "string"},
            },
            "confidence": {"type": "number"},
            "reason": {"type": "string"},
        },
        "required": ["action", "targetIndex", "x", "y", "windowTitle", "text", "key", "hotkey", "confidence", "reason"],
    }


def build_messages(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    goal = str(payload.get("goal", "")).strip()
    candidates = sanitize_json_value(payload.get("candidates", []))
    allowed_actions = sanitize_json_value(payload.get("allowedActions") or ["click", "activate_window", "hotkey", "type_text", "press_key"])
    image_b64 = (((payload.get("capture") or {}).get("image_base64")) if isinstance(payload.get("capture"), dict) else None) or ""
    image_mime = (((payload.get("capture") or {}).get("mime")) if isinstance(payload.get("capture"), dict) else None) or "image/jpeg"

    prompt = sanitize_json_value({
        "goal": goal,
        "allowedActions": allowed_actions,
        "window": ((payload.get("inspect") or {}).get("window")) if isinstance(payload.get("inspect"), dict) else None,
        "candidates": candidates,
        "instructions": [
            "Choose exactly one structured desktop action.",
            "Prefer targetIndex when selecting a visible control.",
            "If choosing click by coordinate, only do so when the target is visible in the screenshot.",
            "Do not invent hidden controls.",
            "Return JSON only.",
        ],
    })

    user_content: List[Dict[str, Any]] = [
        {"type": "text", "text": json.dumps(prompt, ensure_ascii=False)},
    ]
    if image_b64:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{image_mime};base64,{image_b64}",
                },
            }
        )

    return [
        {
            "role": "system",
            "content": "You are a desktop-action planner. Return one safe structured action matching the provided JSON schema. No markdown.",
        },
        {
            "role": "user",
            "content": user_content,
        },
    ]


def extract_message_content(response: Dict[str, Any]) -> str:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("vision response did not contain choices")
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and "text" in item:
                parts.append(str(item["text"]))
        if parts:
            return "".join(parts)
    raise ValueError("vision response did not contain text content")


def main() -> int:
    payload = read_input()
    vision = payload.get("visionConfig") if isinstance(payload.get("visionConfig"), dict) else {}
    timeout_ms = int((vision or {}).get("timeoutMs", 15000))
    model_path = str((vision or {}).get("modelPath", ""))
    runtime_root = Path(str((vision or {}).get("runtimeRoot", "")))
    binary = find_binary(str(runtime_root), str((vision or {}).get("binaryPath", "")))
    model_file = find_model_file(model_path)
    mmproj_file = find_mmproj_file(model_path, str((vision or {}).get("mmprojPath", "")))

    missing = []
    if not model_file:
        missing.append("model")
    if not mmproj_file:
        missing.append("mmproj")
    if not binary:
        missing.append("llama-server")
    if missing:
        return emit(
            {
                "status": "unavailable",
                "reason": f"vision runtime assets missing: {', '.join(missing)}",
                "details": {
                    "modelPath": model_path,
                    "runtimeRoot": str(runtime_root),
                    "binaryPath": str((vision or {}).get("binaryPath", "")),
                    "mmprojPath": str((vision or {}).get("mmprojPath", "")),
                    "resolvedModel": str(model_file) if model_file else None,
                    "resolvedMmproj": str(mmproj_file) if mmproj_file else None,
                    "resolvedBinary": str(binary) if binary else None,
                },
            }
        )

    base_url, server_meta = ensure_server(binary, model_file, mmproj_file, runtime_root, timeout_ms=timeout_ms)
    if server_meta.get("status") == "startup_failed":
        return emit(
            {
                "status": "unavailable",
                "reason": "vision server failed to become healthy",
                "details": server_meta,
            }
        )

    request_payload = {
        "model": "miya-vision",
        "temperature": 0,
        "messages": build_messages(payload),
        "response_format": {
            "type": "json_schema",
            "schema": build_schema(),
        },
    }

    try:
        response = http_json("POST", f"{base_url}/v1/chat/completions", request_payload, timeout=max(timeout_ms / 1000.0, 15.0))
        content = extract_message_content(response)
        decision = json.loads(content)
        if not isinstance(decision, dict):
            raise ValueError("vision response was not a JSON object")
        decision["status"] = "ok"
        decision["server"] = {
            "baseUrl": base_url,
            **server_meta,
        }
        return emit(decision)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return emit({"status": "error", "reason": f"vision HTTP {exc.code}: {detail}", "details": server_meta})
    except Exception as exc:
        return emit({"status": "error", "reason": str(exc), "details": server_meta})


if __name__ == "__main__":
    raise SystemExit(main())
