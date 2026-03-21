#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime, timezone


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "ping"
    if command != "ping":
        print(json.dumps({
            "status": "error",
            "error": f"unsupported command: {command}",
        }, ensure_ascii=False))
        return 1

    payload = {
        "status": "pong",
        "vram_free": "mock_data",
        "worker": "python",
        "worker_pid": os.getpid(),
        "observed_at": datetime.now(timezone.utc).isoformat(),
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
