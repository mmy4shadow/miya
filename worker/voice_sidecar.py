#!/usr/bin/env python3
import importlib
import json
import sys


def read_payload():
    raw = sys.stdin.read().strip()
    return json.loads(raw) if raw else {}


def module_available(name: str) -> bool:
    try:
        importlib.import_module(name)
        return True
    except Exception:
        return False


def main() -> int:
    payload = read_payload()
    action = str(payload.get("action", "")).strip()
    assets = payload.get("assets", {}) if isinstance(payload.get("assets"), dict) else {}

    has_qwen_tts = module_available("qwen_tts")
    has_numpy = module_available("numpy")
    has_soundfile = module_available("soundfile")

    if action == "transcribe":
        result = {
            "status": "unavailable",
            "code": "voice_runtime_unavailable",
            "reason": "local ASR executor is not attached yet",
            "action": action,
            "assets": assets,
            "deps": {
                "numpy": has_numpy,
                "soundfile": has_soundfile,
            },
        }
    elif action == "synthesize":
        result = {
            "status": "unavailable",
            "code": "voice_runtime_unavailable",
            "reason": "qwen-tts is not installed" if not has_qwen_tts else "local TTS executor is not attached yet",
            "action": action,
            "assets": assets,
            "deps": {
                "qwen_tts": has_qwen_tts,
                "numpy": has_numpy,
                "soundfile": has_soundfile,
            },
        }
    else:
        result = {
            "status": "unavailable",
            "code": "voice_runtime_unavailable",
            "reason": "local speaker identification executor is not attached yet",
            "action": action,
            "assets": assets,
            "deps": {
                "numpy": has_numpy,
                "soundfile": has_soundfile,
            },
        }

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
