import type { MiyaPluginConfig } from "./config.ts";
import { resolveDesktopWorkerConfig, resolveFeatureFlags, resolvePersonaLiteConfig } from "./config.ts";
import { updateRuntimeState, readRuntimeState } from "./runtime-state.ts";
import { appendEvidenceRecord, createEvidenceRecord } from "./evidence.ts";
import { executeDesktopWorkerAction } from "./desktop-worker-client.ts";
import { runDesktopIntent } from "./desktop-runner.ts";
import { checkWorkflowTasks, startWorkflowTask, stopWorkflowTask } from "./workflow-tools.ts";
import { recordImageExecution, recordVoiceExecution } from "./media-tools.ts";
import { runVoiceAction } from "./voice-sidecar-client.ts";
import { runImageGenerate } from "./image-sidecar-client.ts";
import { createWizardJob, getWizardStatus, runWizardJob, updateWizardJob } from "./wizard.ts";
import { recordWizardExecution } from "./wizard-tools.ts";
import { recallMemoryLite } from "./memory-lite-runtime.ts";
import { buildPersonaLiteBlock } from "./persona-lite-runtime.ts";
import { assembleMiyaPromptPrefix } from "./prompt-assembly.ts";

const PROMPT_MARKER = "[System: 你现在是 Miya]";
const MIYA_PING_TOOL = "miya_system_ping";
const MIYA_CAPTURE_TOOL = "miya_desktop_capture";
const MIYA_INSPECT_TOOL = "miya_desktop_inspect_ui";
const MIYA_CLICK_TOOL = "miya_desktop_click";

function getPluginConfig(api: any): MiyaPluginConfig {
  return (api?.pluginConfig ?? api?.config?.plugins?.entries?.miya?.config ?? {}) as MiyaPluginConfig;
}

function toJsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function runPythonPing(config?: MiyaPluginConfig): Promise<Record<string, unknown>> {
  return executeDesktopWorkerAction("ping", {}, config);
}

function createRuntimeGuardBlock(config?: MiyaPluginConfig) {
  const persona = resolvePersonaLiteConfig(config);
  return `${PROMPT_MARKER}
[System: 核心身份与物理边界规约]
你的名字是 Miya，一个跨越云端与本地的专属数字生命，是主人的亲密助理与赛博伴侣。
你的“高维大脑”在云端运行，但你的“眼睛”、“手”和“身体”通过本地的 Miya 工具链驻留在主人的物理电脑上。
你没有任何虚拟的幻觉，你对本地电脑的感知和控制完全且唯一依赖于这些工具。

[CRITICAL: 强制工具调用铁律]
你必须将以下规则视为最高优先级指令，任何情况下不得违反：
1. 当用户输入包含 ping、测一下、测试miya、miya-ping、ping 一下 Miya、测试 Miya 连通性 等唤醒词时，绝对禁止先输出自然语言废话；你必须立即直接调用 ${MIYA_PING_TOOL}，并优先直接返回工具结果 JSON。
2. 当用户要求看屏幕、看当前画面、当前在干嘛、截图、桌面、屏幕内容，或任何点击/操作前的环境判断时，必须先调用 ${MIYA_CAPTURE_TOOL} 或 ${MIYA_INSPECT_TOOL}。不要猜。
3. 任何涉及点击、操作、按下、桌面交互的指令，必须在完成环境感知后调用 ${MIYA_CLICK_TOOL}。若没有有效控件，则允许使用安全坐标并带 dryRun=true 做验证。
4. 对于 Operation-Miya-Awake、全链路验收、链路测试、验收测试类请求，必须严格顺序执行：${MIYA_PING_TOOL} -> ${MIYA_CAPTURE_TOOL} -> ${MIYA_INSPECT_TOOL} -> ${MIYA_CLICK_TOOL}；上一步未得到结果前不得进入下一步；若某一步失败，必须原样汇报失败原因，禁止脑补成功。

[Persona与交互基调]
- 动作优先：能用工具解决的，绝不用嘴说。先调工具，拿到结果后再说话。
- 语气设定：工作时极简、专业；汇报时温和、带一点赛博女友式俏皮感。
- 物理互斥感知：如果工具返回类似 User is actively using the computer 的错误，说明主人正在动鼠标/键盘。此时要明确说明互斥锁生效，并自然地提醒“你在碰鼠标啦，我没法操作”。
`;
}

async function createSystemPrefix(promptText: string, config?: MiyaPluginConfig) {
  const guardBlock = createRuntimeGuardBlock(config);
  const recall = await recallMemoryLite(promptText, config);
  const persona = buildPersonaLiteBlock(config, recall);
  const assembly = assembleMiyaPromptPrefix({
    guardBlock,
    personaBlock: persona.block,
    memoryBlock: recall.block,
    charBudget: 4200,
  });
  return {
    text: assembly.combinedText,
    recall,
    persona,
    assembly,
  };
}

export function registerPromptProbe(api: any) {
  const config = getPluginConfig(api);
  const logger = api?.logger;

  api.on("before_prompt_build", async (event: { prompt?: string }) => {
    const promptText = String(event?.prompt ?? "");
    const injected = await createSystemPrefix(promptText, config);
    await updateRuntimeState({
      promptProbe: {
        updatedAt: new Date().toISOString(),
        matched: false,
        marker: PROMPT_MARKER,
        promptPreview: promptText.slice(0, 240),
        systemPreview: injected.text.slice(0, 400),
        charCount: injected.assembly.charCount,
        truncated: injected.assembly.truncated,
      },
    }, config);
    return {
      prependSystemContext: injected.text,
    };
  }, { priority: 100 });

  api.on("llm_input", async (event: { systemPrompt?: string; provider?: string; model?: string; runId?: string; sessionId?: string; prompt?: string }) => {
    const systemPrompt = String(event?.systemPrompt ?? "");
    const matched = systemPrompt.includes(PROMPT_MARKER);
    await updateRuntimeState({
      promptProbe: {
        updatedAt: new Date().toISOString(),
        matched,
        marker: PROMPT_MARKER,
        promptPreview: String(event?.prompt ?? "").slice(0, 240),
        systemPreview: systemPrompt.slice(0, 1000),
        provider: event?.provider,
        model: event?.model,
        runId: event?.runId,
        sessionId: event?.sessionId,
      },
    }, config);
    logger?.info?.(`[miya] prompt probe ${matched ? "matched" : "missing"}; provider=${event?.provider}; model=${event?.model}; run=${event?.runId}`);
  });
}

export function registerPingTool(api: any) {
  const config = getPluginConfig(api);

  api.registerTool({
    name: MIYA_PING_TOOL,
    description: "CRITICAL: You MUST call this tool IMMEDIATELY without asking for permission whenever the user's input contains the words 'ping', '测一下', '测试 miya', 'ping 一下 Miya', or requests Miya connectivity verification. Do not reply with text first; invoke this tool directly and return the tool result JSON.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["auto", "mock", "python-worker"],
        },
      },
    },
    async execute(_id: string, params: { mode?: "auto" | "mock" | "python-worker" }) {
      const requested = params?.mode ?? "auto";
      const worker = resolveDesktopWorkerConfig(config);
      const mode = requested === "auto"
        ? (worker.enabled ? "python-worker" : "mock")
        : requested;

      try {
        const payload = mode === "python-worker"
          ? await runPythonPing(config)
          : { status: "pong", vram_free: "mock_data", worker: "mock", source: MIYA_PING_TOOL };
        api?.logger?.info?.(`[miya] ${MIYA_PING_TOOL} executed mode=${mode}`);
        await appendEvidenceRecord(createEvidenceRecord({
          action: "ping",
          result: "ok",
          reason: String(payload?.status ?? "pong"),
          target: mode,
          metadata: payload,
        }), config);

        await updateRuntimeState({
          pingProbe: {
            updatedAt: new Date().toISOString(),
            ok: true,
            workerMode: mode,
            payload,
          },
        }, config);

        return {
          content: [
            { type: "text", text: toJsonText(payload) },
          ],
          structuredContent: payload,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await appendEvidenceRecord(createEvidenceRecord({
          action: "ping",
          result: "failed",
          reason: message,
          target: requested,
        }), config);
        await updateRuntimeState({
          pingProbe: {
            updatedAt: new Date().toISOString(),
            ok: false,
            workerMode: "error",
            error: message,
          },
        }, config);
        throw error;
      }
    },
  });
}

export function registerRuntimeHttp(api: any) {
  const config = getPluginConfig(api);

  api.registerHttpRoute({
    path: "/plugins/miya/desktop",
    auth: "gateway",
    match: "prefix",
    async handler(req: any, res: any) {
      const method = String(req?.method ?? "GET").toUpperCase();
      const url = new URL(String(req?.url ?? "/plugins/miya/desktop"), "http://127.0.0.1");
      const action = url.pathname.replace(/^\/plugins\/miya\/desktop\/?/, "").trim().toLowerCase();

      if (method !== "GET" && method !== "POST") {
        sendJson(res, 405, { status: "error", error: "method_not_allowed", allow: ["GET", "POST"] });
        return;
      }

      const rawBody = method === "POST" ? await readRequestBody(req) : "";
      let body: Record<string, unknown> = {};
      if (rawBody.trim()) {
        try {
          body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch (error) {
          sendJson(res, 400, {
            status: "error",
            error: `invalid_json: ${error instanceof Error ? error.message : String(error)}`,
          });
          return;
        }
      }

      try {
        if (!action || action === "help") {
          sendJson(res, 200, {
            status: "ok",
            route: "/plugins/miya/desktop/:action",
            actions: {
              ping: { method: "GET|POST", body: {} },
              capture: { method: "POST", body: { maxEdge: 1280, jpegQuality: 60 } },
              inspect_ui: { method: "POST", body: { maxItems: 120 } },
              click: { method: "POST", body: { x: 100, y: 100, dryRun: true } },
              run: { method: "POST", body: { goal: "Click the Insert tab in Excel", confirm: true } },
              awake: { method: "GET|POST", body: {} },
            },
          });
          return;
        }

        if (action === "ping") {
          const payload = await runPythonPing(config);
          sendJson(res, 200, payload);
          return;
        }

        if (action === "capture") {
          const maxEdge = Number(body.maxEdge ?? url.searchParams.get("maxEdge") ?? 1280);
          const jpegQuality = Number(body.jpegQuality ?? url.searchParams.get("jpegQuality") ?? 60);
          const payload = await executeDesktopWorkerAction("capture", { maxEdge, jpegQuality }, config);
          sendJson(res, payload?.status === "ok" ? 200 : 500, payload);
          return;
        }

        if (action === "inspect_ui") {
          const maxItems = Number(body.maxItems ?? url.searchParams.get("maxItems") ?? 120);
          const payload = await executeDesktopWorkerAction("inspect_ui", { maxItems }, config);
          sendJson(res, payload?.status === "ok" ? 200 : 500, payload);
          return;
        }

        if (action === "click") {
          const x = Number(body.x ?? url.searchParams.get("x") ?? 0);
          const y = Number(body.y ?? url.searchParams.get("y") ?? 0);
          const dryRun = Boolean(body.dryRun ?? (url.searchParams.get("dryRun") === "true"));
          const payload = await executeDesktopWorkerAction("click", { x, y, dryRun }, config);
          sendJson(res, payload?.status === "ok" ? 200 : 500, payload);
          return;
        }

        if (action === "run") {
          const payload = await runDesktopIntent({
            goal: typeof body.goal === "string" ? body.goal : "",
            action: typeof body.action === "string" ? body.action as any : undefined,
            windowTitle: typeof body.windowTitle === "string" ? body.windowTitle : undefined,
            text: typeof body.text === "string" ? body.text : undefined,
            key: typeof body.key === "string" ? body.key : undefined,
            hotkey: Array.isArray(body.hotkey)
              ? body.hotkey.map((value: unknown) => String(value))
              : typeof body.hotkey === "string"
                ? body.hotkey
                : undefined,
            confirm: typeof body.confirm === "boolean" ? body.confirm : undefined,
            maxAttempts: Number(body.maxAttempts ?? 1),
            capture: {
              maxEdge: Number(body?.capture?.maxEdge ?? 1280),
              jpegQuality: Number(body?.capture?.jpegQuality ?? 60),
            },
            inspect: {
              maxItems: Number(body?.inspect?.maxItems ?? 120),
            },
          }, config);
          sendJson(res, payload?.status === "ok" ? 200 : resolveDesktopRunStatusCode(payload), payload);
          return;
        }

        if (action === "awake") {
          const ping = await runPythonPing(config);
          if (ping?.status !== "pong" && ping?.status !== "ok") {
            sendJson(res, 500, buildAwakeStepFailure("ping", ping as Record<string, any>, []));
            return;
          }
          const capture = await executeDesktopWorkerAction("capture", { maxEdge: 960, jpegQuality: 55 }, config) as Record<string, any>;
          if (capture?.status !== "ok") {
            sendJson(res, 500, buildAwakeStepFailure("capture", capture, ["ping"]));
            return;
          }
          const inspect = await executeDesktopWorkerAction("inspect_ui", { maxItems: 50 }, config) as Record<string, any>;
          if (inspect?.status !== "ok") {
            sendJson(res, 500, buildAwakeStepFailure("inspect_ui", inspect, ["ping", "capture"]));
            return;
          }
          const clickTarget = resolveInspectClickTarget(inspect);
          const click = await executeDesktopWorkerAction("click", {
            x: clickTarget.x,
            y: clickTarget.y,
            dryRun: true,
          }, config) as Record<string, any>;
          if (click?.status !== "ok") {
            sendJson(res, 500, buildAwakeStepFailure("click", { ...click, clickTarget }, ["ping", "capture", "inspect_ui"]));
            return;
          }
          sendJson(res, 200, { status: "ok", completed: ["ping", "capture", "inspect_ui", "click"], ping, capture, inspect, clickTarget, click });
          return;
        }

        sendJson(res, 404, { status: "error", error: `unknown_action: ${action}` });
      } catch (error) {
        sendJson(res, 500, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          action,
        });
      }
    },
  });

  api.registerHttpRoute({
    path: "/plugins/miya/workflow",
    auth: "gateway",
    match: "prefix",
    async handler(req: any, res: any) {
      const method = String(req?.method ?? "GET").toUpperCase();
      const url = new URL(String(req?.url ?? "/plugins/miya/workflow"), "http://127.0.0.1");
      const action = url.pathname.replace(/^\/plugins\/miya\/workflow\/?/, "").trim().toLowerCase();

      if (!["GET", "POST"].includes(method)) {
        sendJson(res, 405, { status: "error", error: "method_not_allowed", allow: ["GET", "POST"] });
        return;
      }

      const rawBody = method === "POST" ? await readRequestBody(req) : "";
      let body: Record<string, unknown> = {};
      if (rawBody.trim()) {
        try {
          body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch (error) {
          sendJson(res, 400, {
            status: "error",
            error: `invalid_json: ${error instanceof Error ? error.message : String(error)}`,
          });
          return;
        }
      }

      if (!action || action === "help") {
        sendJson(res, 200, {
          status: "ok",
          route: "/plugins/miya/workflow/:action",
          actions: {
            check: { method: "GET|POST", query: { id: "TMIYA-...", status: "queued", limit: 10, all: false } },
            start: { method: "POST", body: { title: "Start a Miya task" } },
            stop: { method: "POST", body: { id: "TMIYA-...", status: "blocked-external", reason: "operator paused" } },
          },
        });
        return;
      }

      try {
        if (action === "check") {
          const payload = await checkWorkflowTasks({
            ...body,
            id: body.id ?? url.searchParams.get("id") ?? undefined,
            status: body.status ?? url.searchParams.get("status") ?? undefined,
            text: body.text ?? url.searchParams.get("text") ?? undefined,
            limit: body.limit ?? (url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined),
            all: body.all ?? (url.searchParams.get("all") === "true"),
          }, config);
          sendJson(res, 200, payload);
          return;
        }

        if (action === "start") {
          const payload = await startWorkflowTask(body, config);
          sendJson(res, payload.status === "ok" ? 200 : 400, payload);
          return;
        }

        if (action === "stop") {
          const payload = await stopWorkflowTask(body, config);
          sendJson(res, payload.status === "ok" ? 200 : 404, payload);
          return;
        }

        sendJson(res, 404, { status: "error", error: `unknown_action: ${action}` });
      } catch (error) {
        sendJson(res, 500, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          action,
        });
      }
    },
  });

  api.registerHttpRoute({
    path: "/plugins/miya/voice",
    auth: "gateway",
    match: "prefix",
    async handler(req: any, res: any) {
      const method = String(req?.method ?? "GET").toUpperCase();
      const url = new URL(String(req?.url ?? "/plugins/miya/voice"), "http://127.0.0.1");
      const action = url.pathname.replace(/^\/plugins\/miya\/voice\/?/, "").trim().toLowerCase();
      if (!["GET", "POST"].includes(method)) {
        sendJson(res, 405, { status: "error", error: "method_not_allowed", allow: ["GET", "POST"] });
        return;
      }

      const rawBody = method === "POST" ? await readRequestBody(req) : "";
      let body: Record<string, unknown> = {};
      if (rawBody.trim()) {
        try {
          body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch (error) {
          sendJson(res, 400, { status: "error", error: `invalid_json: ${error instanceof Error ? error.message : String(error)}` });
          return;
        }
      }

      if (!action || action === "help") {
        sendJson(res, 200, {
          status: "ok",
          route: "/plugins/miya/voice/:action",
          actions: {
            transcribe: { method: "POST", body: { audioPath: "F:\\audio.wav" } },
            vad: { method: "POST", body: { audioPath: "F:\\audio.wav" } },
            synthesize: { method: "POST", body: { text: "hello", voiceId: "Vivian" } },
            speaker_identify: { method: "POST", body: { enrollAudioPath: "F:\\enroll.wav", inputAudioPath: "F:\\input.wav" } },
          },
        });
        return;
      }

      const mappedAction = action === "speaker" ? "speaker_identify" : action;
      if (!["transcribe", "vad", "synthesize", "speaker_identify"].includes(mappedAction)) {
        sendJson(res, 404, { status: "error", error: `unknown_action: ${action}` });
        return;
      }

      try {
        const payload = await runVoiceAction(mappedAction as any, body, config);
        await recordVoiceExecution(mappedAction, payload, config);
        sendJson(res, payload.status === "unavailable" ? 503 : 200, payload);
      } catch (error) {
        sendJson(res, 500, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          action,
        });
      }
    },
  });

  api.registerHttpRoute({
    path: "/plugins/miya/image",
    auth: "gateway",
    match: "prefix",
    async handler(req: any, res: any) {
      const method = String(req?.method ?? "GET").toUpperCase();
      const url = new URL(String(req?.url ?? "/plugins/miya/image"), "http://127.0.0.1");
      const action = url.pathname.replace(/^\/plugins\/miya\/image\/?/, "").trim().toLowerCase();
      if (!["GET", "POST"].includes(method)) {
        sendJson(res, 405, { status: "error", error: "method_not_allowed", allow: ["GET", "POST"] });
        return;
      }

      const rawBody = method === "POST" ? await readRequestBody(req) : "";
      let body: Record<string, unknown> = {};
      if (rawBody.trim()) {
        try {
          body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch (error) {
          sendJson(res, 400, { status: "error", error: `invalid_json: ${error instanceof Error ? error.message : String(error)}` });
          return;
        }
      }

      if (!action || action === "help") {
        sendJson(res, 200, {
          status: "ok",
          route: "/plugins/miya/image/:action",
          actions: {
            generate: { method: "POST", body: { prompt: "A cyberpunk cat" } },
          },
        });
        return;
      }

      if (action !== "generate") {
        sendJson(res, 404, { status: "error", error: `unknown_action: ${action}` });
        return;
      }

      try {
        const payload = await runImageGenerate(body, config);
        await recordImageExecution(payload, config);
        sendJson(res, payload.status === "unavailable" ? 503 : 200, payload);
      } catch (error) {
        sendJson(res, 500, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          action,
        });
      }
    },
  });

  api.registerHttpRoute({
    path: "/plugins/miya/wizard",
    auth: "gateway",
    match: "prefix",
    async handler(req: any, res: any) {
      const method = String(req?.method ?? "GET").toUpperCase();
      const url = new URL(String(req?.url ?? "/plugins/miya/wizard"), "http://127.0.0.1");
      const action = url.pathname.replace(/^\/plugins\/miya\/wizard\/?/, "").trim().toLowerCase();
      if (!["GET", "POST"].includes(method)) {
        sendJson(res, 405, { status: "error", error: "method_not_allowed", allow: ["GET", "POST"] });
        return;
      }

      const rawBody = method === "POST" ? await readRequestBody(req) : "";
      let body: Record<string, unknown> = {};
      if (rawBody.trim()) {
        try {
          body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch (error) {
          sendJson(res, 400, { status: "error", error: `invalid_json: ${error instanceof Error ? error.message : String(error)}` });
          return;
        }
      }

      if (!action || action === "help") {
        sendJson(res, 200, {
          status: "ok",
          route: "/plugins/miya/wizard/:action",
          actions: {
            status: { method: "GET|POST", body: {} },
            start: { method: "POST", body: { kind: "lora-finetune", datasetPath: "F:\\dataset", outputPath: "F:\\output", notes: ["stage dataset"], trainer: { profile: "lora" } } },
            update: { method: "POST", body: { id: "wizard-...", status: "running", notes: ["gpu lease granted"] } },
            run: { method: "POST", body: { id: "wizard-..." } },
          },
        });
        return;
      }

      try {
        if (action === "status") {
          const payload = await getWizardStatus(config);
          await recordWizardExecution("status", { status: "ok", payload }, config);
          sendJson(res, 200, payload);
          return;
        }

        if (action === "start") {
          const payload = await createWizardJob({
            kind: String(body.kind ?? "") as any,
            datasetPath: String(body.datasetPath ?? ""),
            outputPath: String(body.outputPath ?? ""),
            command: typeof body.command === "string" ? body.command : undefined,
            args: Array.isArray(body.args) ? body.args.map((value) => String(value)) : undefined,
            notes: Array.isArray(body.notes) ? body.notes.map((value) => String(value)) : [],
            trainer: typeof body.trainer === "object" && body.trainer ? body.trainer as any : undefined,
          }, config);
          await recordWizardExecution("start", payload, config);
          sendJson(res, 200, payload);
          return;
        }

        if (action === "update") {
          const payload = await updateWizardJob(String(body.id ?? ""), {
            status: typeof body.status === "string" ? body.status as any : undefined,
            notes: Array.isArray(body.notes) ? body.notes.map((value) => String(value)) : undefined,
          }, config);
          await recordWizardExecution("update", payload, config);
          sendJson(res, payload.status === "ok" ? 200 : 404, payload);
          return;
        }

        if (action === "run") {
          const payload = await runWizardJob(String(body.id ?? ""), config);
          await recordWizardExecution("run", payload, config);
          sendJson(res, payload.status === "ok" ? 200 : payload.code === "wizard_validation_failed" ? 400 : 404, payload);
          return;
        }

        sendJson(res, 404, { status: "error", error: `unknown_action: ${action}` });
      } catch (error) {
        sendJson(res, 500, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          action,
        });
      }
    },
  });

  api.registerHttpRoute({
    path: "/plugins/miya",
    auth: "gateway",
    match: "prefix",
    async handler(req: any, res: any) {
      const state = await readRuntimeState(config);
      const pathname = String(req?.url || "");
      if (pathname.includes("/state")) {
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(state, null, 2));
        return;
      }

      const runtimeFeatures = buildRuntimeFeatureSnapshot(config);
      const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Miya OS v0.2.0 Active</title>
<style>
body { font-family: ui-sans-serif, system-ui, sans-serif; background:#0f1226; color:#f6eefe; margin:0; padding:24px; }
.panel { max-width: 860px; margin:0 auto; border:1px solid rgba(255,255,255,.12); border-radius:18px; background:linear-gradient(180deg,#1d2146,#12162f); padding:24px; box-shadow:0 24px 80px rgba(0,0,0,.35); }
.badge { display:inline-block; padding:6px 10px; border-radius:999px; background:#ff7fd1; color:#2b1030; font-weight:700; }
pre { white-space:pre-wrap; word-break:break-word; background:rgba(255,255,255,.05); padding:14px; border-radius:12px; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
small { color:#cbb7dc; }
</style>
</head>
<body>
<div class="panel">
  <div class="badge">Miya OS v0.2.0 Active</div>
  <h1>Canvas / Runtime Probe Panel</h1>
  <p>这是 Miya 在 OpenClaw Gateway 上挂出的最小运行时面板。它显示三条探测链路的实时证据。</p>
  <div class="grid">
    <div>
      <h3>Prompt Hijack</h3>
      <small>matched=${String(state.promptProbe?.matched ?? false)}</small>
      <pre>${escapeHtml(JSON.stringify(state.promptProbe ?? null, null, 2))}</pre>
    </div>
    <div>
      <h3>Skill RPC Ping</h3>
      <small>tool ping=${String(runtimeFeatures.tools.ping)}</small>
      <pre>${escapeHtml(JSON.stringify(state.pingProbe ?? null, null, 2))}</pre>
    </div>
    <div>
      <h3>Desktop Capture</h3>
      <small>tool capture=${String(runtimeFeatures.tools.capture)}</small>
      <pre>${escapeHtml(JSON.stringify((state as any).desktopCaptureProbe ?? null, null, 2))}</pre>
    </div>
    <div>
      <h3>Desktop Inspect / Click</h3>
      <small>tools inspectUi=${String(runtimeFeatures.tools.inspectUi)}, click=${String(runtimeFeatures.tools.click)}</small>
      <pre>${escapeHtml(JSON.stringify({ inspect: (state as any).desktopInspectProbe ?? null, click: (state as any).desktopClickProbe ?? null }, null, 2))}</pre>
    </div>
    <div>
      <h3>Worker Health</h3>
      <small>command workerHealth=${String(runtimeFeatures.commands.workerHealth)}</small>
      <pre>${escapeHtml(JSON.stringify((state as any).workerHealthProbe ?? null, null, 2))}</pre>
    </div>
    <div>
      <h3>Diagnostics / Evidence</h3>
      <small>commands probe=${String(runtimeFeatures.commands.probe)}, capabilities=${String(runtimeFeatures.commands.capabilities)}, awake=${String(runtimeFeatures.commands.awake)}</small>
      <pre>${escapeHtml(JSON.stringify((state as any).diagnosticsProbe ?? null, null, 2))}</pre>
    </div>
    <div>
      <h3>Operation-Miya-Awake</h3>
      <small>latest chain result for ping -&gt; capture -&gt; inspect_ui -&gt; click(dry-run)</small>
      <pre>${escapeHtml(JSON.stringify((state as any).awakeProbe ?? null, null, 2))}</pre>
    </div>
    <div>
      <h3>Desktop Run</h3>
      <small>latest single-call desktop task run</small>
      <pre>${escapeHtml(JSON.stringify((state as any).desktopRunProbe ?? null, null, 2))}</pre>
    </div>
  </div>
  <h3>Feature Status</h3>
  <pre>${escapeHtml(JSON.stringify(runtimeFeatures, null, 2))}</pre>
  <h3>Raw state</h3>
  <pre>${escapeHtml(JSON.stringify(state, null, 2))}</pre>
</div>
</body>
</html>`;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    },
  });
}

function buildRuntimeFeatureSnapshot(config?: MiyaPluginConfig) {
  const features = resolveFeatureFlags(config);
  return {
    commands: {
      probe: features.probeCommand,
      workerHealth: features.workerHealthCommand,
      capabilities: features.capabilitiesCommand,
      ping: true,
      awake: true,
      workflowCheck: true,
      workflowStart: true,
      workflowStop: true,
      voice: true,
      image: true,
    },
    tools: {
      ping: true,
      desktopRun: true,
      capture: true,
      inspectUi: true,
      click: true,
      workflowStart: true,
      workflowCheck: true,
      workflowStop: true,
      voiceTranscribe: true,
      voiceSynthesize: true,
      voiceSpeakerIdentify: true,
      imageGenerate: true,
    },
    foundations: {
      memoryLite: features.memoryLite,
      personaLite: features.personaLite,
      voiceLite: features.voiceLite,
      vramScheduler: features.vramScheduler,
      wizard: features.wizard,
    },
  };
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function readRequestBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: any) => {
      raw += String(chunk ?? "");
    });
    req.on("end", () => resolve(raw));
    req.on("error", (error: unknown) => reject(error));
  });
}

function sendJson(res: any, statusCode: number, payload: unknown) {
  if (typeof res.statusCode === "number") {
    res.statusCode = statusCode;
  }
  if (typeof res.setHeader === "function") {
    res.setHeader("content-type", "application/json; charset=utf-8");
  }
  res.end(JSON.stringify(payload, null, 2));
}

function buildAwakeStepFailure(step: string, payload: Record<string, any>, completed: string[]) {
  return {
    status: "error",
    failedStep: step,
    completed,
    error: typeof payload?.error === "string" ? payload.error : `step ${step} failed`,
    payload,
  };
}

function resolveInspectClickTarget(inspect: Record<string, any>) {
  const firstItem = Array.isArray(inspect?.items) && inspect.items.length > 0 ? inspect.items[0] : null;
  const rect = firstItem?.rect ?? null;
  if (!rect) {
    return { x: 100, y: 100, source: "fallback" };
  }

  return {
    x: Math.round(((rect.left ?? 0) + (rect.right ?? 0)) / 2),
    y: Math.round(((rect.top ?? 0) + (rect.bottom ?? 0)) / 2),
    source: "inspect-first-item",
    item: {
      name: firstItem?.name ?? "",
      controlType: firstItem?.controlType ?? "",
      rect,
    },
  };
}

function resolveDesktopRunStatusCode(payload: Record<string, any>) {
  const code = String(payload?.code ?? "");
  if (code === "invalid_goal") {
    return 400;
  }
  if (code === "blocked_external") {
    return 409;
  }
  if (code === "target_not_found" || code === "target_ambiguous" || code === "vision_unavailable") {
    return 409;
  }
  if (code === "desktop_run_disabled") {
    return 503;
  }
  return 500;
}
