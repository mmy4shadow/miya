import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const openclawStoreModule = await import("file:///C:/Users/shadow/AppData/Roaming/npm/node_modules/openclaw/dist/auth-profiles-DRjqKE3G.js");

async function waitFor(assertion, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error(`timed out after ${timeoutMs}ms`);
}

test("loadSessionStore auto-repairs mismatched transcript bindings and prunes stale missing-transcript entries", async () => {
  assert.equal(typeof openclawStoreModule.Ff, "function");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-session-selfheal-"));
  const storePath = path.join(tempDir, "sessions.json");
  const correctSessionId = "11111111-1111-4111-8111-111111111111";
  const wrongSessionId = "22222222-2222-4222-8222-222222222222";
  const missingSessionId = "33333333-3333-4333-8333-333333333333";

  await fs.writeFile(
    path.join(tempDir, `${correctSessionId}.jsonl`),
    `${JSON.stringify({ type: "session", id: correctSessionId })}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(tempDir, `${wrongSessionId}.jsonl`),
    `${JSON.stringify({ type: "session", id: wrongSessionId })}\n`,
    "utf8",
  );

  const store = {
    "agent:main:cron:test": {
      sessionId: correctSessionId,
      updatedAt: Date.now() - 60_000,
      sessionFile: path.join(tempDir, `${wrongSessionId}.jsonl`),
    },
    "agent:main:cron:test:run:stale": {
      sessionId: missingSessionId,
      updatedAt: Date.now() - 30 * 60_000,
      sessionFile: path.join(tempDir, `${missingSessionId}.jsonl`),
    },
  };

  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  const loaded = openclawStoreModule.Ff(storePath, { skipCache: true });
  assert.equal(
    loaded["agent:main:cron:test"]?.sessionFile,
    path.join(tempDir, `${correctSessionId}.jsonl`),
  );
  assert.equal("agent:main:cron:test:run:stale" in loaded, false);

  await waitFor(async () => {
    const persisted = JSON.parse(await fs.readFile(storePath, "utf8"));
    assert.equal(
      persisted["agent:main:cron:test"]?.sessionFile,
      path.join(tempDir, `${correctSessionId}.jsonl`),
    );
    assert.equal("agent:main:cron:test:run:stale" in persisted, false);
  });
});
