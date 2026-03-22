#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


def run(command: list[str], cwd: Path) -> None:
    print(f"[verify_all] running: {' '.join(command)}")
    completed = subprocess.run(command, cwd=str(cwd))
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Miya verification gates.")
    parser.add_argument("--with-acceptance", action="store_true", help="also run npm run acceptance")
    args = parser.parse_args()

    npm = shutil.which("npm.cmd") or shutil.which("npm") or "npm"
    root = Path(__file__).resolve().parents[1]
    run([npm, "run", "check"], root)
    run([npm, "test"], root)
    if args.with_acceptance:
        run([npm, "run", "acceptance"], root)
    print("[verify_all] completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
