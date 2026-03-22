import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { pathToFileURL } from "node:url";

const schedulerUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/vram-scheduler.ts")).href;
const {
  acquireVramLane,
  releaseVramLane,
} = await import(schedulerUrl);

function makeConfig(root) {
  return {
    pluginRoot: root,
    modelRoot: path.join(root, "model"),
    vramScheduler: {
      enabled: true,
      strategy: "manual-lanes",
      defaultLane: "interactive",
      gpuIndex: 0,
      minFreeMb: 1024,
      telemetryCommand: "python",
      telemetryArgs: ["-c", "print('24576, 24576')"],
      lanes: [
        { lane: "interactive", priority: 100, maxModels: 1, estimatedVramMb: 2048 },
        { lane: "voice", priority: 90, maxModels: 1, estimatedVramMb: 4096 },
        { lane: "vision", priority: 70, maxModels: 1, estimatedVramMb: 6144 },
        { lane: "image", priority: 50, maxModels: 1, estimatedVramMb: 12288 },
        { lane: "training", priority: 20, maxModels: 1, estimatedVramMb: 16384 },
      ],
    },
  };
}

function getStateFile(root) {
  return path.join(root, "state", "vram-scheduler.json");
}

test("vram scheduler persists leases and prunes dead processes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-vram-"));
  const config = makeConfig(root);
  const stateFile = getStateFile(root);
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      updatedAt: new Date(0).toISOString(),
      strategy: "manual-lanes",
      leases: [
        {
          id: "stale-voice",
          lane: "voice",
          acquiredAt: new Date(0).toISOString(),
          pid: 999999,
        },
      ],
    }, null, 2), "utf8");

    const acquired = acquireVramLane("voice", config);
    assert.equal(acquired.ok, true);
    assert.ok(acquired.lease?.id);

    const persisted = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(persisted.leases.length, 1);
    assert.equal(persisted.leases[0].id, acquired.lease.id);

    releaseVramLane(acquired.lease.id, "voice", config);
    const released = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(released.leases.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vram scheduler rejects lower-priority admission when global capacity is saturated", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-vram-"));
  const config = makeConfig(root);
  const heldLeases = [];
  try {
    for (const lane of ["interactive", "voice", "vision"]) {
      const acquired = acquireVramLane(lane, config);
      assert.equal(acquired.ok, true);
      heldLeases.push({ lane, id: acquired.lease.id });
    }

    const rejected = acquireVramLane("image", config);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "scheduler_busy");

    const trainingRejected = acquireVramLane("training", config);
    assert.equal(trainingRejected.ok, false);
    assert.equal(trainingRejected.code, "scheduler_busy");
  } finally {
    for (const lease of heldLeases) {
      releaseVramLane(lease.id, lease.lane, config);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vram scheduler rejects admission when live GPU free memory is below lane requirement", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-vram-"));
  const config = makeConfig(root);
  config.vramScheduler.telemetryArgs = ["-c", "print('4096, 24576')"];
  try {
    const rejected = acquireVramLane("image", config);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "gpu_memory_low");
    assert.equal(rejected.requiredFreeMb, 13312);
    assert.equal(rejected.freeMb, 4096);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vram scheduler quarantines invalid persisted json instead of reusing a corrupt state file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-vram-"));
  const config = makeConfig(root);
  const stateFile = getStateFile(root);
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, "{not-json", "utf8");

    const acquired = acquireVramLane("voice", config);
    assert.equal(acquired.ok, true);

    const entries = fs.readdirSync(path.dirname(stateFile)).sort();
    assert.equal(entries.length, 2);
    assert.ok(entries.includes("vram-scheduler.json"));
    assert.ok(entries.some((entry) => /^vram-scheduler\.corrupt-\d{4}-\d{2}-\d{2}T/.test(entry)));

    const persisted = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(persisted.leases.length, 1);
    assert.equal(persisted.leases[0].id, acquired.lease.id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vram scheduler only swallows ENOENT and rethrows other read errors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-vram-"));
  const config = makeConfig(root);
  const originalReadFileSync = fs.readFileSync;
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
  try {
    fs.readFileSync = function (...args) {
      const target = String(args[0] ?? "");
      if (target.endsWith(path.join("state", "vram-scheduler.json"))) {
        throw denied;
      }
      return originalReadFileSync.apply(this, args);
    };

    assert.throws(() => acquireVramLane("voice", config), (error) => error === denied);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vram scheduler force-evicts lower-priority leases for a higher-priority lane when enabled", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-vram-"));
  const config = makeConfig(root);
  config.vramScheduler.allowForceEvict = true;
  config.vramScheduler.telemetryArgs = ["-c", "print('24576, 24576')"];
  const stateFile = getStateFile(root);
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const sleepers = Array.from({ length: 3 }, () => {
      const child = childProcess.spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return child;
    });
    fs.writeFileSync(stateFile, JSON.stringify({
      updatedAt: new Date().toISOString(),
      strategy: "manual-lanes",
      leases: sleepers.map((sleeper, index) => ({
        id: `held-${index}`,
        lane: index === 0 ? "training" : index === 1 ? "image" : "vision",
        acquiredAt: new Date().toISOString(),
        pid: sleeper.pid,
        priority: index === 0 ? 20 : index === 1 ? 50 : index === 2 ? 70 : 0,
        estimatedVramMb: index === 0 ? 16384 : index === 1 ? 12288 : 6144,
        evictable: true,
      })),
      recentEvictions: [],
    }, null, 2), "utf8");

    const acquired = acquireVramLane("interactive", config, { estimatedVramMb: 2048 });
    assert.equal(acquired.ok, true);

    const persisted = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(persisted.leases.length, 3);
    assert.equal(persisted.leases.some((lease) => lease.lane === "interactive"), true);
    assert.ok(Array.isArray(persisted.recentEvictions));
    assert.equal(persisted.recentEvictions.length, 1);
    assert.equal(persisted.recentEvictions[0].lane, "training");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vram scheduler cleans up temp file when atomic rename fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-vram-"));
  const config = makeConfig(root);
  const stateDir = path.join(root, "state");
  const originalRenameSync = fs.renameSync;
  const renameFailed = Object.assign(new Error("rename blocked"), { code: "EPERM" });
  try {
    fs.renameSync = function (...args) {
      const target = String(args[1] ?? "");
      if (target.endsWith(path.join("state", "vram-scheduler.json"))) {
        throw renameFailed;
      }
      return originalRenameSync.apply(this, args);
    };

    assert.throws(() => acquireVramLane("voice", config), (error) => error === renameFailed);
    assert.equal(fs.existsSync(stateDir), true);
    assert.deepEqual(fs.readdirSync(stateDir), []);
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vram scheduler tolerates EPERM rename collisions when replacing an existing state file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-vram-"));
  const config = makeConfig(root);
  const stateFile = getStateFile(root);
  const stateDir = path.dirname(stateFile);
  const originalRenameSync = fs.renameSync;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      updatedAt: "2026-03-22T00:00:00.000Z",
      strategy: "manual-lanes",
      leases: [],
      recentEvictions: [],
    }, null, 2), "utf8");

    fs.renameSync = function (...args) {
      const source = String(args[0] ?? "");
      const target = String(args[1] ?? "");
      if (source.endsWith(".tmp") && target === stateFile) {
        throw Object.assign(new Error("rename blocked"), { code: "EPERM" });
      }
      return originalRenameSync.apply(this, args);
    };

    const acquired = acquireVramLane("voice", config);
    assert.equal(acquired.ok, true);

    const persisted = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(persisted.leases.length, 1);
    assert.equal(persisted.leases[0].id, acquired.lease.id);
    assert.deepEqual(fs.readdirSync(stateDir), ["vram-scheduler.json"]);
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
