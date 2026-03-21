import type { MiyaPluginConfig } from "./config.ts";
import { updateRuntimeState } from "./runtime-state.ts";
import { appendEvidenceRecord, createEvidenceRecord } from "./evidence.ts";
import { executeDesktopWorkerAction } from "./desktop-worker-client.ts";
import { runDesktopIntent } from "./desktop-runner.ts";

const MIYA_CAPTURE_TOOL = "miya_desktop_capture";
const MIYA_INSPECT_TOOL = "miya_desktop_inspect_ui";
const MIYA_CLICK_TOOL = "miya_desktop_click";
const MIYA_RUN_TOOL = "miya_desktop_run";

function getPluginConfig(api: any): MiyaPluginConfig {
  return (api?.pluginConfig ?? api?.config?.plugins?.entries?.miya?.config ?? {}) as MiyaPluginConfig;
}

function toJsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function registerDesktopTools(api: any) {
  const config = getPluginConfig(api);

  api.registerTool({
    name: MIYA_RUN_TOOL,
    description: "Run one high-level Miya desktop intent using the same pipeline as POST /plugins/miya/desktop/run.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        goal: { type: "string" },
        action: { type: "string", enum: ["activate_window", "click", "hotkey", "type_text", "press_key"] },
        windowTitle: { type: "string" },
        text: { type: "string" },
        key: { type: "string" },
        hotkey: {
          anyOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        confirm: { type: "boolean" },
        maxAttempts: { type: "integer", minimum: 1, maximum: 5 },
      },
    },
    async execute(_id: string, params: {
      goal?: string;
      action?: "activate_window" | "click" | "hotkey" | "type_text" | "press_key";
      windowTitle?: string;
      text?: string;
      key?: string;
      hotkey?: string[] | string;
      confirm?: boolean;
      maxAttempts?: number;
    }) {
      const payload = await runDesktopIntent({
        goal: params.goal,
        action: params.action,
        windowTitle: params.windowTitle,
        text: params.text,
        key: params.key,
        hotkey: params.hotkey,
        confirm: params.confirm,
        maxAttempts: params.maxAttempts,
      }, config);
      api?.logger?.info?.(`[miya] ${MIYA_RUN_TOOL} executed status=${String(payload?.status ?? "unknown")}`);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: MIYA_CAPTURE_TOOL,
    description: "Capture the current desktop as a compressed JPEG base64 preview. Use for screenshot requests and visual verification.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxEdge: { type: "integer", minimum: 320, maximum: 2560 },
        jpegQuality: { type: "integer", minimum: 20, maximum: 90 },
      },
    },
    async execute(_id: string, params: { maxEdge?: number; jpegQuality?: number }) {
      const maxEdge = Number(params?.maxEdge ?? 1280);
      const jpegQuality = Number(params?.jpegQuality ?? 60);
      const payload = await executeDesktopWorkerAction(
        "capture",
        { maxEdge, jpegQuality },
        config,
      );
      api?.logger?.info?.(`[miya] ${MIYA_CAPTURE_TOOL} executed bytes=${String((payload as any)?.bytes ?? "?")}`);
      await appendEvidenceRecord(createEvidenceRecord({
        action: "capture",
        result: payload?.status === "ok" ? "ok" : "failed",
        reason: String(payload?.status ?? "unknown"),
        target: "desktop",
        metadata: {
          width: payload?.width,
          height: payload?.height,
          bytes: payload?.bytes,
          source: payload?.source,
          observed_at: payload?.observed_at,
        },
      }), config);
      await updateRuntimeState({
        desktopCaptureProbe: {
          updatedAt: new Date().toISOString(),
          ok: payload?.status === "ok",
          payload: {
            kind: payload?.kind,
            mime: payload?.mime,
            width: payload?.width,
            height: payload?.height,
            bytes: payload?.bytes,
            source: payload?.source,
            observed_at: payload?.observed_at,
          },
        } as any,
      } as any, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: MIYA_INSPECT_TOOL,
    description: "Inspect the foreground window and return a pruned flat list of visible interactive UI controls.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxItems: { type: "integer", minimum: 1, maximum: 300 },
      },
    },
    async execute(_id: string, params: { maxItems?: number }) {
      const maxItems = Number(params?.maxItems ?? 120);
      const payload = await executeDesktopWorkerAction(
        "inspect_ui",
        { maxItems },
        config,
      );
      api?.logger?.info?.(`[miya] ${MIYA_INSPECT_TOOL} executed count=${String((payload as any)?.count ?? "?")}`);
      await appendEvidenceRecord(createEvidenceRecord({
        action: "inspect",
        result: payload?.status === "ok" ? "ok" : "failed",
        reason: String(payload?.status ?? "unknown"),
        target: String((payload as any)?.window?.name ?? "foreground-window"),
        metadata: {
          count: payload?.count,
          note: payload?.note,
          observed_at: payload?.observed_at,
        },
      }), config);
      await updateRuntimeState({
        desktopInspectProbe: {
          updatedAt: new Date().toISOString(),
          ok: payload?.status === "ok",
          payload,
        } as any,
      } as any, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: MIYA_CLICK_TOOL,
    description: "Click a desktop coordinate. Safety: aborts when recent real human keyboard/mouse activity is detected.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "integer" },
        y: { type: "integer" },
        dryRun: { type: "boolean" },
      },
      required: ["x", "y"],
    },
    async execute(_id: string, params: { x: number; y: number; dryRun?: boolean }) {
      const x = Number(params.x);
      const y = Number(params.y);
      const dryRun = Boolean(params.dryRun);
      const payload = await executeDesktopWorkerAction(
        "click",
        { x, y, dryRun },
        config,
      );
      api?.logger?.info?.(`[miya] ${MIYA_CLICK_TOOL} executed x=${params.x} y=${params.y} status=${String(payload?.status ?? "unknown")}`);
      await appendEvidenceRecord(createEvidenceRecord({
        action: "click",
        result: payload?.status === "ok" ? "ok" : payload?.human_mutex ? "blocked" : "failed",
        reason: typeof payload?.error === "string" ? payload.error : String(payload?.status ?? "unknown"),
        target: `${x},${y}`,
        metadata: {
          dryRun,
          source: payload?.source,
          human_mutex: payload?.human_mutex,
          observed_at: payload?.observed_at,
        },
      }), config);
      await updateRuntimeState({
        desktopClickProbe: {
          updatedAt: new Date().toISOString(),
          ok: payload?.status === "ok",
          payload,
        } as any,
      } as any, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });
}
