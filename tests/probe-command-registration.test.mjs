import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";

const moduleUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/probe-command.ts")).href;
const { registerMiyaProbeCommand, registerMiyaAwakeCommand } = await import(moduleUrl);

function makeTempWorker(mode = "success") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-awake-test-"));
  const workerDir = path.join(root, "worker");
  fs.mkdirSync(workerDir, { recursive: true });
  fs.writeFileSync(path.join(workerDir, "desktop_worker.py"), `
import json
import sys

command = sys.argv[1] if len(sys.argv) > 1 else "ping"
mode = ${JSON.stringify(mode)}

if command == "ping":
    print(json.dumps({"status": "pong", "worker": "test-worker"}))
elif command == "capture":
    print(json.dumps({"status": "ok", "kind": "capture", "width": 640, "height": 360}))
elif command == "inspect_ui":
    if mode == "inspect-fail":
        print(json.dumps({"status": "error", "error": "inspect exploded"}))
    else:
        print(json.dumps({
            "status": "ok",
            "title": "Acceptance Window",
            "items": [{
                "name": "Primary Button",
                "controlType": "Button",
                "rect": {"left": 10, "top": 20, "right": 110, "bottom": 60}
            }]
        }))
elif command == "click":
    print(json.dumps({"status": "ok", "dryRun": True}))
else:
    print(json.dumps({"status": "error", "error": f"unknown command: {command}"}))
`, "utf8");
  return root;
}

function readRuntimeState(root) {
  const stateFile = path.join(root, "state", "runtime-state.json");
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

test("registerMiyaProbeCommand only registers the non-conflicting telegram-safe alias", () => {
  const commands = [];
  const api = {
    registerCommand(spec) {
      commands.push(spec);
    },
  };

  registerMiyaProbeCommand(api);

  const names = commands.map((entry) => entry.name);
  assert.deepEqual(names, ["miya-status"]);
});

test("registerMiyaAwakeCommand persists successful acceptance runs into runtime-state", async (t) => {
  const tempRoot = makeTempWorker("success");
  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const commands = [];
  const api = {
    registerCommand(spec) {
      commands.push(spec);
    },
  };
  registerMiyaAwakeCommand(api);

  const awake = commands.find((entry) => entry.name === "miya-runtime-awake");
  assert.ok(awake, "awake command should be registered");

  const result = await awake.handler({
    config: {
      plugins: {
        entries: {
          miya: {
            config: {
              pluginRoot: tempRoot,
              desktopWorker: {
                transport: "command",
                timeoutMs: 3000,
                probe: { command: "python" },
              },
            },
          },
        },
      },
    },
  });

  const payload = JSON.parse(result.text);
  assert.equal(payload.status, "ok");
  assert.deepEqual(payload.completed, ["ping", "capture", "inspect_ui", "click"]);

  const runtimeState = readRuntimeState(tempRoot);
  assert.equal(runtimeState.awakeProbe.ok, true);
  assert.deepEqual(runtimeState.awakeProbe.completed, ["ping", "capture", "inspect_ui", "click"]);
  assert.equal(runtimeState.awakeProbe.failedStep, undefined);
  assert.equal(runtimeState.awakeProbe.payload.status, "ok");
});

test("registerMiyaAwakeCommand persists failed acceptance runs into runtime-state", async (t) => {
  const tempRoot = makeTempWorker("inspect-fail");
  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const commands = [];
  const api = {
    registerCommand(spec) {
      commands.push(spec);
    },
  };
  registerMiyaAwakeCommand(api);

  const awake = commands.find((entry) => entry.name === "miya-runtime-awake");
  assert.ok(awake, "awake command should be registered");

  const result = await awake.handler({
    config: {
      plugins: {
        entries: {
          miya: {
            config: {
              pluginRoot: tempRoot,
              desktopWorker: {
                transport: "command",
                timeoutMs: 3000,
                probe: { command: "python" },
              },
            },
          },
        },
      },
    },
  });

  const payload = JSON.parse(result.text);
  assert.equal(payload.status, "error");
  assert.equal(payload.failedStep, "inspect_ui");
  assert.deepEqual(payload.completed, ["ping", "capture"]);

  const runtimeState = readRuntimeState(tempRoot);
  assert.equal(runtimeState.awakeProbe.ok, false);
  assert.equal(runtimeState.awakeProbe.failedStep, "inspect_ui");
  assert.deepEqual(runtimeState.awakeProbe.completed, ["ping", "capture"]);
  assert.equal(runtimeState.awakeProbe.error, "inspect exploded");
  assert.equal(runtimeState.awakeProbe.payload.failedStep, "inspect_ui");
});
