import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sidecarClientUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/sidecar-client.ts")).href;
const { runJsonSidecar } = await import(sidecarClientUrl);

function makeTempSidecar(scriptBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-sidecar-client-"));
  const scriptPath = path.join(root, "sidecar.py");
  fs.writeFileSync(scriptPath, scriptBody, "utf8");
  return {
    root,
    scriptPath,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("runJsonSidecar parses the final JSON object even when the sidecar logs before it", async () => {
  const fixture = makeTempSidecar(`import json\nimport sys\n_ = json.load(sys.stdin)\nprint('booting sidecar')\nprint(json.dumps({'status': 'ok', 'value': 42}))\n`);
  try {
    const result = await runJsonSidecar("python", [fixture.scriptPath], { ping: true }, 3000);
    assert.equal(result.status, "ok");
    assert.equal(result.value, 42);
  } finally {
    fixture.cleanup();
  }
});

test("runJsonSidecar returns a truthful error when the child exits without returning JSON", async () => {
  const fixture = makeTempSidecar(`import os\nos.close(0)\n`);
  try {
    const result = await runJsonSidecar("python", [fixture.scriptPath], { ping: true }, 3000);
    assert.equal(result.status, "error");
    assert.match(String(result.code), /sidecar_(stdin_error|empty_response|exit_error)/);
  } finally {
    fixture.cleanup();
  }
});

test("runJsonSidecar returns sidecar_timeout when the sidecar never exits", async () => {
  const fixture = makeTempSidecar(`import json\nimport sys\nimport time\n_ = json.load(sys.stdin)\ntime.sleep(10)\n`);
  try {
    const result = await runJsonSidecar("python", [fixture.scriptPath], { ping: true }, 50);
    assert.equal(result.status, "error");
    assert.equal(result.code, "sidecar_timeout");
  } finally {
    fixture.cleanup();
  }
});
