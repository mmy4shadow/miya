import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";

const runtimeUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/miya-runtime.ts")).href;
const { registerRuntimeHttp } = await import(runtimeUrl);
const desktopToolsUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/desktop-tools.ts")).href;
const { registerDesktopTools } = await import(desktopToolsUrl);
const mediaToolsUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/media-tools.ts")).href;
const { registerMediaTools } = await import(mediaToolsUrl);
const wizardToolsUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/wizard-tools.ts")).href;
const { registerWizardTools } = await import(wizardToolsUrl);

function makeTempRuntime({ items, visionScript = null, voiceScript = null, imageScript = null, blockClick = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-runtime-http-"));
  const workerDir = path.join(root, "worker");
  const modelDir = path.join(root, "model", "vision", "qwen3vl_4b_instruct_q4_k_m");
  const audioDir = path.join(root, "model", "audio");
  const imageDir = path.join(root, "model", "image");
  fs.mkdirSync(workerDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(imageDir, { recursive: true });
  fs.writeFileSync(path.join(workerDir, "desktop_worker.py"), `
import json
import sys

items = json.loads(${JSON.stringify(JSON.stringify(items))})
block_click = json.loads(${JSON.stringify(JSON.stringify(blockClick))})

command = sys.argv[1] if len(sys.argv) > 1 else "ping"
if command == "ping":
    print(json.dumps({"status": "pong", "worker": "test-worker"}))
elif command == "capture":
    print(json.dumps({
        "status": "ok",
        "kind": "capture",
        "image_base64": "ZmFrZQ==",
        "mime": "image/jpeg",
        "width": 640,
        "height": 360,
        "bytes": 1234,
        "source": "test-worker"
    }))
elif command == "inspect_ui":
    print(json.dumps({
        "status": "ok",
        "kind": "inspect_ui",
        "window": {
            "name": "Microsoft Excel",
            "controlType": "WindowControl",
            "rect": {"left": 0, "top": 0, "right": 1280, "bottom": 800}
        },
        "items": items,
        "count": len(items)
    }))
elif command == "click":
    dry_run = len(sys.argv) > 4 and sys.argv[4].lower() in {"1", "true", "yes", "dry-run"}
    if block_click:
        print(json.dumps({
            "status": "error",
            "kind": "click",
            "error": "Action aborted: User is actively using the computer.",
            "human_mutex": True,
            "dry_run": dry_run,
            "source": "test-worker"
        }))
    else:
        print(json.dumps({
            "status": "ok",
            "kind": "click",
            "x": int(sys.argv[2]),
            "y": int(sys.argv[3]),
            "dry_run": dry_run,
            "source": "test-worker"
        }))
elif command == "activate_window":
    print(json.dumps({
        "status": "ok",
        "kind": "activate_window",
        "title": sys.argv[2] if len(sys.argv) > 2 else "",
        "source": "test-worker"
    }))
elif command == "press_key":
    dry_run = len(sys.argv) > 3 and sys.argv[3].lower() in {"1", "true", "yes", "dry-run"}
    print(json.dumps({
        "status": "ok",
        "kind": "press_key",
        "key": sys.argv[2] if len(sys.argv) > 2 else "",
        "dry_run": dry_run,
        "source": "test-worker"
    }))
elif command == "hotkey":
    dry_run = len(sys.argv) > 3 and sys.argv[3].lower() in {"1", "true", "yes", "dry-run"}
    print(json.dumps({
        "status": "ok",
        "kind": "hotkey",
        "keys": json.loads(sys.argv[2]) if len(sys.argv) > 2 else [],
        "dry_run": dry_run,
        "source": "test-worker"
    }))
elif command == "type_text":
    dry_run = len(sys.argv) > 3 and sys.argv[3].lower() in {"1", "true", "yes", "dry-run"}
    print(json.dumps({
        "status": "ok",
        "kind": "type_text",
        "text": sys.argv[2] if len(sys.argv) > 2 else "",
        "dry_run": dry_run,
        "source": "test-worker"
    }))
else:
    print(json.dumps({"status": "error", "error": f"unknown command: {command}"}))
`, "utf8");
  fs.copyFileSync("F:/openclaw/miya/worker/wizard_job_runner.py", path.join(workerDir, "wizard_job_runner.py"));

  let visionPath = null;
  if (visionScript) {
    visionPath = path.join(root, "vision_sidecar.py");
    fs.writeFileSync(visionPath, visionScript, "utf8");
  }

  if (voiceScript) {
    fs.writeFileSync(path.join(workerDir, "voice_sidecar.py"), voiceScript, "utf8");
  }

  if (imageScript) {
    fs.writeFileSync(path.join(workerDir, "image_sidecar.py"), imageScript, "utf8");
  }

  return { root, visionPath };
}

function createApi(tempRoot, visionPath = null) {
  const routes = [];
  const tools = [];
  const api = {
    pluginConfig: {
      stateRoot: tempRoot,
      pluginRoot: tempRoot,
      modelRoot: path.join(tempRoot, "model"),
      desktopWorker: {
        transport: "command",
        timeoutMs: 3000,
        probe: {
          command: "python",
        },
      },
      vision: visionPath ? {
        enabled: true,
        provider: "command",
        command: "python",
        args: [visionPath],
        timeoutMs: 3000,
      } : {
        enabled: true,
        provider: "command",
        command: "",
        args: [],
        timeoutMs: 3000,
      },
      voice: {
        enabled: true,
        asr: { enabled: true, provider: "manual", modelPath: path.join(tempRoot, "model", "audio", "asr") },
        tts: { enabled: true, provider: "manual", modelPath: path.join(tempRoot, "model", "audio", "qwen3_tts_12hz_1_7b_customvoice"), voiceId: "Vivian" },
        speakerId: { enabled: true, provider: "manual", modelPath: path.join(tempRoot, "model", "speaker_id", "eres2net") },
        vad: { enabled: false, provider: "manual", modelPath: "" },
      },
      vramScheduler: {
        enabled: true,
        strategy: "manual-lanes",
        defaultLane: "interactive",
        gpuIndex: 0,
        minFreeMb: 1024,
        telemetryCommand: "python",
        telemetryArgs: ["-c", "print('24576, 24576')"],
        lanes: [
          { lane: "voice", priority: 90, maxModels: 1, estimatedVramMb: 4096 },
          { lane: "image", priority: 50, maxModels: 1, estimatedVramMb: 12288 },
          { lane: "training", priority: 20, maxModels: 1, estimatedVramMb: 2048 },
        ],
      },
    },
    registerHttpRoute(spec) {
      routes.push(spec);
    },
    registerTool(spec) {
      tools.push(spec);
    },
    logger: {},
  };
  registerRuntimeHttp(api);
  registerDesktopTools(api);
  registerMediaTools(api);
  registerWizardTools(api);
  return {
    desktopRoute: routes.find((entry) => entry.path === "/plugins/miya/desktop"),
    workflowRoute: routes.find((entry) => entry.path === "/plugins/miya/workflow"),
    voiceRoute: routes.find((entry) => entry.path === "/plugins/miya/voice"),
    imageRoute: routes.find((entry) => entry.path === "/plugins/miya/image"),
    wizardRoute: routes.find((entry) => entry.path === "/plugins/miya/wizard"),
    tools,
  };
}

async function invokeRoute(route, { method = "POST", url = "/plugins/miya/desktop/run", body = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      this.body += String(chunk ?? "");
    },
  };

  const payload = JSON.stringify(body);
  const pending = route.handler(req, res);
  process.nextTick(() => {
    if (payload) {
      req.emit("data", payload);
    }
    req.emit("end");
  });
  await pending;
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body),
  };
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor timeout");
}

test("POST /plugins/miya/desktop/run executes a deterministic desktop run and persists evidence", async (t) => {
  const { root } = makeTempRuntime({
    items: [
      { index: 1, name: "Home", controlType: "TabItemControl", enabled: true, rect: { left: 100, top: 40, right: 180, bottom: 80 } },
      { index: 2, name: "Insert", controlType: "TabItemControl", enabled: true, rect: { left: 200, top: 40, right: 280, bottom: 80 } },
      { index: 3, name: "Data", controlType: "TabItemControl", enabled: true, rect: { left: 300, top: 40, right: 380, bottom: 80 } },
    ],
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const route = createApi(root);
  const result = await invokeRoute(route.desktopRoute, {
    body: {
      goal: "Click Insert",
      confirm: true,
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "ok");
  assert.equal(result.body.decision.strategy, "deterministic");
  assert.equal(result.body.decision.usedVision, false);
  assert.equal(result.body.target.name, "Insert");
  assert.ok(result.body.evidence.runFile);
  assert.equal(fs.existsSync(result.body.evidence.runFile), true);

  const runtimeState = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime-state.json"), "utf8"));
  assert.equal(runtimeState.desktopRunProbe.ok, true);
  assert.equal(runtimeState.desktopRunProbe.strategy, "deterministic");
});

test("POST /plugins/miya/desktop/run uses the vision sidecar when deterministic scoring is weak", async (t) => {
  const { root, visionPath } = makeTempRuntime({
    items: [
      { index: 1, name: "Button One", controlType: "ButtonControl", enabled: true, rect: { left: 100, top: 100, right: 180, bottom: 140 } },
      { index: 2, name: "Button Two", controlType: "ButtonControl", enabled: true, rect: { left: 220, top: 100, right: 300, bottom: 140 } },
    ],
    visionScript: `
import json
import sys

payload = json.loads(sys.stdin.read() or "{}")
print(json.dumps({
    "status": "ok",
    "action": "click",
    "targetIndex": 2,
    "confidence": 0.77,
    "reason": "Vision sidecar selected candidate 2"
}))
`,
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const route = createApi(root, visionPath);
  const result = await invokeRoute(route.desktopRoute, {
    body: {
      goal: "Click the export control",
      confirm: true,
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "ok");
  assert.equal(result.body.decision.strategy, "vision");
  assert.equal(result.body.decision.usedVision, true);
  assert.equal(result.body.target.name, "Button Two");
  assert.equal(result.body.model.status, "ok");
});

test("POST /plugins/miya/desktop/run executes an explicit activate_window action", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const route = createApi(root);
  const result = await invokeRoute(route.desktopRoute, {
    body: {
      action: "activate_window",
      windowTitle: "Microsoft Excel",
      confirm: true,
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "ok");
  assert.equal(result.body.action.type, "activate_window");
  assert.equal(result.body.target.windowTitle, "Microsoft Excel");
  assert.ok(result.body.evidence.runFile);
});

test("POST /plugins/miya/desktop/run executes an explicit hotkey action after window activation", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const route = createApi(root);
  const result = await invokeRoute(route.desktopRoute, {
    body: {
      action: "hotkey",
      windowTitle: "Microsoft Excel",
      hotkey: ["ctrl", "s"],
      confirm: false,
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "ok");
  assert.equal(result.body.action.type, "hotkey");
  assert.deepEqual(result.body.action.hotkey, ["ctrl", "s"]);
  assert.equal(result.body.action.dryRun, true);
});

test("POST /plugins/miya/desktop/run returns a stable failure when no deterministic target exists and vision is unavailable", async (t) => {
  const { root } = makeTempRuntime({
    items: [
      { index: 1, name: "Button One", controlType: "ButtonControl", enabled: true, rect: { left: 100, top: 100, right: 180, bottom: 140 } },
      { index: 2, name: "Button Two", controlType: "ButtonControl", enabled: true, rect: { left: 220, top: 100, right: 300, bottom: 140 } },
    ],
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const route = createApi(root);
  const result = await invokeRoute(route.desktopRoute, {
    body: {
      goal: "Click the export control",
      confirm: true,
    },
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.status, "error");
  assert.equal(result.body.code, "vision_unavailable");
  assert.equal(result.body.model.status, "unavailable");
  assert.ok(result.body.evidence.runFile);
  assert.equal(fs.existsSync(result.body.evidence.runFile), true);
});

test("POST /plugins/miya/desktop/run classifies human mutex as blocked-external", async (t) => {
  const { root } = makeTempRuntime({
    items: [
      { index: 1, name: "Insert", controlType: "TabItemControl", enabled: true, rect: { left: 200, top: 40, right: 280, bottom: 80 } },
    ],
    blockClick: true,
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const route = createApi(root);
  const result = await invokeRoute(route.desktopRoute, {
    body: {
      goal: "Click Insert",
      confirm: true,
    },
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.status, "blocked-external");
  assert.equal(result.body.code, "blocked_external");
  assert.equal(result.body.blockerType, "external");
});

test("desktop tools register a high-level miya_desktop_run tool", async (t) => {
  const { root } = makeTempRuntime({
    items: [
      { index: 1, name: "Insert", controlType: "TabItemControl", enabled: true, rect: { left: 200, top: 40, right: 280, bottom: 80 } },
    ],
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const desktopRunTool = api.tools.find((tool) => tool.name === "miya_desktop_run");
  assert.ok(desktopRunTool, "expected miya_desktop_run tool to be registered");

  const result = await desktopRunTool.execute("test-tool-run", {
    goal: "Click Insert",
    confirm: true,
  });

  assert.equal(result.structuredContent.status, "ok");
  assert.equal(result.structuredContent.decision.strategy, "deterministic");
  assert.equal(result.structuredContent.target.name, "Insert");
});

test("workflow HTTP routes can start, check, and stop queue-backed tasks", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  const queueRoot = path.join(root, "workspace");
  fs.mkdirSync(queueRoot, { recursive: true });
  fs.writeFileSync(path.join(queueRoot, "TASK_QUEUE.md"), "# Task Queue\n", "utf8");

  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const startResult = await invokeRoute(api.workflowRoute, {
    url: "/plugins/miya/workflow/start",
    body: {
      title: "Keep desktop loop alive",
      acceptance: ["workflow start route creates a queue task"],
      verify: ["verify: inspect workflow route output"],
      artifacts: ["TASK_QUEUE.md updated"],
      notes: ["verified: task created from route"],
      next_action: "Keep the workflow moving.",
    },
  });

  assert.equal(startResult.statusCode, 200);
  assert.equal(startResult.body.status, "ok");
  assert.match(startResult.body.task.id, /^TMIYA-/);

  const checkResult = await invokeRoute(api.workflowRoute, {
    method: "GET",
    url: "/plugins/miya/workflow/check?id=" + encodeURIComponent(startResult.body.task.id),
  });

  assert.equal(checkResult.statusCode, 200);
  assert.equal(checkResult.body.status, "ok");
  assert.equal(checkResult.body.selection.tasks.length, 1);
  assert.equal(checkResult.body.selection.tasks[0].id, startResult.body.task.id);

  const stopResult = await invokeRoute(api.workflowRoute, {
    url: "/plugins/miya/workflow/stop",
    body: {
      id: startResult.body.task.id,
      status: "blocked-external",
      reason: "test stop route",
    },
  });

  assert.equal(stopResult.statusCode, 200);
  assert.equal(stopResult.body.status, "ok");
  assert.equal(stopResult.body.task.status, "blocked-external");
  assert.equal(stopResult.body.task.blocker_type, "external");
});

test("voice HTTP routes report truthful unavailable status when local runtime assets are incomplete", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const synthResult = await invokeRoute(api.voiceRoute, {
    url: "/plugins/miya/voice/synthesize",
    body: {
      text: "hello",
      voiceId: "Vivian",
    },
  });

  assert.equal(synthResult.statusCode, 503);
  assert.equal(synthResult.body.status, "unavailable");
  assert.equal(synthResult.body.code, "voice_runtime_unavailable");

  const asrResult = await invokeRoute(api.voiceRoute, {
    url: "/plugins/miya/voice/transcribe",
    body: {
      audioPath: "F:/fake/input.wav",
    },
  });

  assert.equal(asrResult.statusCode, 503);
  assert.equal(asrResult.body.status, "unavailable");
  assert.equal(asrResult.body.code, "voice_runtime_unavailable");
});

test("voice tools register stable contracts for transcribe, synthesize, and speaker identify", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const synthTool = api.tools.find((tool) => tool.name === "miya_voice_synthesize");
  const transcribeTool = api.tools.find((tool) => tool.name === "miya_voice_transcribe");
  const speakerTool = api.tools.find((tool) => tool.name === "miya_voice_speaker_identify");

  assert.ok(synthTool);
  assert.ok(transcribeTool);
  assert.ok(speakerTool);

  const result = await synthTool.execute("voice-synth", { text: "hello" });
  assert.equal(result.structuredContent.status, "unavailable");
  assert.equal(result.structuredContent.code, "voice_runtime_unavailable");
});

test("voice tools and HTTP route support VAD artifact persistence", async (t) => {
  const { root } = makeTempRuntime({
    items: [],
    voiceScript: `
import json
import sys
from pathlib import Path
payload = json.loads(sys.stdin.read() or "{}")
artifact_root = Path(payload["paths"]["artifactRoot"]) / "vad"
artifact_root.mkdir(parents=True, exist_ok=True)
artifact = artifact_root / "stub.json"
artifact.write_text(json.dumps({"speechDetected": True}, ensure_ascii=False), encoding="utf-8")
print(json.dumps({
  "status": "ok",
  "code": "vad_ok",
  "speechDetected": True,
  "artifact": {"vadJson": str(artifact)}
}, ensure_ascii=False))
`,
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const vadTool = api.tools.find((tool) => tool.name === "miya_voice_vad");
  assert.ok(vadTool);

  const toolResult = await vadTool.execute("voice-vad", { audioPath: "F:/fake.wav" });
  assert.equal(toolResult.structuredContent.status, "ok");
  assert.ok(toolResult.structuredContent.artifact.vadJson);

  const httpResult = await invokeRoute(api.voiceRoute, {
    url: "/plugins/miya/voice/vad",
    body: {
      audioPath: "F:/fake.wav",
    },
  });
  assert.equal(httpResult.statusCode, 200);
  assert.equal(httpResult.body.status, "ok");
  assert.ok(httpResult.body.artifact.vadJson);

  const runtimeState = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime-state.json"), "utf8"));
  assert.equal(runtimeState.voiceProbe.ok, true);
  assert.equal(runtimeState.voiceProbe.action, "vad");
  assert.equal(runtimeState.voiceProbe.artifactPath, httpResult.body.artifact.vadJson);
});

test("voice tool persists runtime-state and artifact metadata on successful sidecar execution", async (t) => {
  const { root } = makeTempRuntime({
    items: [],
    voiceScript: `
import json
import os
import sys
from pathlib import Path
payload = json.loads(sys.stdin.read() or "{}")
artifact_root = Path(payload["paths"]["artifactRoot"]) / "transcribe"
artifact_root.mkdir(parents=True, exist_ok=True)
artifact = artifact_root / "stub.json"
artifact.write_text(json.dumps({"text": "stub ok"}, ensure_ascii=False), encoding="utf-8")
print(json.dumps({
  "status": "ok",
  "code": "transcription_ok",
  "text": "stub ok",
  "artifact": {"transcriptJson": str(artifact)}
}, ensure_ascii=False))
`,
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const transcribeTool = api.tools.find((tool) => tool.name === "miya_voice_transcribe");
  const result = await transcribeTool.execute("voice-transcribe", { audioPath: "F:/fake.wav" });
  assert.equal(result.structuredContent.status, "ok");
  assert.ok(result.structuredContent.artifact.transcriptJson);

  const runtimeState = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime-state.json"), "utf8"));
  assert.equal(runtimeState.voiceProbe.ok, true);
  assert.equal(runtimeState.voiceProbe.action, "transcribe");
  assert.equal(runtimeState.voiceProbe.artifactPath, result.structuredContent.artifact.transcriptJson);

  const evidenceLines = fs.readFileSync(path.join(root, "state", "evidence.jsonl"), "utf8").trim().split(/\r?\n/);
  assert.ok(evidenceLines.length >= 1);
});

test("voice HTTP route persists runtime-state and artifact metadata on successful sidecar execution", async (t) => {
  const { root } = makeTempRuntime({
    items: [],
    voiceScript: `
import json
import sys
from pathlib import Path
payload = json.loads(sys.stdin.read() or "{}")
artifact_root = Path(payload["paths"]["artifactRoot"]) / "synthesize"
artifact_root.mkdir(parents=True, exist_ok=True)
artifact = artifact_root / "stub.wav"
artifact.write_bytes(b"fakewav")
metadata = artifact_root / "stub.json"
metadata.write_text(json.dumps({"voiceId": "Vivian"}, ensure_ascii=False), encoding="utf-8")
print(json.dumps({
  "status": "ok",
  "code": "tts_ok",
  "voiceId": "Vivian",
  "artifact": {"audioPath": str(artifact), "metadataJson": str(metadata)}
}, ensure_ascii=False))
`,
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const result = await invokeRoute(api.voiceRoute, {
    url: "/plugins/miya/voice/synthesize",
    body: {
      text: "hello",
      voiceId: "Vivian",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "ok");
  assert.ok(result.body.artifact.audioPath);

  const runtimeState = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime-state.json"), "utf8"));
  assert.equal(runtimeState.voiceProbe.ok, true);
  assert.equal(runtimeState.voiceProbe.action, "synthesize");
  assert.equal(runtimeState.voiceProbe.artifactPath, result.body.artifact.audioPath);

  const evidenceLines = fs.readFileSync(path.join(root, "state", "evidence.jsonl"), "utf8").trim().split(/\r?\n/);
  assert.ok(evidenceLines.length >= 1);
});

test("image HTTP route reports truthful unavailable status when runtime dependencies are missing", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const imageResult = await invokeRoute(api.imageRoute, {
    url: "/plugins/miya/image/generate",
    body: {
      prompt: "A cyberpunk cat",
    },
  });

  assert.equal(imageResult.statusCode, 503);
  assert.equal(imageResult.body.status, "unavailable");
  assert.equal(imageResult.body.code, "image_runtime_unavailable");
});

test("image tool registers a stable generation contract", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const imageTool = api.tools.find((tool) => tool.name === "miya_image_generate");
  assert.ok(imageTool);

  const result = await imageTool.execute("image-generate", { prompt: "A cyberpunk cat" });
  assert.equal(result.structuredContent.status, "unavailable");
  assert.equal(result.structuredContent.code, "image_runtime_unavailable");
});

test("image tool persists runtime-state and artifact metadata on successful sidecar execution", async (t) => {
  const { root } = makeTempRuntime({
    items: [],
    imageScript: `
import json
import sys
from pathlib import Path
payload = json.loads(sys.stdin.read() or "{}")
artifact_root = Path(payload["paths"]["artifactRoot"]) / "outputs"
artifact_root.mkdir(parents=True, exist_ok=True)
image_path = artifact_root / "stub.png"
image_path.write_bytes(b"fakepng")
metadata_path = artifact_root / "stub.json"
metadata_path.write_text(json.dumps({"prompt": "stub"}, ensure_ascii=False), encoding="utf-8")
print(json.dumps({
  "status": "ok",
  "code": "image_generation_ok",
  "selectedModel": {"profile": "fast", "path": "stub-model"},
  "artifact": {"imagePath": str(image_path), "metadataJson": str(metadata_path)}
}, ensure_ascii=False))
`,
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const imageTool = api.tools.find((tool) => tool.name === "miya_image_generate");
  const result = await imageTool.execute("image-generate", { prompt: "A cyberpunk cat" });
  assert.equal(result.structuredContent.status, "ok");
  assert.ok(result.structuredContent.artifact.imagePath);

  const runtimeState = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime-state.json"), "utf8"));
  assert.equal(runtimeState.imageProbe.ok, true);
  assert.equal(runtimeState.imageProbe.artifactPath, result.structuredContent.artifact.imagePath);
});

test("image HTTP route persists runtime-state and artifact metadata on successful sidecar execution", async (t) => {
  const { root } = makeTempRuntime({
    items: [],
    imageScript: `
import json
import sys
from pathlib import Path
payload = json.loads(sys.stdin.read() or "{}")
artifact_root = Path(payload["paths"]["artifactRoot"]) / "outputs"
artifact_root.mkdir(parents=True, exist_ok=True)
image_path = artifact_root / "stub.png"
image_path.write_bytes(b"fakepng")
metadata_path = artifact_root / "stub.json"
metadata_path.write_text(json.dumps({"prompt": "stub"}, ensure_ascii=False), encoding="utf-8")
print(json.dumps({
  "status": "ok",
  "code": "image_generation_ok",
  "selectedModel": {"profile": "balanced", "path": "stub-model"},
  "artifact": {"imagePath": str(image_path), "metadataJson": str(metadata_path)}
}, ensure_ascii=False))
`,
  });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const result = await invokeRoute(api.imageRoute, {
    url: "/plugins/miya/image/generate",
    body: {
      prompt: "A cyberpunk cat",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "ok");
  assert.ok(result.body.artifact.imagePath);

  const runtimeState = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime-state.json"), "utf8"));
  assert.equal(runtimeState.imageProbe.ok, true);
  assert.equal(runtimeState.imageProbe.artifactPath, result.body.artifact.imagePath);

  const evidenceLines = fs.readFileSync(path.join(root, "state", "evidence.jsonl"), "utf8").trim().split(/\r?\n/);
  assert.ok(evidenceLines.length >= 1);
});

test("wizard HTTP routes and tools persist staged training jobs", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const statusResult = await invokeRoute(api.wizardRoute, {
    method: "GET",
    url: "/plugins/miya/wizard/status",
  });
  assert.equal(statusResult.statusCode, 200);
  assert.equal(statusResult.body.enabled, false);
  assert.ok(Array.isArray(statusResult.body.jobs));

  const startResult = await invokeRoute(api.wizardRoute, {
    url: "/plugins/miya/wizard/start",
    body: {
      kind: "persona-dataset",
      datasetPath: "F:/dataset/persona",
      outputPath: "F:/output/persona",
      notes: ["seed dataset"],
    },
  });
  assert.equal(startResult.statusCode, 200);
  assert.equal(startResult.body.status, "ok");
  assert.equal(startResult.body.job.status, "queued");
  assert.equal(fs.existsSync(startResult.body.persisted), true);

  const updateResult = await invokeRoute(api.wizardRoute, {
    url: "/plugins/miya/wizard/update",
    body: {
      id: startResult.body.job.id,
      status: "running",
      notes: ["gpu admitted"],
    },
  });
  assert.equal(updateResult.statusCode, 200);
  assert.equal(updateResult.body.status, "ok");
  assert.equal(updateResult.body.job.status, "running");

  const wizardTool = api.tools.find((tool) => tool.name === "miya_wizard_status");
  assert.ok(wizardTool);
  const toolResult = await wizardTool.execute("wizard-status", {});
  assert.equal(toolResult.structuredContent.currentState, "running");
  assert.ok(toolResult.structuredContent.jobs.some((job) => job.id === startResult.body.job.id));

  const runtimeState = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime-state.json"), "utf8"));
  assert.equal(runtimeState.wizardProbe.ok, true);
  assert.equal(runtimeState.wizardProbe.action, "status");
});

test("wizard run executes a real local runner and completes persona dataset prep", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  const datasetDir = path.join(root, "datasets");
  const outputDir = path.join(root, "outputs");
  fs.mkdirSync(datasetDir, { recursive: true });
  fs.writeFileSync(path.join(datasetDir, "sample.txt"), "hello miya", "utf8");
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const startResult = await invokeRoute(api.wizardRoute, {
    url: "/plugins/miya/wizard/start",
    body: {
      kind: "persona-dataset",
      datasetPath: datasetDir,
      outputPath: outputDir,
      notes: ["prepare dataset"],
    },
  });
  assert.equal(startResult.statusCode, 200);

  const runResult = await invokeRoute(api.wizardRoute, {
    url: "/plugins/miya/wizard/run",
    body: {
      id: startResult.body.job.id,
    },
  });
  assert.equal(runResult.statusCode, 200);
  assert.equal(runResult.body.status, "ok");
  assert.equal(runResult.body.job.status, "running");
  assert.ok(runResult.body.job.logPath);

  const completedJob = await waitFor(() => {
    const jobPath = path.join(root, "state", "wizard", "jobs", `${startResult.body.job.id}.json`);
    const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    return job.status === "complete" ? job : null;
  });
  assert.equal(completedJob.exitCode, 0);
  assert.ok(completedJob.notes.some((note) => note.startsWith("manifest_ready:")));
  const manifestPath = completedJob.notes.find((note) => note.startsWith("manifest_ready:")).replace("manifest_ready:", "");
  assert.equal(fs.existsSync(manifestPath), true);

  const runtimeState = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime-state.json"), "utf8"));
  assert.equal(runtimeState.wizardProbe.ok, true);
  assert.equal(runtimeState.wizardProbe.action, "run");
  assert.equal(runtimeState.wizardProbe.jobId, startResult.body.job.id);

  const evidenceLines = fs.readFileSync(path.join(root, "state", "evidence.jsonl"), "utf8").trim().split(/\r?\n/);
  assert.ok(evidenceLines.some((line) => line.includes('"action":"wizard"')));
});

test("wizard run executes an external lora trainer profile and releases the training lease", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  const datasetDir = path.join(root, "datasets-lora");
  const outputDir = path.join(root, "outputs-lora");
  fs.mkdirSync(datasetDir, { recursive: true });
  fs.writeFileSync(path.join(datasetDir, "train.jsonl"), '{"text":"hello"}\n', "utf8");
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const startResult = await invokeRoute(api.wizardRoute, {
    url: "/plugins/miya/wizard/start",
    body: {
      kind: "lora-finetune",
      datasetPath: datasetDir,
      outputPath: outputDir,
      notes: ["run lora trainer"],
      trainer: {
        profile: "lora",
        command: "python",
        args: [
          "-c",
          "from pathlib import Path; import sys; out=Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True); (out/'adapter.safetensors').write_bytes(b'weights')",
          "{outputPath}",
        ],
        artifactGlobs: ["**/*.safetensors"],
      },
    },
  });
  assert.equal(startResult.statusCode, 200);

  const runResult = await invokeRoute(api.wizardRoute, {
    url: "/plugins/miya/wizard/run",
    body: { id: startResult.body.job.id },
  });
  assert.equal(runResult.statusCode, 200);
  assert.equal(runResult.body.status, "ok");
  assert.equal(runResult.body.job.status, "running");
  assert.ok(runResult.body.job.vramLeaseId);

  const completedJob = await waitFor(() => {
    const jobPath = path.join(root, "state", "wizard", "jobs", `${startResult.body.job.id}.json`);
    const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    return job.status === "complete" ? job : null;
  });
  assert.equal(completedJob.exitCode, 0);

  const statusResult = await invokeRoute(api.wizardRoute, {
    method: "GET",
    url: "/plugins/miya/wizard/status",
  });
  const refreshedJob = statusResult.body.jobs.find((job) => job.id === startResult.body.job.id);
  assert.equal(refreshedJob.status, "complete");
  assert.equal(refreshedJob.vramLeaseId, undefined);
  assert.ok(refreshedJob.notes.some((note) => note.startsWith("artifacts_ready:")));
  const artifactManifest = refreshedJob.notes.find((note) => note.startsWith("artifacts_ready:")).replace("artifacts_ready:", "");
  assert.equal(fs.existsSync(artifactManifest), true);

  const schedulerState = JSON.parse(fs.readFileSync(path.join(root, "state", "vram-scheduler.json"), "utf8"));
  assert.equal(Array.isArray(schedulerState.leases), true);
  assert.equal(schedulerState.leases.length, 0);
});

test("wizard run blocks invalid lora datasets before runner spawn", async (t) => {
  const { root } = makeTempRuntime({ items: [] });
  const outputDir = path.join(root, "invalid-output");
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const api = createApi(root);
  const startResult = await invokeRoute(api.wizardRoute, {
    url: "/plugins/miya/wizard/start",
    body: {
      kind: "lora-finetune",
      datasetPath: path.join(root, "missing-dataset"),
      outputPath: outputDir,
      trainer: {
        profile: "lora",
        command: "python",
        args: ["train.py"],
      },
    },
  });
  assert.equal(startResult.statusCode, 200);

  const runResult = await invokeRoute(api.wizardRoute, {
    url: "/plugins/miya/wizard/run",
    body: { id: startResult.body.job.id },
  });
  assert.equal(runResult.statusCode, 400);
  assert.equal(runResult.body.status, "error");
  assert.equal(runResult.body.code, "wizard_validation_failed");
  assert.ok(Array.isArray(runResult.body.validation.errors));

  const jobPath = path.join(root, "state", "wizard", "jobs", `${startResult.body.job.id}.json`);
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
  assert.equal(job.status, "failed");
  assert.ok(job.notes.some((note) => note.startsWith("validation_failed:")));
});
