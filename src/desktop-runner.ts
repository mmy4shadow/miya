import fs from "node:fs";
import { spawn } from "node:child_process";
import type { MiyaPluginConfig } from "./config.ts";
import { resolveDesktopRunConfig, resolveVisionRuntimeConfig } from "./config.ts";
import { executeDesktopWorkerAction } from "./desktop-worker-client.ts";
import { writeDesktopRunArtifact, createDesktopRunId } from "./desktop-run-store.ts";
import { appendEvidenceRecord, createEvidenceRecord } from "./evidence.ts";
import { updateRuntimeState } from "./runtime-state.ts";

type DesktopActionType = "activate_window" | "click" | "hotkey" | "type_text" | "press_key";

type DesktopRunRequest = {
  goal?: string;
  action?: DesktopActionType;
  windowTitle?: string;
  text?: string;
  hotkey?: string[] | string;
  key?: string;
  confirm?: boolean;
  maxAttempts?: number;
  capture?: {
    maxEdge?: number;
    jpegQuality?: number;
  };
  inspect?: {
    maxItems?: number;
  };
};

type DesktopIntent = {
  type: DesktopActionType;
  goal: string;
  windowTitle?: string;
  text?: string;
  hotkey?: string[];
  key?: string;
};

type DesktopCandidate = {
  index: number;
  name: string;
  controlType: string;
  enabled: boolean;
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  x: number;
  y: number;
  score: number;
};

type DesktopRunResult = Record<string, unknown>;
const MIN_VISION_CONFIDENCE = 0.35;

function normalizeText(input: unknown) {
  return String(input ?? "").trim().toLowerCase();
}

function tokenize(input: string) {
  const tokens = input.match(/[\p{L}\p{N}]+/gu) ?? [];
  return Array.from(new Set(tokens.map((token) => token.trim()).filter(Boolean)));
}

function isSuspiciousEchoCandidate(name: string) {
  const value = normalizeText(name);
  if (!value) {
    return false;
  }
  if (value.length > 120) {
    return true;
  }
  const markers = [
    "invoke-restmethod",
    "http://",
    "https://",
    "authorization =",
    "convertto-json",
    "\"goal\":",
    "{",
    "}",
  ];
  return markers.some((marker) => value.includes(marker));
}

function normalizeHotkey(input: DesktopRunRequest["hotkey"]) {
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
  }
  return String(input ?? "")
    .split(/[+,]/g)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function inferIntent(request: DesktopRunRequest): DesktopIntent | null {
  const explicitAction = normalizeText(request.action);
  const goal = String(request.goal ?? "").trim();
  const windowTitle = String(request.windowTitle ?? "").trim() || undefined;

  if (explicitAction === "activate_window") {
    return {
      type: "activate_window",
      goal: goal || `Activate window ${windowTitle ?? ""}`.trim(),
      windowTitle,
    };
  }

  if (explicitAction === "type_text") {
    const text = String(request.text ?? "");
    return {
      type: "type_text",
      goal: goal || `Type text ${text}`,
      text,
      windowTitle,
    };
  }

  if (explicitAction === "press_key") {
    const key = String(request.key ?? "").trim().toLowerCase();
    return {
      type: "press_key",
      goal: goal || `Press key ${key}`,
      key,
      windowTitle,
    };
  }

  if (explicitAction === "hotkey") {
    const hotkey = normalizeHotkey(request.hotkey);
    return {
      type: "hotkey",
      goal: goal || `Hotkey ${hotkey.join("+")}`,
      hotkey,
      windowTitle,
    };
  }

  if (explicitAction === "click") {
    return {
      type: "click",
      goal,
      windowTitle,
    };
  }

  if (!goal) {
    return null;
  }

  const activateMatch = goal.match(/(?:activate|focus|switch to)\s+(?:the\s+)?(.+)/i);
  if (activateMatch) {
    return {
      type: "activate_window",
      goal,
      windowTitle: windowTitle ?? activateMatch[1]?.trim(),
    };
  }

  const typeMatch = goal.match(/(?:type|enter|input)\s+["“](.+?)["”]/i);
  if (typeMatch) {
    return {
      type: "type_text",
      goal,
      text: typeMatch[1],
      windowTitle,
    };
  }

  const pressMatch = goal.match(/(?:press|hit)\s+([a-z0-9]+)$/i);
  if (pressMatch) {
    return {
      type: "press_key",
      goal,
      key: pressMatch[1]?.trim().toLowerCase(),
      windowTitle,
    };
  }

  const hotkeyMatch = goal.match(/(?:hotkey|shortcut|press)\s+([a-z0-9+\s,]+)$/i);
  if (hotkeyMatch && /[+,]/.test(hotkeyMatch[1] ?? "")) {
    return {
      type: "hotkey",
      goal,
      hotkey: normalizeHotkey(hotkeyMatch[1]),
      windowTitle,
    };
  }

  return {
    type: "click",
    goal,
    windowTitle,
  };
}

function controlTypeBonus(goal: string, controlType: string) {
  const normalizedType = normalizeText(controlType);
  const pairs = [
    { terms: ["button", "按钮"], type: "button" },
    { terms: ["tab", "标签"], type: "tab" },
    { terms: ["menu", "菜单"], type: "menu" },
    { terms: ["link", "链接"], type: "hyperlink" },
    { terms: ["input", "输入", "edit"], type: "edit" },
    { terms: ["checkbox", "复选"], type: "checkbox" },
    { terms: ["radio", "单选"], type: "radio" },
    { terms: ["list", "列表"], type: "listitem" },
    { terms: ["combo", "下拉"], type: "combobox" },
  ];

  for (const pair of pairs) {
    if (pair.terms.some((term) => goal.includes(term)) && normalizedType.includes(pair.type)) {
      return 0.12;
    }
  }
  return 0;
}

function scoreItem(goal: string, item: Record<string, any>) {
  const goalText = normalizeText(goal);
  const goalTokens = tokenize(goalText);
  const name = normalizeText(item?.name);
  const itemTokens = tokenize(name);

  if (isSuspiciousEchoCandidate(name)) {
    return 0;
  }

  let score = 0;
  if (name && goalText) {
    if (goalText === name) {
      score += 1;
    } else {
      if (goalText.includes(name) && name.length >= 2) {
        score += 0.82;
      }
      if (name.includes(goalText) && goalText.length >= 2) {
        score += 0.72;
      }
    }
  }

  if (goalTokens.length > 0 && itemTokens.length > 0) {
    const overlap = goalTokens.filter((token) => itemTokens.includes(token));
    score += (overlap.length / goalTokens.length) * 0.7;
  }

  score += controlTypeBonus(goalText, String(item?.controlType ?? ""));
  if (item?.enabled !== false) {
    score += 0.05;
  }

  return Math.min(score, 1);
}

function buildCandidates(inspectPayload: Record<string, any>) {
  const items = Array.isArray(inspectPayload?.items) ? inspectPayload.items : [];
  return items.map((item: Record<string, any>, position: number) => {
    const rect = {
      left: Number(item?.rect?.left ?? 0),
      top: Number(item?.rect?.top ?? 0),
      right: Number(item?.rect?.right ?? 0),
      bottom: Number(item?.rect?.bottom ?? 0),
    };
    return {
      index: Number(item?.index ?? position + 1),
      name: String(item?.name ?? ""),
      controlType: String(item?.controlType ?? ""),
      enabled: item?.enabled !== false,
      rect,
      x: Math.round((rect.left + rect.right) / 2),
      y: Math.round((rect.top + rect.bottom) / 2),
      score: 0,
    } satisfies DesktopCandidate;
  });
}

function rankCandidates(goal: string, candidates: DesktopCandidate[]) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreItem(goal, candidate),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

function chooseDeterministicTarget(goal: string, candidates: DesktopCandidate[]) {
  const ranked = rankCandidates(goal, candidates);
  const top = ranked[0];
  const runnerUp = ranked[1];

  if (!top || top.score < 0.45) {
    return {
      kind: "none",
      ranked,
      reason: "deterministic scoring did not find a strong target",
    } as const;
  }

  if (runnerUp && top.score - runnerUp.score < 0.15) {
    return {
      kind: "ambiguous",
      ranked,
      reason: "multiple visible controls scored too closely",
    } as const;
  }

  return {
    kind: "target",
    ranked,
    reason: "matched visible UI control by goal tokens",
    target: top,
  } as const;
}

function spawnSidecarProcess(input: Record<string, unknown>, config?: MiyaPluginConfig) {
  const vision = resolveVisionRuntimeConfig(config);
  const baseModel = {
    provider: vision.provider,
    modelPath: vision.modelPath,
    runtimeRoot: vision.runtimeRoot,
    mmprojPath: vision.mmprojPath,
  } as Record<string, unknown>;

  if (!vision.enabled || vision.provider === "none") {
    return {
      mode: "skip",
      result: {
        status: "unavailable",
        reason: "vision runtime disabled",
        model: {
          ...baseModel,
          status: "disabled",
        },
      },
    } as const;
  }

  if (vision.provider === "command") {
    if (!vision.command) {
      return {
        mode: "skip",
        result: {
          status: "unavailable",
          reason: "vision command is not configured",
          model: {
            ...baseModel,
            status: "unavailable",
          },
        },
      } as const;
    }
    return {
      mode: "spawn",
      command: vision.command,
      args: vision.args,
      model: {
        ...baseModel,
        status: "starting",
        provider: "command-stdin-json",
        command: vision.command,
      },
      payload: {
        ...input,
        visionConfig: vision,
      },
      timeoutMs: vision.timeoutMs,
    } as const;
  }

  if (fs.existsSync(vision.sidecarPath)) {
    return {
      mode: "spawn",
      command: vision.pythonCommand,
      args: [vision.sidecarPath],
      model: {
        ...baseModel,
        status: "starting",
        provider: "python-sidecar",
        sidecarPath: vision.sidecarPath,
      },
      payload: {
        ...input,
        visionConfig: vision,
      },
      timeoutMs: vision.timeoutMs,
    } as const;
  }

  if (vision.command) {
    return {
      mode: "spawn",
      command: vision.command,
      args: vision.args,
      model: {
        ...baseModel,
        status: "starting",
        provider: "command-stdin-json",
        command: vision.command,
      },
      payload: {
        ...input,
        visionConfig: vision,
      },
      timeoutMs: vision.timeoutMs,
    } as const;
  }

  return {
    mode: "skip",
    result: {
      status: "unavailable",
      reason: "vision sidecar is not installed",
      model: {
        ...baseModel,
        status: "unavailable",
      },
    },
  } as const;
}

async function runVisionSidecar(
  input: Record<string, unknown>,
  config?: MiyaPluginConfig,
): Promise<Record<string, unknown>> {
  const resolved = spawnSidecarProcess(input, config);
  if (resolved.mode === "skip") {
    return resolved.result;
  }

  return new Promise((resolve) => {
    const child = spawn(resolved.command, resolved.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({
        status: "error",
        reason: `vision sidecar timed out after ${resolved.timeoutMs}ms`,
        model: {
          ...resolved.model,
          status: "error",
        },
      });
    }, resolved.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
        model: {
          ...resolved.model,
          status: "error",
        },
      });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          status: "error",
          reason: stderr.trim() || `vision sidecar exited with code ${code}`,
          model: {
            ...resolved.model,
            status: "error",
          },
        });
        return;
      }

      try {
        const payload = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
        const payloadStatus = String(payload?.status ?? "ok");
        const model = {
          ...resolved.model,
          status: payloadStatus === "ok" ? "ok" : payloadStatus,
        };
        if (payloadStatus === "unavailable") {
          resolve({
            status: "unavailable",
            reason: String(payload?.reason ?? "vision sidecar unavailable"),
            payload,
            model,
          });
          return;
        }
        if (payloadStatus === "error") {
          resolve({
            status: "error",
            reason: String(payload?.reason ?? "vision sidecar error"),
            payload,
            model,
          });
          return;
        }
        resolve({
          status: "ok",
          payload,
          reason: String(payload?.reason ?? "vision sidecar selected an action"),
          model,
        });
      } catch (error) {
        resolve({
          status: "error",
          reason: `invalid vision sidecar json: ${error instanceof Error ? error.message : String(error)}`,
          model: {
            ...resolved.model,
            status: "error",
          },
        });
      }
    });

    child.stdin.write(JSON.stringify(resolved.payload));
    child.stdin.end();
  });
}

function buildFailure(
  runId: string,
  goal: string,
  code: string,
  message: string,
  startedAt: number,
  model: Record<string, unknown>,
  runFile?: string,
  extra: Record<string, unknown> = {},
) {
  return {
    status: "error",
    runId,
    goal,
    code,
    error: message,
    model,
    evidence: {
      runFile,
    },
    timings: {
      totalMs: Date.now() - startedAt,
    },
    ...extra,
  };
}

async function persistDesktopRun(
  payload: Record<string, unknown>,
  goal: string,
  ok: boolean,
  strategy: string,
  config?: MiyaPluginConfig,
) {
  let runFile: string | undefined;
  const runConfig = resolveDesktopRunConfig(config);
  if (runConfig.persistRuns) {
    runFile = await writeDesktopRunArtifact(String(payload.runId), payload, config);
  }

  await updateRuntimeState({
    desktopRunProbe: {
      updatedAt: new Date().toISOString(),
      ok,
      runId: String(payload.runId),
      goal,
      strategy,
      runFile,
      payload,
      error: ok ? undefined : String(payload.error ?? payload.code ?? "desktop run failed"),
    },
  } as any, config);

  await appendEvidenceRecord(createEvidenceRecord({
    action: "desktop_run" as any,
    result: ok ? "ok" : "failed",
    reason: ok ? strategy : String(payload.code ?? "desktop run failed"),
    target: goal,
    metadata: {
      runId: payload.runId,
      strategy,
      runFile,
    },
  }), config);

  return runFile;
}

async function maybeActivateWindow(
  intent: DesktopIntent,
  confirm: boolean,
  artifact: Record<string, unknown>,
  config?: MiyaPluginConfig,
) {
  if (!intent.windowTitle || intent.type === "activate_window") {
    return null;
  }
  const activation = await executeDesktopWorkerAction("activate_window", {
    title: intent.windowTitle,
  }, config);
  artifact.preAction = activation;
  if (activation?.status !== "ok") {
    return activation;
  }
  return activation;
}

function buildSuccess(
  runId: string,
  intent: DesktopIntent,
  startedAt: number,
  model: Record<string, unknown>,
  decision: Record<string, unknown>,
  actionPayload: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    status: "ok",
    runId,
    goal: intent.goal,
    decision,
    action: {
      type: intent.type,
      status: actionPayload?.status,
      dryRun: Boolean(actionPayload?.dry_run ?? false),
      text: intent.text,
      key: intent.key,
      hotkey: intent.hotkey,
      windowTitle: intent.windowTitle,
    },
    model,
    timings: {
      totalMs: Date.now() - startedAt,
    },
    ...extra,
  };
}

export async function runDesktopIntent(
  request: DesktopRunRequest,
  config?: MiyaPluginConfig,
): Promise<DesktopRunResult> {
  const startedAt = Date.now();
  const runId = createDesktopRunId();
  const runConfig = resolveDesktopRunConfig(config);
  const confirm = request.confirm ?? runConfig.defaultConfirm;
  const maxAttempts = Math.max(Number(request.maxAttempts ?? runConfig.defaultMaxAttempts ?? 1), 1);
  const captureParams = {
    maxEdge: Number(request.capture?.maxEdge ?? 1280),
    jpegQuality: Number(request.capture?.jpegQuality ?? 60),
  };
  const inspectParams = {
    maxItems: Number(request.inspect?.maxItems ?? 120),
  };

  const intent = inferIntent(request);
  const goal = String(request.goal ?? intent?.goal ?? "").trim();
  const artifact: Record<string, unknown> = {
    runId,
    requestedAt: new Date().toISOString(),
    request: {
      ...request,
      goal,
      confirm,
      maxAttempts,
      capture: captureParams,
      inspect: inspectParams,
      normalizedAction: intent,
    },
  };

  let model: Record<string, unknown> = {
    status: "fallback-not-needed",
    provider: "none",
    modelPath: resolveVisionRuntimeConfig(config).modelPath,
  };

  if (!runConfig.enabled) {
    const failure = buildFailure(runId, goal, "desktop_run_disabled", "desktop run is disabled", startedAt, model);
    const runFile = await persistDesktopRun(failure, goal, false, "disabled", config);
    return { ...failure, evidence: { runFile } };
  }

  if (!intent) {
    const failure = buildFailure(runId, goal, "invalid_action", "desktop action could not be inferred", startedAt, model);
    const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "invalid_action", config);
    return { ...failure, evidence: { runFile } };
  }

  if (intent.type === "activate_window" && !intent.windowTitle) {
    const failure = buildFailure(runId, goal, "invalid_action", "activate_window requires windowTitle", startedAt, model);
    const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "invalid_action", config);
    return { ...failure, evidence: { runFile } };
  }

  if (intent.type === "type_text" && !intent.text) {
    const failure = buildFailure(runId, goal, "invalid_action", "type_text requires text", startedAt, model);
    const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "invalid_action", config);
    return { ...failure, evidence: { runFile } };
  }

  if (intent.type === "press_key" && !intent.key) {
    const failure = buildFailure(runId, goal, "invalid_action", "press_key requires key", startedAt, model);
    const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "invalid_action", config);
    return { ...failure, evidence: { runFile } };
  }

  if (intent.type === "hotkey" && (!intent.hotkey || intent.hotkey.length === 0)) {
    const failure = buildFailure(runId, goal, "invalid_action", "hotkey requires at least one key", startedAt, model);
    const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "invalid_action", config);
    return { ...failure, evidence: { runFile } };
  }

  try {
    if (intent.type !== "activate_window") {
      const activation = await maybeActivateWindow(intent, confirm, artifact, config);
      if (activation && activation.status !== "ok") {
        const failure = buildFailure(runId, goal, "activate_window_failed", String(activation?.error ?? "activate window failed"), startedAt, model, undefined, {
          action: intent,
          payload: activation,
        });
        const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "activate_window_failed", config);
        return { ...failure, evidence: { runFile } };
      }
    }

    if (intent.type === "activate_window") {
      const payload = await executeDesktopWorkerAction("activate_window", {
        title: intent.windowTitle,
      }, config);
      artifact.actionPayload = payload;
      if (payload?.status !== "ok") {
        const failure = buildFailure(runId, goal, "activate_window_failed", String(payload?.error ?? "activate window failed"), startedAt, model, undefined, {
          action: intent,
        });
        const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "activate_window_failed", config);
        return { ...failure, evidence: { runFile } };
      }
      const success = buildSuccess(runId, intent, startedAt, model, {
        strategy: "structured",
        reason: "executed explicit activate_window action",
        usedVision: false,
      }, payload, {
        target: {
          windowTitle: intent.windowTitle,
        },
      });
      const runFile = await persistDesktopRun({ ...artifact, ...success }, goal, true, "structured", config);
      return { ...success, evidence: { runFile } };
    }

    if (intent.type === "type_text") {
      const payload = await executeDesktopWorkerAction("type_text", {
        text: intent.text,
        dryRun: !confirm,
      }, config);
      artifact.actionPayload = payload;
      if (payload?.status !== "ok") {
        const failure = buildFailure(runId, goal, "input_failed", String(payload?.error ?? "type text failed"), startedAt, model, undefined, {
          action: intent,
        });
        const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "input_failed", config);
        return { ...failure, evidence: { runFile } };
      }
      const success = buildSuccess(runId, intent, startedAt, model, {
        strategy: "structured",
        reason: "executed explicit type_text action",
        usedVision: false,
      }, payload);
      const runFile = await persistDesktopRun({ ...artifact, ...success }, goal, true, "structured", config);
      return { ...success, evidence: { runFile } };
    }

    if (intent.type === "press_key") {
      const payload = await executeDesktopWorkerAction("press_key", {
        key: intent.key,
        dryRun: !confirm,
      }, config);
      artifact.actionPayload = payload;
      if (payload?.status !== "ok") {
        const failure = buildFailure(runId, goal, "input_failed", String(payload?.error ?? "press key failed"), startedAt, model, undefined, {
          action: intent,
        });
        const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "input_failed", config);
        return { ...failure, evidence: { runFile } };
      }
      const success = buildSuccess(runId, intent, startedAt, model, {
        strategy: "structured",
        reason: "executed explicit press_key action",
        usedVision: false,
      }, payload);
      const runFile = await persistDesktopRun({ ...artifact, ...success }, goal, true, "structured", config);
      return { ...success, evidence: { runFile } };
    }

    if (intent.type === "hotkey") {
      const payload = await executeDesktopWorkerAction("hotkey", {
        keys: intent.hotkey,
        dryRun: !confirm,
      }, config);
      artifact.actionPayload = payload;
      if (payload?.status !== "ok") {
        const failure = buildFailure(runId, goal, "input_failed", String(payload?.error ?? "hotkey failed"), startedAt, model, undefined, {
          action: intent,
        });
        const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "input_failed", config);
        return { ...failure, evidence: { runFile } };
      }
      const success = buildSuccess(runId, intent, startedAt, model, {
        strategy: "structured",
        reason: "executed explicit hotkey action",
        usedVision: false,
      }, payload);
      const runFile = await persistDesktopRun({ ...artifact, ...success }, goal, true, "structured", config);
      return { ...success, evidence: { runFile } };
    }

    const beforeCapture = await executeDesktopWorkerAction("capture", captureParams, config);
    artifact.beforeCapture = beforeCapture;
    if (beforeCapture?.status !== "ok") {
      const failure = buildFailure(runId, goal, "capture_failed", String(beforeCapture?.error ?? "capture failed"), startedAt, model, undefined, {
        payload: beforeCapture,
      });
      const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "capture_failed", config);
      return {
        ...failure,
        evidence: {
          runFile,
          beforeCaptureBytes: beforeCapture?.bytes,
        },
      };
    }

    const inspect = await executeDesktopWorkerAction("inspect_ui", inspectParams, config);
    artifact.inspect = inspect;
    if (inspect?.status !== "ok") {
      const failure = buildFailure(runId, goal, "inspect_failed", String(inspect?.error ?? "inspect failed"), startedAt, model, undefined, {
        payload: inspect,
      });
      const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "inspect_failed", config);
      return {
        ...failure,
        evidence: {
          runFile,
          beforeCaptureBytes: beforeCapture?.bytes,
        },
      };
    }

    const candidates = buildCandidates(inspect as Record<string, any>);
    artifact.candidates = candidates;

    const deterministic = chooseDeterministicTarget(goal, candidates);
    let selectedTarget: DesktopCandidate | { x: number; y: number; name?: string; controlType?: string; index?: number } | null = null;
    let decision = {
      strategy: "deterministic",
      reason: String(deterministic.reason ?? "deterministic scoring"),
      usedVision: false,
      score: deterministic.kind === "target" ? deterministic.target.score : 0,
    } as Record<string, unknown>;

    if (deterministic.kind === "target") {
      selectedTarget = deterministic.target;
    } else {
      const vision = await runVisionSidecar({
        goal,
        inspect,
        candidates,
        capture: {
          mime: beforeCapture?.mime,
          image_base64: beforeCapture?.image_base64,
          width: beforeCapture?.width,
          height: beforeCapture?.height,
        },
        allowedActions: ["click"],
      }, config);

      artifact.vision = vision;
      model = vision.model as Record<string, unknown>;

      if (vision.status === "ok") {
        const payload = vision.payload as Record<string, any>;
        const confidence = Number(payload?.confidence ?? 0);
        if (String(payload?.action ?? "click") !== "click") {
          const failure = buildFailure(runId, goal, "vision_invalid_action", "vision sidecar proposed a non-click action for click resolution", startedAt, model, undefined, {
            candidates: (deterministic.ranked ?? []).slice(0, 5),
            payload,
          });
          const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "vision_invalid_action", config);
          return { ...failure, evidence: { runFile, beforeCaptureBytes: beforeCapture?.bytes } };
        }

        if (!Number.isFinite(confidence) || confidence < MIN_VISION_CONFIDENCE) {
          const failure = buildFailure(runId, goal, "target_not_found", `vision confidence too low (${confidence})`, startedAt, model, undefined, {
            candidates: (deterministic.ranked ?? []).slice(0, 5),
            payload,
          });
          const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "target_not_found", config);
          return { ...failure, evidence: { runFile, beforeCaptureBytes: beforeCapture?.bytes } };
        }

        const targetIndex = Number(payload?.targetIndex);
        const candidate = Number.isFinite(targetIndex)
          ? candidates.find((entry) => entry.index === targetIndex)
          : null;

        if (candidate) {
          selectedTarget = candidate;
          decision = {
            strategy: "vision",
            reason: String(vision.reason ?? "vision sidecar selected a candidate"),
            usedVision: true,
            score: confidence,
          };
        } else if (Number.isFinite(Number(payload?.x)) && Number.isFinite(Number(payload?.y))) {
          selectedTarget = {
            x: Number(payload?.x),
            y: Number(payload?.y),
            name: String(payload?.name ?? ""),
            controlType: String(payload?.controlType ?? ""),
          };
          decision = {
            strategy: "vision",
            reason: String(vision.reason ?? "vision sidecar selected a coordinate"),
            usedVision: true,
            score: confidence,
          };
        }
      }

      if (!selectedTarget) {
        const code = model?.status === "unavailable" ? "vision_unavailable" : deterministic.kind === "ambiguous" ? "target_ambiguous" : "target_not_found";
        const failure = buildFailure(runId, goal, code, String(vision.reason ?? deterministic.reason), startedAt, model, undefined, {
          candidates: (deterministic.ranked ?? []).slice(0, 5),
        });
        const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, String(code), config);
        return {
          ...failure,
          evidence: {
            runFile,
            beforeCaptureBytes: beforeCapture?.bytes,
          },
        };
      }
    }

    const clickPayload = await executeDesktopWorkerAction("click", {
      x: Number(selectedTarget.x),
      y: Number(selectedTarget.y),
      dryRun: !confirm,
    }, config);
    artifact.actionPayload = clickPayload;
    if (clickPayload?.status !== "ok") {
      const failure = buildFailure(runId, goal, "click_failed", String(clickPayload?.error ?? "click failed"), startedAt, model, undefined, {
        target: selectedTarget,
        decision,
      });
      const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "click_failed", config);
      return {
        ...failure,
        evidence: {
          runFile,
          beforeCaptureBytes: beforeCapture?.bytes,
        },
      };
    }

    let afterCapture: Record<string, unknown> | undefined;
    try {
      afterCapture = await executeDesktopWorkerAction("capture", captureParams, config);
      artifact.afterCapture = afterCapture;
    } catch (error) {
      artifact.afterCaptureError = error instanceof Error ? error.message : String(error);
    }

    const success = buildSuccess(runId, intent, startedAt, model, decision, clickPayload, {
      target: selectedTarget,
    });
    const runFile = await persistDesktopRun({ ...artifact, ...success }, goal, true, String(decision.strategy), config);
    return {
      ...success,
      evidence: {
        runFile,
        beforeCaptureBytes: beforeCapture?.bytes,
        afterCaptureBytes: afterCapture?.bytes,
      },
    };
  } catch (error) {
    const failure = buildFailure(runId, goal, "desktop_run_exception", error instanceof Error ? error.message : String(error), startedAt, model, undefined, {
      action: intent,
    });
    const runFile = await persistDesktopRun({ ...artifact, ...failure }, goal, false, "exception", config);
    return {
      ...failure,
      evidence: {
        runFile,
      },
    };
  }
}
