import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function makeTempWorker() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-runner-test-"));
  const workerDir = path.join(root, "worker");
  fs.mkdirSync(workerDir, { recursive: true });
  fs.writeFileSync(path.join(workerDir, "desktop_worker.py"), `
import json
import sys

command = sys.argv[1] if len(sys.argv) > 1 else "ping"
if command == "capture":
    print(json.dumps({
        "status": "ok",
        "kind": "capture",
        "bytes": 1234,
        "width": 640,
        "height": 360,
        "source": "test-command-fallback"
    }))
else:
    print(json.dumps({"status": "pong", "worker": "test-worker"}))
`, "utf8");
  return root;
}

test("runDesktopWorker falls back to command transport when HTTP capture fails", async (t) => {
  const tempRoot = makeTempWorker();
  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const previousEnv = {
    MIYA_PLUGIN_ROOT: process.env.MIYA_PLUGIN_ROOT,
    MIYA_DESKTOP_WORKER_TRANSPORT: process.env.MIYA_DESKTOP_WORKER_TRANSPORT,
    MIYA_DESKTOP_WORKER_ENDPOINT: process.env.MIYA_DESKTOP_WORKER_ENDPOINT,
    MIYA_PYTHON: process.env.MIYA_PYTHON,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
  };

  process.env.MIYA_PLUGIN_ROOT = tempRoot;
  process.env.MIYA_DESKTOP_WORKER_TRANSPORT = "http";
  process.env.MIYA_DESKTOP_WORKER_ENDPOINT = "http://127.0.0.1:9";
  process.env.MIYA_PYTHON = "python";
  delete process.env.OPENCLAW_CONFIG_PATH;

  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const moduleUrl = `${pathToFileURL(path.resolve("scripts/desktop-worker-runner.mjs")).href}?test=${Date.now()}`;
  const { runDesktopWorker } = await import(moduleUrl);
  const payload = await runDesktopWorker("capture", ["640", "45"]);

  assert.equal(payload?.status, "ok");
  assert.equal(payload?.kind, "capture");
  assert.equal(payload?.source, "test-command-fallback");
  assert.equal(payload?.bytes, 1234);
});
