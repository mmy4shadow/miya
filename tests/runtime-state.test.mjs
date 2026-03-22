import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeStateUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/runtime-state.ts")).href;
const { readRuntimeState, updateRuntimeState } = await import(runtimeStateUrl);

function makeConfig(root) {
  return {
    pluginRoot: root,
    stateRoot: path.join(root, "state"),
    modelRoot: path.join(root, "model"),
  };
}

test("updateRuntimeState writes runtime-state atomically without leaving temp files behind", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-runtime-state-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const config = makeConfig(root);
  const next = await updateRuntimeState({ pingProbe: { updatedAt: "2026-03-22T00:00:00.000Z", ok: true, workerMode: "mock" } }, config);
  const stateDir = path.join(root, "state");
  const entries = fs.readdirSync(stateDir);

  assert.equal(next.pingProbe?.ok, true);
  assert.deepEqual(entries, ["runtime-state.json"]);

  const stored = JSON.parse(fs.readFileSync(path.join(stateDir, "runtime-state.json"), "utf8"));
  assert.equal(stored.pingProbe.ok, true);
});

test("readRuntimeState quarantines invalid json instead of reusing a corrupt runtime-state file", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-runtime-state-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const config = makeConfig(root);
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "runtime-state.json"), "{not-json", "utf8");

  const state = await readRuntimeState(config);
  const entries = fs.readdirSync(stateDir).sort();

  assert.equal(state.updatedAt, new Date(0).toISOString());
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^runtime-state\.corrupt-\d{4}-\d{2}-\d{2}T/);
  assert.equal(fs.existsSync(path.join(stateDir, "runtime-state.json")), false);
});

test("readRuntimeState only swallows ENOENT and rethrows other read errors", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-runtime-state-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const config = makeConfig(root);
  const originalReadFile = fs.promises.readFile;
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
  fs.promises.readFile = async (...args) => {
    const target = String(args[0] ?? "");
    if (target.endsWith(path.join("state", "runtime-state.json"))) {
      throw denied;
    }
    return originalReadFile.apply(fs.promises, args);
  };
  t.after(() => {
    fs.promises.readFile = originalReadFile;
  });

  await assert.rejects(() => readRuntimeState(config), (error) => error === denied);
});

test("updateRuntimeState cleans up temp file when atomic rename fails", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-runtime-state-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const config = makeConfig(root);
  const stateDir = path.join(root, "state");
  const originalRename = fs.promises.rename;
  const renameFailed = Object.assign(new Error("rename blocked"), { code: "EPERM" });
  fs.promises.rename = async (...args) => {
    const target = String(args[1] ?? "");
    if (target.endsWith(path.join("state", "runtime-state.json"))) {
      throw renameFailed;
    }
    return originalRename.apply(fs.promises, args);
  };
  t.after(() => {
    fs.promises.rename = originalRename;
  });

  await assert.rejects(
    () => updateRuntimeState({ pingProbe: { updatedAt: "2026-03-22T00:00:00.000Z", ok: true, workerMode: "mock" } }, config),
    (error) => error === renameFailed,
  );

  assert.equal(fs.existsSync(stateDir), true);
  assert.deepEqual(fs.readdirSync(stateDir), []);
});

test("updateRuntimeState tolerates EPERM rename collisions when replacing an existing runtime-state file", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-runtime-state-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const config = makeConfig(root);
  const stateDir = path.join(root, "state");
  const stateFile = path.join(stateDir, "runtime-state.json");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    updatedAt: "2026-03-22T00:00:00.000Z",
    pingProbe: { updatedAt: "2026-03-22T00:00:00.000Z", ok: false, workerMode: "error" },
  }, null, 2), "utf8");

  const originalRename = fs.promises.rename;
  fs.promises.rename = async (...args) => {
    const source = String(args[0] ?? "");
    const target = String(args[1] ?? "");
    if (source.endsWith(".tmp") && target === stateFile) {
      throw Object.assign(new Error("rename blocked"), { code: "EPERM" });
    }
    return originalRename.apply(fs.promises, args);
  };
  t.after(() => {
    fs.promises.rename = originalRename;
  });

  const next = await updateRuntimeState({
    pingProbe: { updatedAt: "2026-03-22T01:00:00.000Z", ok: true, workerMode: "mock" },
  }, config);

  assert.equal(next.pingProbe?.ok, true);
  const stored = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(stored.pingProbe.ok, true);
  assert.deepEqual(fs.readdirSync(stateDir), ["runtime-state.json"]);
});
