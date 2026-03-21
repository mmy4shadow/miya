import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("dispatcher selftest reports multi-task chaining and restart recovery scenarios", () => {
  const raw = execFileSync(process.execPath, ["F:/openclaw/workspace/scripts/continuous-dispatcher-selftest.mjs"], {
    encoding: "utf8",
  });
  const payload = JSON.parse(raw);

  assert.equal(payload.staleRepair?.afterQueueChecks?.staleTaskRetried, true);

  assert.equal(payload.multiTaskChaining?.checks?.firstTaskSelected, true);
  assert.equal(payload.multiTaskChaining?.checks?.secondTaskSelected, true);
  assert.equal(payload.multiTaskChaining?.checks?.dependencyReleased, true);

  assert.equal(payload.restartRecovery?.checks?.firstRunSelectedRunningTask, true);
  assert.equal(payload.restartRecovery?.checks?.secondRunSelectedSameTask, true);
  assert.equal(payload.restartRecovery?.checks?.selectionStableAcrossRestart, true);
});
