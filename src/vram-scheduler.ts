import { resolveVramSchedulerConfig, type MiyaPluginConfig } from "./config.ts";

export type ModelLaneDefinition = {
  lane: "interactive" | "voice" | "vision" | "image" | "training";
  priority: number;
  maxModels: number;
  exampleUses: string[];
};

export type VramSchedulerStatus = {
  enabled: boolean;
  strategy: "manual-lanes" | "none";
  defaultLane: ModelLaneDefinition["lane"];
  lanes: ModelLaneDefinition[];
  notes: string[];
};

export type VramLaneLease = {
  id: string;
  lane: ModelLaneDefinition["lane"];
  acquiredAt: string;
};

const activeLeases = new Map<ModelLaneDefinition["lane"], Map<string, VramLaneLease>>();

export function getVramSchedulerStatus(config?: MiyaPluginConfig): VramSchedulerStatus {
  const resolved = resolveVramSchedulerConfig(config);
  return {
    enabled: resolved.enabled,
    strategy: resolved.strategy,
    defaultLane: resolved.defaultLane,
    lanes: resolved.lanes.map((lane) => ({
      lane: lane.lane,
      priority: lane.priority ?? 0,
      maxModels: lane.maxModels ?? 1,
      exampleUses: getLaneExamples(lane.lane),
    })),
    notes: [
      "Lane admission is process-local and lightweight; it prevents oversubscription inside one Miya runtime process.",
      "This scheduler still does not inspect real GPU memory or force-unload external runtimes.",
    ],
  };
}

export function acquireVramLane(lane: ModelLaneDefinition["lane"], config?: MiyaPluginConfig) {
  const scheduler = resolveVramSchedulerConfig(config);
  const definition = scheduler.lanes.find((entry) => entry.lane === lane) ?? { lane, maxModels: 1, priority: 0 };
  const bucket = activeLeases.get(lane) ?? new Map<string, VramLaneLease>();
  activeLeases.set(lane, bucket);

  if (scheduler.enabled && bucket.size >= (definition.maxModels ?? 1)) {
    return {
      ok: false,
      code: "lane_busy",
      reason: `lane ${lane} is at capacity`,
      lane,
      active: [...bucket.values()],
      limit: definition.maxModels ?? 1,
    };
  }

  const lease: VramLaneLease = {
    id: `${lane}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lane,
    acquiredAt: new Date().toISOString(),
  };
  bucket.set(lease.id, lease);
  return {
    ok: true,
    lease,
    limit: definition.maxModels ?? 1,
    activeCount: bucket.size,
  };
}

export function releaseVramLane(leaseId?: string, lane?: ModelLaneDefinition["lane"]) {
  if (!leaseId || !lane) {
    return;
  }
  const bucket = activeLeases.get(lane);
  bucket?.delete(leaseId);
}

function getLaneExamples(lane: ModelLaneDefinition["lane"]): string[] {
  switch (lane) {
    case "interactive":
      return ["chat", "persona-lite context assembly"];
    case "voice":
      return ["tts", "speaker-id", "future vad/asr"];
    case "vision":
      return ["screenshot understanding", "desktop inspect reasoning"];
    case "image":
      return ["flux image generation", "reference image workflows"];
    case "training":
      return ["wizard fine-tune jobs", "dataset preparation"];
  }
}
