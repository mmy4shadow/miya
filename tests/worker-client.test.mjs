import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workerClientUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/worker-client.ts")).href;
const { createWorkerProbeTarget, probeWorkerHealth } = await import(workerClientUrl);

test("createWorkerProbeTarget defaults command probe args to the bundled ping worker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-worker-client-"));
  try {
    const target = createWorkerProbeTarget({
      pluginRoot: root,
      desktopWorker: {
        enabled: true,
        probe: {
          mode: "command",
          command: "python",
          args: [],
        },
      },
    });
    assert.equal(target.command, "python");
    assert.equal(target.args[0], `${root}\\worker\\ping_worker.py`);
    assert.equal(target.args[1], "ping");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("probeWorkerHealth command mode uses the bundled ping worker by default", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-worker-client-"));
  const workerDir = path.join(root, "worker");
  fs.mkdirSync(workerDir, { recursive: true });
  fs.copyFileSync("F:/openclaw/miya/worker/ping_worker.py", path.join(workerDir, "ping_worker.py"));
  try {
    const result = await probeWorkerHealth({
      pluginRoot: root,
      desktopWorker: {
        enabled: true,
        timeoutMs: 3000,
        probe: {
          mode: "command",
          command: "python",
          args: [],
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.state, "healthy");
    assert.match(result.detail, /"status": "pong"|status/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("probeWorkerHealth command mode returns timeout instead of racing with late child exit", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-worker-client-"));
  const workerDir = path.join(root, "worker");
  const scriptPath = path.join(workerDir, "slow_worker.py");
  fs.mkdirSync(workerDir, { recursive: true });
  fs.writeFileSync(scriptPath, "import time\ntime.sleep(10)\n", "utf8");
  try {
    const result = await probeWorkerHealth({
      pluginRoot: root,
      desktopWorker: {
        enabled: true,
        timeoutMs: 50,
        probe: {
          mode: "command",
          command: "python",
          args: [scriptPath],
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "error");
    assert.match(result.detail, /timed out/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("probeWorkerHealth command mode surfaces spawn errors truthfully", async () => {
  const result = await probeWorkerHealth({
    desktopWorker: {
      enabled: true,
      timeoutMs: 1000,
      probe: {
        mode: "command",
        command: "__miya_missing_worker_command__",
        args: [],
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, "error");
  assert.match(result.detail, /not recognized|ENOENT|spawn/i);
});
