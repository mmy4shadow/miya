import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import childProcess from "node:child_process";
import { resolveVramSchedulerConfig, type MiyaPluginConfig } from "./config.ts";
import { resolveMiyaPaths } from "./paths.ts";
import { replaceFileAtomicSync } from "./atomic-file.ts";

export type ModelLaneDefinition = {
  lane: "interactive" | "voice" | "vision" | "image" | "training";
  priority: number;
  maxModels: number;
  estimatedVramMb?: number;
  evictable?: boolean;
  exampleUses: string[];
};

export type VramEvictionRecord = {
  leaseId: string;
  lane: ModelLaneDefinition["lane"];
  pid?: number;
  estimatedVramMb?: number;
  reason: string;
  via: "process-kill" | "hook";
  observedAt: string;
};

export type VramSchedulerStatus = {
  enabled: boolean;
  strategy: "manual-lanes" | "none";
  defaultLane: ModelLaneDefinition["lane"];
  lanes: ModelLaneDefinition[];
  gpuTelemetry?: {
    source: string;
    gpuIndex: number;
    freeMb?: number;
    totalMb?: number;
    available: boolean;
    error?: string;
  };
  activeLeaseCount: number;
  recentEvictions: VramEvictionRecord[];
  notes: string[];
};

export type VramLaneLease = {
  id: string;
  lane: ModelLaneDefinition["lane"];
  acquiredAt: string;
  pid?: number;
  estimatedVramMb?: number;
  priority?: number;
  evictable?: boolean;
  owner?: string;
};

type PersistedLease = VramLaneLease & {
  releasedAt?: string;
  releaseReason?: "released" | "evicted";
};

type PersistedSchedulerState = {
  updatedAt: string;
  strategy: "manual-lanes" | "none";
  leases: PersistedLease[];
  recentEvictions: VramEvictionRecord[];
};

type GpuMemorySnapshot = {
  source: string;
  gpuIndex: number;
  freeMb?: number;
  totalMb?: number;
  available: boolean;
  error?: string;
};

type FragmentationDiagnostic = {
  suspected: boolean;
  reclaimableMb: number;
  slackMb: number;
  reason?: string;
};

type ForceEvictionResult = {
  attempted: boolean;
  ok: boolean;
  releasedMb: number;
  evicted: VramEvictionRecord[];
  blocked?: PersistedLease[];
  error?: string;
};

const EMPTY_SCHEDULER_UPDATED_AT = new Date(0).toISOString();
const activeLeases = new Map<ModelLaneDefinition["lane"], Map<string, VramLaneLease>>();
const DEFAULT_TOTAL_CAPACITY = 3;
const RECENT_EVICTION_LIMIT = 20;

function getStateFile(config?: MiyaPluginConfig) {
  const paths = resolveMiyaPaths(config);
  return path.join(paths.pluginRoot, "state", "vram-scheduler.json");
}

function getLaneExamples(lane: ModelLaneDefinition["lane"]): string[] {
  switch (lane) {
    case "interactive":
      return ["chat", "persona-lite context assembly"];
    case "voice":
      return ["tts", "speaker-id", "vad", "asr"];
    case "vision":
      return ["screenshot understanding", "desktop inspect reasoning"];
    case "image":
      return ["flux image generation", "reference image workflows"];
    case "training":
      return ["wizard fine-tune jobs", "dataset preparation"];
  }
}

function processIsAlive(pid?: number) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeEmptyPersistedState(): PersistedSchedulerState {
  return {
    updatedAt: EMPTY_SCHEDULER_UPDATED_AT,
    strategy: "manual-lanes",
    leases: [],
    recentEvictions: [],
  };
}

function makeCorruptStateFile(stateFile: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(path.dirname(stateFile), `vram-scheduler.corrupt-${stamp}.json`);
}

function readPersistedState(config?: MiyaPluginConfig): PersistedSchedulerState {
  const stateFile = getStateFile(config);
  let raw: string;
  try {
    raw = fs.readFileSync(stateFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return makeEmptyPersistedState();
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedSchedulerState;
    return {
      updatedAt: parsed.updatedAt ?? EMPTY_SCHEDULER_UPDATED_AT,
      strategy: parsed.strategy ?? "manual-lanes",
      leases: Array.isArray(parsed.leases) ? parsed.leases : [],
      recentEvictions: Array.isArray(parsed.recentEvictions) ? parsed.recentEvictions : [],
    };
  } catch {
    try {
      const corruptFile = makeCorruptStateFile(stateFile);
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.renameSync(stateFile, corruptFile);
    } catch {
      // Best effort quarantine only; the caller still gets a safe empty state.
    }
    return makeEmptyPersistedState();
  }
}

function writePersistedState(state: PersistedSchedulerState, config?: MiyaPluginConfig) {
  const stateFile = getStateFile(config);
  const stateDir = path.dirname(stateFile);
  const tempFile = path.join(stateDir, `vram-scheduler.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(stateDir, { recursive: true });
  try {
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), "utf8");
    replaceFileAtomicSync(tempFile, stateFile);
  } catch (error) {
    try {
      fs.rmSync(tempFile, { force: true });
    } catch {
      // Best effort temp cleanup only; preserve original failure.
    }
    throw error;
  }
}

function compactRecentEvictions(records: VramEvictionRecord[]) {
  return records.slice(-RECENT_EVICTION_LIMIT);
}

function prunePersistedLeases(config?: MiyaPluginConfig) {
  const state = readPersistedState(config);
  const leases = state.leases.filter((lease) => !lease.releasedAt && processIsAlive(lease.pid));
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
    leases,
  } satisfies PersistedSchedulerState;
  writePersistedState(next, config);
  return next;
}

function getResolvedLaneDefinitions(config?: MiyaPluginConfig): ModelLaneDefinition[] {
  const scheduler = resolveVramSchedulerConfig(config);
  return scheduler.lanes.map((lane) => ({
    lane: lane.lane,
    priority: lane.priority ?? 0,
    maxModels: lane.maxModels ?? 1,
    estimatedVramMb: lane.estimatedVramMb ?? 0,
    evictable: lane.evictable ?? true,
    exampleUses: getLaneExamples(lane.lane),
  }));
}

function findLaneDefinition(lane: ModelLaneDefinition["lane"], config?: MiyaPluginConfig) {
  return getResolvedLaneDefinitions(config).find((entry) => entry.lane === lane) ?? {
    lane,
    priority: 0,
    maxModels: 1,
    estimatedVramMb: 0,
    evictable: true,
    exampleUses: getLaneExamples(lane),
  };
}

function readGpuMemorySnapshot(config?: MiyaPluginConfig): GpuMemorySnapshot {
  const scheduler = resolveVramSchedulerConfig(config);
  const args = [
    ...(scheduler.telemetryArgs ?? []),
    `--query-gpu=memory.free,memory.total`,
    "--format=csv,noheader,nounits",
    "-i",
    String(scheduler.gpuIndex ?? 0),
  ];

  try {
    const raw = childProcess.execFileSync(scheduler.telemetryCommand || "nvidia-smi", args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
    }).trim();
    const firstLine = raw.split(/\r?\n/).find(Boolean) ?? "";
    const [freeText, totalText] = firstLine.split(",").map((value) => value.trim());
    const freeMb = Number.parseInt(freeText, 10);
    const totalMb = Number.parseInt(totalText, 10);
    if (!Number.isFinite(freeMb) || !Number.isFinite(totalMb)) {
      return {
        source: scheduler.telemetryCommand || "nvidia-smi",
        gpuIndex: scheduler.gpuIndex ?? 0,
        available: false,
        error: `unexpected_gpu_telemetry_output:${raw}`,
      };
    }
    return {
      source: scheduler.telemetryCommand || "nvidia-smi",
      gpuIndex: scheduler.gpuIndex ?? 0,
      freeMb,
      totalMb,
      available: true,
    };
  } catch (error) {
    return {
      source: scheduler.telemetryCommand || "nvidia-smi",
      gpuIndex: scheduler.gpuIndex ?? 0,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectEvictionCandidates(
  state: PersistedSchedulerState,
  requestedLane: ModelLaneDefinition["lane"],
  config?: MiyaPluginConfig,
) {
  const requestedDefinition = findLaneDefinition(requestedLane, config);
  return state.leases
    .map((lease) => ({
      ...lease,
      priority: lease.priority ?? findLaneDefinition(lease.lane, config).priority ?? 0,
      estimatedVramMb: lease.estimatedVramMb ?? findLaneDefinition(lease.lane, config).estimatedVramMb ?? 0,
      evictable: lease.evictable ?? findLaneDefinition(lease.lane, config).evictable ?? true,
    }))
    .filter((lease) => lease.priority < requestedDefinition.priority && lease.evictable !== false)
    .sort((left, right) => {
      if ((left.priority ?? 0) !== (right.priority ?? 0)) {
        return (left.priority ?? 0) - (right.priority ?? 0);
      }
      return (left.acquiredAt ?? "").localeCompare(right.acquiredAt ?? "");
    });
}

function computeFragmentationDiagnostic(
  telemetry: GpuMemorySnapshot,
  requiredFreeMb: number,
  candidates: Array<PersistedLease & { estimatedVramMb?: number }>,
  config?: MiyaPluginConfig,
): FragmentationDiagnostic {
  const scheduler = resolveVramSchedulerConfig(config);
  const freeMb = telemetry.freeMb ?? 0;
  const reclaimableMb = candidates.reduce((sum, candidate) => sum + Math.max(candidate.estimatedVramMb ?? 0, 0), 0);
  const slackMb = scheduler.fragmentationSlackMb ?? 0;
  const suspected = telemetry.available && freeMb < requiredFreeMb && (freeMb + reclaimableMb) >= (requiredFreeMb + slackMb);
  return {
    suspected,
    reclaimableMb,
    slackMb,
    reason: suspected
      ? `free=${freeMb}MB is below required=${requiredFreeMb}MB, but reclaimable=${reclaimableMb}MB suggests fragmentation or stale allocations`
      : undefined,
  };
}

function executeSchedulerHook(
  command: string,
  args: string[],
  payload: Record<string, unknown>,
) {
  const completed = childProcess.spawnSync(command, args, {
    input: JSON.stringify(payload),
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });

  return {
    ok: completed.status === 0,
    status: completed.status,
    stdout: completed.stdout?.trim() || "",
    stderr: completed.stderr?.trim() || "",
    error: completed.error ? String(completed.error) : undefined,
  };
}

function markLeasesReleased(
  state: PersistedSchedulerState,
  leases: PersistedLease[],
  releaseReason: "released" | "evicted",
) {
  const ids = new Set(leases.map((lease) => lease.id));
  return state.leases.filter((lease) => !ids.has(lease.id)).map((lease) => ({
    ...lease,
    releasedAt: lease.releasedAt,
    releaseReason: lease.releaseReason,
  }));
}

function evictCandidates(
  candidates: Array<PersistedLease & { estimatedVramMb?: number }>,
  requestedLane: ModelLaneDefinition["lane"],
  requestedFreeMb: number,
  config?: MiyaPluginConfig,
): ForceEvictionResult {
  const scheduler = resolveVramSchedulerConfig(config);
  if (!scheduler.allowForceEvict) {
    return { attempted: false, ok: false, releasedMb: 0, evicted: [] };
  }

  const selected: Array<PersistedLease & { estimatedVramMb?: number }> = [];
  let releasedMb = 0;
  for (const candidate of candidates) {
    selected.push(candidate);
    releasedMb += Math.max(candidate.estimatedVramMb ?? 0, 0);
    if (releasedMb >= requestedFreeMb) {
      break;
    }
  }
  if (!selected.length) {
    return { attempted: true, ok: false, releasedMb: 0, evicted: [], blocked: [] };
  }

  const blocked: PersistedLease[] = [];
  const evicted: VramEvictionRecord[] = [];
  for (const candidate of selected) {
    const observedAt = new Date().toISOString();
    if (candidate.pid && candidate.pid > 0 && candidate.pid !== process.pid) {
      try {
        process.kill(candidate.pid);
        evicted.push({
          leaseId: candidate.id,
          lane: candidate.lane,
          pid: candidate.pid,
          estimatedVramMb: candidate.estimatedVramMb,
          reason: `evicted for higher-priority lane ${requestedLane}`,
          via: "process-kill",
          observedAt,
        });
        continue;
      } catch {
        // Fall through to hook path.
      }
    }

    if (scheduler.evictionCommand) {
      const hookResult = executeSchedulerHook(scheduler.evictionCommand, scheduler.evictionArgs ?? [], {
        action: "evict",
        requestedLane,
        lease: candidate,
      });
      if (hookResult.ok) {
        evicted.push({
          leaseId: candidate.id,
          lane: candidate.lane,
          pid: candidate.pid,
          estimatedVramMb: candidate.estimatedVramMb,
          reason: `evicted by hook for higher-priority lane ${requestedLane}`,
          via: "hook",
          observedAt,
        });
        continue;
      }
    }

    blocked.push(candidate);
  }

  return {
    attempted: true,
    ok: blocked.length === 0 && evicted.length > 0,
    releasedMb: evicted.reduce((sum, item) => sum + Math.max(item.estimatedVramMb ?? 0, 0), 0),
    evicted,
    blocked,
    error: blocked.length ? `unable_to_evict_${blocked.length}_lease(s)` : undefined,
  };
}

function maybeRunDefragHook(
  fragmentation: FragmentationDiagnostic,
  requestedLane: ModelLaneDefinition["lane"],
  config?: MiyaPluginConfig,
) {
  const scheduler = resolveVramSchedulerConfig(config);
  if (!fragmentation.suspected || !scheduler.defragCommand) {
    return null;
  }
  return executeSchedulerHook(scheduler.defragCommand, scheduler.defragArgs ?? [], {
    action: "defrag",
    requestedLane,
    fragmentation,
  });
}

function persistEvictions(evicted: VramEvictionRecord[], config?: MiyaPluginConfig) {
  if (!evicted.length) {
    return prunePersistedLeases(config);
  }
  const refreshed = prunePersistedLeases(config);
  const nextState = {
    ...refreshed,
    recentEvictions: compactRecentEvictions([...(refreshed.recentEvictions ?? []), ...evicted]),
  } satisfies PersistedSchedulerState;
  writePersistedState(nextState, config);
  return nextState;
}

export function getVramSchedulerStatus(config?: MiyaPluginConfig): VramSchedulerStatus {
  const resolved = resolveVramSchedulerConfig(config);
  const persisted = prunePersistedLeases(config);
  const gpuTelemetry = readGpuMemorySnapshot(config);
  return {
    enabled: resolved.enabled,
    strategy: resolved.strategy,
    defaultLane: resolved.defaultLane,
    lanes: getResolvedLaneDefinitions(config),
    gpuTelemetry,
    activeLeaseCount: persisted.leases.length,
    recentEvictions: persisted.recentEvictions ?? [],
    notes: [
      "Lane admission is persisted under state/vram-scheduler.json and prunes dead-process leases.",
      resolved.allowForceEvict
        ? "Force-eviction is enabled for lower-priority evictable lanes."
        : "Force-eviction is disabled; lower-priority leases will block new heavy jobs instead of being reclaimed.",
      resolved.defragCommand
        ? "A configurable defrag hook is available when fragmentation risk is detected."
        : "No defrag hook is configured; fragmentation is diagnosed but not actively compacted.",
    ],
  };
}

export function acquireVramLane(
  lane: ModelLaneDefinition["lane"],
  config?: MiyaPluginConfig,
  options?: { ownerPid?: number; estimatedVramMb?: number; owner?: string; evictable?: boolean },
) {
  const scheduler = resolveVramSchedulerConfig(config);
  const definition = findLaneDefinition(lane, config);
  const bucket = activeLeases.get(lane) ?? new Map<string, VramLaneLease>();
  activeLeases.set(lane, bucket);

  const lease: VramLaneLease = {
    id: `${lane}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lane,
    acquiredAt: new Date().toISOString(),
    pid: options?.ownerPid ?? process.pid,
    estimatedVramMb: options?.estimatedVramMb ?? definition.estimatedVramMb ?? 0,
    priority: definition.priority,
    evictable: options?.evictable ?? definition.evictable ?? true,
    owner: options?.owner,
  };

  let state = prunePersistedLeases(config);
  const laneActive = state.leases.filter((entry) => entry.lane === lane);
  const totalActive = state.leases.length;
  const totalCapacity = Math.max(
    getResolvedLaneDefinitions(config).reduce((max, entry) => Math.max(max, entry.maxModels ?? 1), 0),
    DEFAULT_TOTAL_CAPACITY,
  );
  const gpuTelemetry = readGpuMemorySnapshot(config);
  const estimatedVramMb = lease.estimatedVramMb ?? 0;
  const requiredFreeMb = estimatedVramMb + (scheduler.minFreeMb ?? 0);
  const candidates = collectEvictionCandidates(state, lane, config);
  const fragmentation = computeFragmentationDiagnostic(gpuTelemetry, requiredFreeMb, candidates, config);

  if (scheduler.enabled && laneActive.length >= (definition.maxModels ?? 1)) {
    const laneCandidates = candidates.filter((candidate) => candidate.lane === lane);
    const eviction = evictCandidates(laneCandidates, lane, estimatedVramMb, config);
    if (!eviction.ok) {
      return {
        ok: false,
        code: "lane_busy",
        reason: `lane ${lane} is at capacity`,
        lane,
        active: laneActive,
        limit: definition.maxModels ?? 1,
        telemetry: gpuTelemetry,
        forceEviction: eviction,
      };
    }
    state = persistEvictions(eviction.evicted, config);
  }

  if (scheduler.enabled && totalActive >= totalCapacity) {
    const activeByPriority = state.leases
      .map((entry) => ({
        ...entry,
        priority: entry.priority ?? findLaneDefinition(entry.lane, config).priority ?? 0,
      }))
      .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
    const lowest = activeByPriority[0];
    const requestedPriority = definition.priority ?? 0;
    if (lowest && requestedPriority <= (lowest.priority ?? 0)) {
      return {
        ok: false,
        code: "scheduler_busy",
        reason: `global VRAM budget is full; lowest active lane=${lowest.lane} priority=${lowest.priority}`,
        lane,
        active: state.leases,
        totalCapacity,
        telemetry: gpuTelemetry,
      };
    }

    const eviction = evictCandidates(candidates, lane, estimatedVramMb, config);
    if (!eviction.ok) {
      return {
        ok: false,
        code: "scheduler_busy",
        reason: `global VRAM budget is full and lower-priority leases could not be reclaimed`,
        lane,
        active: state.leases,
        totalCapacity,
        telemetry: gpuTelemetry,
        forceEviction: eviction,
      };
    }
    state = persistEvictions(eviction.evicted, config);
  }

  if (scheduler.enabled && gpuTelemetry.available && gpuTelemetry.freeMb !== undefined && gpuTelemetry.freeMb < requiredFreeMb) {
    const defragResult = maybeRunDefragHook(fragmentation, lane, config);
    const eviction = evictCandidates(candidates, lane, requiredFreeMb - (gpuTelemetry.freeMb ?? 0), config);
    state = persistEvictions(eviction.evicted, config);

    const refreshedTelemetry = readGpuMemorySnapshot(config);
    if (!refreshedTelemetry.available || refreshedTelemetry.freeMb === undefined || refreshedTelemetry.freeMb < requiredFreeMb) {
      return {
        ok: false,
        code: "gpu_memory_low",
        reason: `gpu ${refreshedTelemetry.gpuIndex} free=${refreshedTelemetry.freeMb}MB below required=${requiredFreeMb}MB for lane ${lane}`,
        lane,
        freeMb: refreshedTelemetry.freeMb,
        totalMb: refreshedTelemetry.totalMb,
        requiredFreeMb,
        estimatedVramMb,
        telemetry: refreshedTelemetry,
        fragmentation,
        forceEviction: eviction,
        defrag: defragResult,
      };
    }
    state = prunePersistedLeases(config);
  }

  const nextState = {
    updatedAt: new Date().toISOString(),
    strategy: scheduler.strategy,
    leases: [...state.leases, lease],
    recentEvictions: compactRecentEvictions(state.recentEvictions ?? []),
  } satisfies PersistedSchedulerState;
  writePersistedState(nextState, config);
  bucket.set(lease.id, lease);
  return {
    ok: true,
    lease,
    limit: definition.maxModels ?? 1,
    activeCount: state.leases.filter((entry) => entry.lane === lane).length + 1,
    totalCapacity,
    totalActiveCount: nextState.leases.length,
    estimatedVramMb,
    telemetry: gpuTelemetry,
    fragmentation,
  };
}

export function releaseVramLane(
  leaseId?: string,
  lane?: ModelLaneDefinition["lane"],
  config?: MiyaPluginConfig,
  reason: "released" | "evicted" = "released",
) {
  if (!leaseId || !lane) {
    return;
  }
  const bucket = activeLeases.get(lane);
  bucket?.delete(leaseId);
  const state = readPersistedState(config);
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
    leases: state.leases.filter((lease) => lease.id !== leaseId),
  } satisfies PersistedSchedulerState;
  writePersistedState(next, config);
}

export function releaseOwnedVramLeases(
  ownerPid: number | undefined,
  config?: MiyaPluginConfig,
  reason: "released" | "evicted" = "released",
) {
  if (!ownerPid || ownerPid <= 0) {
    return [];
  }
  const state = readPersistedState(config);
  const owned = state.leases.filter((lease) => lease.pid === ownerPid);
  if (!owned.length) {
    return [];
  }

  for (const lease of owned) {
    activeLeases.get(lease.lane)?.delete(lease.id);
  }

  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
    leases: state.leases.filter((lease) => lease.pid !== ownerPid),
  } satisfies PersistedSchedulerState;
  writePersistedState(next, config);
  return owned.map((lease) => ({ ...lease, releaseReason: reason }));
}
