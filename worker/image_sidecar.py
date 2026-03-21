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
    models = payload.get("models", {}) if isinstance(payload.get("models"), dict) else {}

    result = {
        "status": "unavailable",
        "code": "image_runtime_unavailable",
        "reason": "diffusers is not installed" if not module_available("diffusers") else "local image executor is not attached yet",
        "models": models,
        "deps": {
            "diffusers": module_available("diffusers"),
            "transformers": module_available("transformers"),
            "accelerate": module_available("accelerate"),
            "safetensors": module_available("safetensors"),
        },
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
