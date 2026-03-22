import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { MiyaPluginConfig } from "./config.ts";
import { appendEvidenceRecord, createEvidenceRecord } from "./evidence.ts";
import { resolveMiyaPaths } from "./paths.ts";
import { readRuntimeState, updateRuntimeState } from "./runtime-state.ts";
import type { OrchestrationGovernorState } from "./runtime-state.ts";

export type DispatcherPayload = {
  decision?: string;
  taskId?: string;
  taskStatus?: string;
  nextAction?: string;
  summary?: string;
  reason?: string;
  appliedRepairs?: unknown[];
  blockedByType?: Record<string, unknown>;
  [key: string]: unknown;
};

type HookContextLike = {
  sessionKey?: string;
  sessionId?: string;
  trigger?: string;
  requesterSessionKey?: string;
  childSessionKey?: string;
};

type HookName = "session_start" | "agent_end" | "subagent_ended" | "before_agent_start";
type HookEventLike = Record<string, unknown> | undefined;
const DEFAULT_WAKE_THROTTLE_WINDOW_MS = 5_000;
const DEFAULT_GOVERNOR_RETENTION_MS = 60_000;
const recentContinuationWakeKeys = new Map<string, number>();
const recentContinuationWakeSessions = new Map<string, number>();

type ContinuationRouteKind = "default" | "session-resume" | "descendant-settle";

type ContinuationRoute = {
  sessionKey: string;
  routeKind: ContinuationRouteKind;
  routeSource?: string;
};

type ContinuationWakeResult = {
  triggered: boolean;
  reason: string;
  sessionKey?: string;
  taskId?: string;
  taskStatus?: string;
  routeKind?: ContinuationRouteKind;
  routeSource?: string;
  enqueued?: boolean;
  wakeRequested?: boolean;
  text?: string;
  governorStatePatch?: OrchestrationGovernorState;
};

function getPluginConfig(api: any): MiyaPluginConfig {
  return (api?.pluginConfig ?? api?.config?.plugins?.entries?.miya?.config ?? {}) as MiyaPluginConfig;
}

function getWorkspaceRoot(config?: MiyaPluginConfig) {
  return path.join(resolveMiyaPaths(config).stateRoot, "workspace");
}

function getDispatcherScript(config?: MiyaPluginConfig) {
  return path.join(getWorkspaceRoot(config), "scripts", "continuous-dispatcher.mjs");
}

async function runDispatcher(config?: MiyaPluginConfig): Promise<DispatcherPayload> {
  const workspaceRoot = getWorkspaceRoot(config);
  const dispatcherScript = getDispatcherScript(config);
  await fs.access(dispatcherScript);

  return await new Promise<DispatcherPayload>((resolve, reject) => {
    const child = spawn(process.execPath, [dispatcherScript, "--apply"], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `dispatcher exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as DispatcherPayload);
      } catch (error) {
        reject(new Error(`invalid dispatcher json: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function summarizeLatestRuntimeProbe(runtimeState: Awaited<ReturnType<typeof readRuntimeState>>) {
  const probes = [
    ["awakeProbe", runtimeState.awakeProbe],
    ["desktopRunProbe", runtimeState.desktopRunProbe],
    ["desktopClickProbe", runtimeState.desktopClickProbe],
    ["desktopInspectProbe", runtimeState.desktopInspectProbe],
    ["desktopCaptureProbe", runtimeState.desktopCaptureProbe],
    ["voiceProbe", runtimeState.voiceProbe],
    ["imageProbe", runtimeState.imageProbe],
    ["wizardProbe", runtimeState.wizardProbe],
    ["pingProbe", runtimeState.pingProbe],
    ["workerHealthProbe", runtimeState.workerHealthProbe],
    ["diagnosticsProbe", runtimeState.diagnosticsProbe],
    ["dispatcherProbe", runtimeState.dispatcherProbe],
  ].filter((entry): entry is [string, { updatedAt?: string; ok?: boolean; error?: string; payload?: Record<string, unknown>; [key: string]: unknown }] => Boolean(entry[1]?.updatedAt));

  if (!probes.length) {
    return undefined;
  }

  probes.sort((left, right) => {
    const leftAt = Date.parse(left[1].updatedAt ?? "") || 0;
    const rightAt = Date.parse(right[1].updatedAt ?? "") || 0;
    return rightAt - leftAt;
  });

  const [probeName, probe] = probes[0];
  return {
    probe: probeName,
    updatedAt: probe.updatedAt,
    ok: probe.ok,
    error: typeof probe.error === "string" ? probe.error : undefined,
    action: typeof probe.action === "string" ? probe.action : undefined,
    taskId: typeof probe.taskId === "string" ? probe.taskId : undefined,
    runId: typeof probe.runId === "string" ? probe.runId : undefined,
    failedStep: typeof probe.failedStep === "string" ? probe.failedStep : undefined,
    artifactPath: typeof probe.artifactPath === "string" ? probe.artifactPath : undefined,
    code: typeof probe.code === "string" ? probe.code : undefined,
    completed: Array.isArray(probe.completed) ? probe.completed : undefined,
    payloadStatus: typeof probe.payload?.status === "string" ? probe.payload.status : undefined,
  };
}

export async function getContinuousWorkStatus(config?: MiyaPluginConfig) {
  try {
    const payload = await runDispatcher(config);
    const runtimeState = await readRuntimeState(config);
    return {
      status: "ok" as const,
      decision: payload.decision,
      taskId: payload.taskId,
      taskStatus: payload.taskStatus,
      nextAction: payload.nextAction,
      summary: payload.summary,
      reason: payload.reason,
      blockedByType: payload.blockedByType ?? {},
      appliedRepairs: Array.isArray(payload.appliedRepairs) ? payload.appliedRepairs : [],
      dispatcher: payload,
      latestRuntimeProbe: summarizeLatestRuntimeProbe(runtimeState),
      workloopHook: runtimeState.workloopHook,
      continuationWake: runtimeState.continuationWake,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error" as const,
      code: "dispatcher_failed",
      reason: message,
    };
  }
}

function buildWorkloopSystemContext(decision: DispatcherPayload) {
  return [
    "[System: Miya continuous workloop]",
    `The workspace dispatcher is authoritative and selected task ${decision.taskId} with status ${decision.taskStatus}.`,
    `Continue that task immediately and follow TASK_QUEUE.md as the execution source of truth.`,
    `Next action: ${decision.nextAction || "Inspect TASK_QUEUE.md, perform the next concrete step, verify, then update the queue."}`,
    `Dispatcher summary: ${decision.summary || "No additional summary."}`,
    "Do not stop after a sub-step. Keep executing until acceptance passes or a real blocker forces status change.",
    "If you hit a transient failure, move to retry or change strategy. If you hit a real external blocker, classify it honestly instead of asking for routine permission.",
  ].join("\n");
}

function buildContinuationSystemEvent(hook: HookName, payload: DispatcherPayload) {
  return [
    "[System: Miya continuation wake]",
    `Hook ${hook} selected ${payload.taskId || "unknown-task"} (${payload.taskStatus || "unknown-status"}) as the next runnable task.`,
    `Next action: ${payload.nextAction || "Inspect TASK_QUEUE.md, execute the next concrete step, verify, and update the queue."}`,
    `Dispatcher summary: ${payload.summary || "No additional summary."}`,
    "Resume the queue-backed workflow immediately and continue until strict acceptance passes or a real blocker is recorded.",
  ].join("\n");
}

function isSessionResumeTrigger(ctx?: HookContextLike, event?: HookEventLike) {
  const trigger = typeof ctx?.trigger === "string" ? ctx.trigger : undefined;
  if (trigger === "session_resume" || trigger === "resume") {
    return true;
  }

  const eventTrigger = typeof event?.trigger === "string" ? event.trigger : undefined;
  if (eventTrigger === "session_resume" || eventTrigger === "resume") {
    return true;
  }

  return Boolean(event?.resumeOfSessionKey || event?.resumedFromSessionKey || event?.sessionResume);
}

export function resolveContinuationRoute(hook: HookName, event: HookEventLike, ctx: HookContextLike | undefined): ContinuationRoute | null {
  if (hook === "subagent_ended") {
    const requesterSessionKey = ctx?.requesterSessionKey
      || (typeof event?.requesterSessionKey === "string" ? event.requesterSessionKey : undefined)
      || (typeof event?.targetSessionKey === "string" ? event.targetSessionKey : undefined);
    const childSessionKey = ctx?.childSessionKey
      || (typeof event?.childSessionKey === "string" ? event.childSessionKey : undefined)
      || ctx?.sessionKey
      || (typeof event?.sessionKey === "string" ? event.sessionKey : undefined);
    const targetSessionKey = requesterSessionKey || childSessionKey;
    if (!targetSessionKey) {
      return null;
    }
    return {
      sessionKey: targetSessionKey,
      routeKind: requesterSessionKey ? "descendant-settle" : "default",
      routeSource: childSessionKey,
    };
  }

  const sessionKey = ctx?.sessionKey
    || (typeof event?.sessionKey === "string" ? event.sessionKey : undefined);
  if (!sessionKey) {
    return null;
  }

  return {
    sessionKey,
    routeKind: hook === "session_start" && isSessionResumeTrigger(ctx, event) ? "session-resume" : "default",
  };
}

export function resolveContinuationSessionKey(hook: HookName, event: HookEventLike, ctx: HookContextLike | undefined) {
  return resolveContinuationRoute(hook, event, ctx)?.sessionKey;
}

function buildContinuationWakeKey(params: {
  sessionKey: string;
  hook: HookName;
  taskId: string;
  routeKind: ContinuationRouteKind;
  routeSource?: string;
}) {
  if (params.routeKind === "session-resume") {
    return `${params.sessionKey}::session-resume`;
  }
  if (params.routeKind === "descendant-settle") {
    return `${params.sessionKey}::descendant-settle::${params.routeSource || "unknown-descendant"}`;
  }
  return `${params.sessionKey}::${params.hook}::${params.taskId}`;
}

function getGovernorWakeTimestampMs(governorState: OrchestrationGovernorState | undefined, dedupeKey: string) {
  const value = governorState?.recentWakeByKey?.[dedupeKey];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getGovernorSessionWakeTimestampMs(governorState: OrchestrationGovernorState | undefined, sessionKey: string) {
  const value = governorState?.recentWakeBySession?.[sessionKey];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value?.at === "number" && Number.isFinite(value.at)) {
    return value.at;
  }
  return undefined;
}

function getMostRecentWakeTimestampMs(params: {
  dedupeKey: string;
  governorState?: OrchestrationGovernorState;
}) {
  const fromMemory = recentContinuationWakeKeys.get(params.dedupeKey);
  const fromGovernor = getGovernorWakeTimestampMs(params.governorState, params.dedupeKey);
  if (fromMemory === undefined) {
    return fromGovernor;
  }
  if (fromGovernor === undefined) {
    return fromMemory;
  }
  return Math.max(fromMemory, fromGovernor);
}

function getMostRecentSessionWakeTimestampMs(params: {
  sessionKey: string;
  governorState?: OrchestrationGovernorState;
}) {
  const fromMemory = recentContinuationWakeSessions.get(params.sessionKey);
  const fromGovernor = getGovernorSessionWakeTimestampMs(params.governorState, params.sessionKey);
  if (fromMemory === undefined) {
    return fromGovernor;
  }
  if (fromGovernor === undefined) {
    return fromMemory;
  }
  return Math.max(fromMemory, fromGovernor);
}

function pruneRecentWakeByKeyEntries(entries: OrchestrationGovernorState["recentWakeByKey"], cutoffMs: number) {
  const nextEntries: Record<string, number> = {};
  for (const [key, value] of Object.entries(entries ?? {})) {
    if (typeof value === "number" && Number.isFinite(value) && value >= cutoffMs) {
      nextEntries[key] = value;
    }
  }
  return nextEntries;
}

function pruneRecentWakeBySessionEntries(entries: OrchestrationGovernorState["recentWakeBySession"], cutoffMs: number) {
  const nextEntries: NonNullable<OrchestrationGovernorState["recentWakeBySession"]> = {};
  for (const [key, value] of Object.entries(entries ?? {})) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const at = value.at;
    if (typeof at === "number" && Number.isFinite(at) && at >= cutoffMs) {
      nextEntries[key] = value;
    }
  }
  return nextEntries;
}

function buildGovernorStateAfterSuccessfulWake(params: {
  governorState?: OrchestrationGovernorState;
  dedupeKey: string;
  sessionKey: string;
  hook: HookName;
  taskId: string;
  routeKind: ContinuationRouteKind;
  routeSource?: string;
  nowMs: number;
  retentionMs?: number;
}) {
  const retentionMs = params.retentionMs ?? DEFAULT_GOVERNOR_RETENTION_MS;
  const cutoffMs = params.nowMs - retentionMs;
  const recentWakeByKey = pruneRecentWakeByKeyEntries(params.governorState?.recentWakeByKey, cutoffMs);
  const recentWakeBySession = pruneRecentWakeBySessionEntries(params.governorState?.recentWakeBySession, cutoffMs);
  return {
    updatedAt: new Date(params.nowMs).toISOString(),
    recentWakeByKey: {
      ...recentWakeByKey,
      [params.dedupeKey]: params.nowMs,
    },
    recentWakeBySession: {
      ...recentWakeBySession,
      [params.sessionKey]: {
        at: params.nowMs,
        hook: params.hook,
        taskId: params.taskId,
        routeKind: params.routeKind,
        routeSource: params.routeSource,
      },
    },
  } satisfies OrchestrationGovernorState;
}

function shouldSuppressContinuationWake(params: {
  hook: HookName;
  ctx?: HookContextLike;
  sessionKey: string;
  taskId: string;
  routeKind: ContinuationRouteKind;
  routeSource?: string;
  nowMs: number;
  throttleWindowMs: number;
  governorState?: OrchestrationGovernorState;
}) {
  const { hook, ctx, sessionKey, taskId, routeKind, routeSource, nowMs, throttleWindowMs, governorState } = params;
  if (hook === "session_start" && ctx?.trigger === "heartbeat") {
    return "suppressed-heartbeat-session-start";
  }

  const dedupeKey = buildContinuationWakeKey({ sessionKey, hook, taskId, routeKind, routeSource });
  const previous = getMostRecentWakeTimestampMs({ dedupeKey, governorState });
  if (previous !== undefined && nowMs - previous < throttleWindowMs) {
    return routeKind === "session-resume"
      ? "suppressed-session-resume-coalesced"
      : routeKind === "descendant-settle"
        ? "suppressed-descendant-settle-coalesced"
        : "suppressed-duplicate-wake";
  }

  if (routeKind !== "session-resume") {
    const previousSessionWake = getMostRecentSessionWakeTimestampMs({ sessionKey, governorState });
    if (previousSessionWake !== undefined && nowMs - previousSessionWake < throttleWindowMs) {
      return "suppressed-session-target-coalesced";
    }
  }

  return null;
}

export function resetContinuationWakeThrottleForTests() {
  recentContinuationWakeKeys.clear();
  recentContinuationWakeSessions.clear();
}

export function triggerContinuationWake(params: {
  runtime?: {
    system?: {
      enqueueSystemEvent?: (text: string, options: { sessionKey: string; contextKey?: string | null }) => boolean;
      requestHeartbeatNow?: (options?: { reason?: string; sessionKey?: string }) => void;
    };
  };
  hook: HookName;
  payload: DispatcherPayload | null;
  event?: HookEventLike;
  ctx?: HookContextLike;
  logger?: { info?: (message: string) => void; warn?: (message: string) => void };
  nowMs?: number;
  throttleWindowMs?: number;
  governorState?: OrchestrationGovernorState;
}): ContinuationWakeResult {
  const { runtime, hook, payload, event, ctx, logger } = params;
  if (!payload || payload.decision !== "RUN") {
    return {
      triggered: false,
      reason: "no-runnable-task",
      taskId: payload?.taskId ? String(payload.taskId) : undefined,
      taskStatus: payload?.taskStatus ? String(payload.taskStatus) : undefined,
    };
  }

  const enqueueSystemEvent = runtime?.system?.enqueueSystemEvent;
  const requestHeartbeatNow = runtime?.system?.requestHeartbeatNow;
  if (!enqueueSystemEvent || !requestHeartbeatNow) {
    return {
      triggered: false,
      reason: "runtime-system-unavailable",
      taskId: payload.taskId ? String(payload.taskId) : undefined,
      taskStatus: payload.taskStatus ? String(payload.taskStatus) : undefined,
    };
  }

  const route = resolveContinuationRoute(hook, event, ctx);
  if (!route?.sessionKey) {
    return {
      triggered: false,
      reason: "missing-session-key",
      taskId: payload.taskId ? String(payload.taskId) : undefined,
      taskStatus: payload.taskStatus ? String(payload.taskStatus) : undefined,
    };
  }

  const sessionKey = route.sessionKey;
  const text = buildContinuationSystemEvent(hook, payload);
  const taskId = payload.taskId ? String(payload.taskId) : "unknown-task";
  const taskStatus = payload.taskStatus ? String(payload.taskStatus) : "unknown-status";
  const nowMs = params.nowMs ?? Date.now();
  const throttleWindowMs = params.throttleWindowMs ?? DEFAULT_WAKE_THROTTLE_WINDOW_MS;
  const suppressionReason = shouldSuppressContinuationWake({
    hook,
    ctx,
    sessionKey,
    taskId,
    routeKind: route.routeKind,
    routeSource: route.routeSource,
    nowMs,
    throttleWindowMs,
    governorState: params.governorState,
  });
  if (suppressionReason) {
    return {
      triggered: false,
      reason: suppressionReason,
      sessionKey,
      taskId,
      taskStatus,
      routeKind: route.routeKind,
      routeSource: route.routeSource,
      text,
    };
  }

  const dedupeKey = buildContinuationWakeKey({
    sessionKey,
    hook,
    taskId,
    routeKind: route.routeKind,
    routeSource: route.routeSource,
  });
  const enqueued = Boolean(enqueueSystemEvent(text, {
    sessionKey,
    contextKey: `miya:continuation:${taskId}:${taskStatus}`,
  }));
  if (!enqueued) {
    return {
      triggered: false,
      reason: "system-event-not-enqueued",
      sessionKey,
      taskId,
      taskStatus,
      routeKind: route.routeKind,
      routeSource: route.routeSource,
      enqueued: false,
      wakeRequested: false,
      text,
    };
  }

  recentContinuationWakeKeys.set(dedupeKey, nowMs);
  recentContinuationWakeSessions.set(sessionKey, nowMs);
  const governorStatePatch = buildGovernorStateAfterSuccessfulWake({
    governorState: params.governorState,
    dedupeKey,
    sessionKey,
    hook,
    taskId,
    routeKind: route.routeKind,
    routeSource: route.routeSource,
    nowMs,
  });

  requestHeartbeatNow({
    reason: `miya:${hook}:${taskId}`,
    sessionKey,
  });

  logger?.info?.(`[miya] continuation wake hook=${hook} session=${sessionKey} task=${taskId} status=${taskStatus}`);
  return {
    triggered: true,
    reason: "continuation-wake-requested",
    sessionKey,
    taskId,
    taskStatus,
    routeKind: route.routeKind,
    routeSource: route.routeSource,
    enqueued,
    wakeRequested: true,
    text,
    governorStatePatch,
  };
}

async function recordDispatcherState(
  hook: HookName,
  event: HookEventLike,
  ctx: HookContextLike | undefined,
  runtime: any,
  config: MiyaPluginConfig,
  logger?: { info?: (message: string) => void; warn?: (message: string) => void },
) {
  try {
    const payload = await runDispatcher(config);
    const runtimeState = hook === "before_agent_start" ? undefined : await readRuntimeState(config);
    const continuation = hook === "before_agent_start"
      ? { triggered: false, reason: "prompt-injection-only" }
      : triggerContinuationWake({
        runtime,
        hook,
        payload,
        event,
        ctx,
        logger,
        governorState: runtimeState?.orchestrationGovernor,
      });
    const result =
      payload.decision === "NO_RUNNABLE_TASK"
        ? "blocked"
        : payload.decision === "RUN"
          ? "ok"
          : "failed";

    await appendEvidenceRecord(createEvidenceRecord({
      action: hook === "before_agent_start" ? "workflow_hook" : "dispatcher",
      result,
      reason: String(payload.decision || "unknown"),
      target: hook,
      metadata: {
        taskId: payload.taskId,
        taskStatus: payload.taskStatus,
        nextAction: payload.nextAction,
        summary: payload.summary,
        appliedRepairs: payload.appliedRepairs,
        continuation,
      },
    }), config);

    if (hook !== "before_agent_start") {
      await appendEvidenceRecord(createEvidenceRecord({
        action: "continuation_wake",
        result: continuation.triggered
          ? "ok"
          : continuation.reason === "no-runnable-task"
            ? "blocked"
            : "failed",
        reason: continuation.reason,
        target: hook,
        metadata: {
          sessionKey: continuation.sessionKey,
          taskId: continuation.taskId,
          taskStatus: continuation.taskStatus,
          routeKind: continuation.routeKind,
          routeSource: continuation.routeSource,
          enqueued: continuation.enqueued,
          wakeRequested: continuation.wakeRequested,
        },
      }), config);
    }

    await updateRuntimeState({
      dispatcherProbe: {
        updatedAt: new Date().toISOString(),
        ok: payload.decision === "RUN" || payload.decision === "NO_RUNNABLE_TASK",
        payload,
      },
      workloopHook: {
        updatedAt: new Date().toISOString(),
        hook,
        sessionKey: ctx?.sessionKey,
        sessionId: ctx?.sessionId,
        trigger: ctx?.trigger,
        decision: String(payload.decision || ""),
        taskId: payload.taskId ? String(payload.taskId) : undefined,
        summary: payload.summary ? String(payload.summary) : undefined,
        nextAction: payload.nextAction ? String(payload.nextAction) : undefined,
        payload,
      },
      continuationWake: {
        updatedAt: new Date().toISOString(),
        hook,
        sessionKey: continuation.sessionKey,
        taskId: continuation.taskId,
        taskStatus: continuation.taskStatus,
        routeKind: continuation.routeKind,
        routeSource: continuation.routeSource,
        enqueued: continuation.enqueued,
        wakeRequested: continuation.wakeRequested,
        reason: continuation.reason,
        text: continuation.text,
      },
      ...(continuation.governorStatePatch ? { orchestrationGovernor: continuation.governorStatePatch } : {}),
    }, config);

    logger?.info?.(
      `[miya] workloop hook=${hook} decision=${String(payload.decision || "unknown")} task=${String(payload.taskId || "-")}`,
    );
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendEvidenceRecord(createEvidenceRecord({
      action: hook === "before_agent_start" ? "workflow_hook" : "dispatcher",
      result: "failed",
      reason: message,
      target: hook,
    }), config);
    await updateRuntimeState({
      dispatcherProbe: {
        updatedAt: new Date().toISOString(),
        ok: false,
        error: message,
      },
      workloopHook: {
        updatedAt: new Date().toISOString(),
        hook,
        sessionKey: ctx?.sessionKey,
        sessionId: ctx?.sessionId,
        trigger: ctx?.trigger,
        error: message,
      },
      continuationWake: {
        updatedAt: new Date().toISOString(),
        hook,
        sessionKey: resolveContinuationSessionKey(hook, event, ctx),
        error: message,
      },
    }, config);
    logger?.warn?.(`[miya] workloop hook=${hook} failed: ${message}`);
    return null;
  }
}

export function registerWorkflowHooks(api: any) {
  const config = getPluginConfig(api);
  const logger = api?.logger;
  const runtime = api?.runtime;

  api.on("session_start", async (event: unknown, ctx: HookContextLike) => {
    await recordDispatcherState("session_start", event as HookEventLike, ctx, runtime, config, logger);
  });

  api.on("agent_end", async (event: unknown, ctx: HookContextLike) => {
    await recordDispatcherState("agent_end", event as HookEventLike, ctx, runtime, config, logger);
  });

  api.on("subagent_ended", async (event: unknown, ctx: HookContextLike) => {
    await recordDispatcherState("subagent_ended", event as HookEventLike, ctx, runtime, config, logger);
  });

  api.on("before_agent_start", async (event: unknown, ctx: HookContextLike) => {
    const payload = await recordDispatcherState("before_agent_start", event as HookEventLike, ctx, runtime, config, logger);
    if (payload?.decision !== "RUN") {
      return;
    }
    return {
      prependSystemContext: buildWorkloopSystemContext(payload),
    };
  }, { priority: 120 });
}
