import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const diagnosticsModuleUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/diagnostics.ts")).href;
const runtimeStateModuleUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/runtime-state.ts")).href;
const { collectDiagnostics } = await import(diagnosticsModuleUrl);
const { updateRuntimeState } = await import(runtimeStateModuleUrl);

function makeTempWorkerRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-diagnostics-test-"));
  const workerDir = path.join(root, "worker");
  const modelDir = path.join(root, "model");
  fs.mkdirSync(workerDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(workerDir, "ping_worker.py"), [
    "import json",
    "print(json.dumps({'status': 'pong', 'worker': 'test-worker'}))",
  ].join("\n"), "utf8");
  return root;
}

function makePluginConfig(pluginRoot) {
  return {
    pluginRoot,
    desktopWorker: {
      enabled: true,
      transport: "command",
      timeoutMs: 3000,
      probe: { mode: "command", command: "python", args: [] },
    },
  };
}

test("collectDiagnostics treats a successful workerHealthProbe as external runtime validation evidence", async (t) => {
  const pluginRoot = makeTempWorkerRoot();
  t.after(() => {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  });

  const pluginConfig = makePluginConfig(pluginRoot);
  await updateRuntimeState({
    workerHealthProbe: {
      updatedAt: new Date().toISOString(),
      ok: true,
      payload: { worker: { state: "healthy" } },
    },
  }, pluginConfig);

  const diagnostics = await collectDiagnostics(pluginConfig);
  const externalRuntimeItem = diagnostics.acceptanceChecklist.find((item) => item.item === "External runtime validation batch completed");

  assert.ok(externalRuntimeItem, "expected external runtime validation checklist item");
  assert.equal(externalRuntimeItem.status, "done");
  assert.match(externalRuntimeItem.note ?? "", /<24h/i);
});

test("collectDiagnostics ignores stale runtime validation evidence older than 24h", async (t) => {
  const pluginRoot = makeTempWorkerRoot();
  t.after(() => {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  });

  const pluginConfig = makePluginConfig(pluginRoot);
  await updateRuntimeState({
    workerHealthProbe: {
      updatedAt: new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString(),
      ok: true,
      payload: { worker: { state: "healthy" } },
    },
  }, pluginConfig);

  const diagnostics = await collectDiagnostics(pluginConfig);
  const externalRuntimeItem = diagnostics.acceptanceChecklist.find((item) => item.item === "External runtime validation batch completed");

  assert.ok(externalRuntimeItem, "expected external runtime validation checklist item");
  assert.equal(externalRuntimeItem.status, "todo");
  assert.match(externalRuntimeItem.note ?? "", /needs fresh/i);
});
