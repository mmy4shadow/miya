import { type MiyaPluginConfig, resolveFeatureFlags } from "./config.ts";
import { createEvidenceRecord, readEvidenceTail } from "./evidence.ts";
import { getMemoryLiteStatus } from "./memory-lite.ts";
import { getModelAssetMap, getModelBuckets, resolveMiyaPaths } from "./paths.ts";
import { getPersonaLiteStatus } from "./persona-lite.ts";
import { getVoiceStatus } from "./voice.ts";
import { getVramSchedulerStatus } from "./vram-scheduler.ts";
import { probeWorkerHealth } from "./worker-client.ts";
import { getWizardStatus } from "./wizard.ts";
import { readRuntimeState } from "./runtime-state.ts";

const RUNTIME_VALIDATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isRecentSuccessfulProbe(
  probe: { ok?: boolean; updatedAt?: string } | undefined,
  nowMs: number,
  maxAgeMs = RUNTIME_VALIDATION_MAX_AGE_MS,
) {
  if (!probe?.ok || !probe.updatedAt) return false;
  const updatedAtMs = Date.parse(probe.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  return nowMs - updatedAtMs <= maxAgeMs;
}

export type MiyaDiagnostics = {
  plugin: string;
  paths: ReturnType<typeof resolveMiyaPaths>;
  features: ReturnType<typeof resolveFeatureFlags>;
  worker: Awaited<ReturnType<typeof probeWorkerHealth>>;
  modelBuckets: Awaited<ReturnType<typeof getModelBuckets>>;
  modelAssets: Awaited<ReturnType<typeof getModelAssetMap>>;
  memoryLite: Awaited<ReturnType<typeof getMemoryLiteStatus>>;
  personaLite: ReturnType<typeof getPersonaLiteStatus>;
  voice: Awaited<ReturnType<typeof getVoiceStatus>>;
  vramScheduler: ReturnType<typeof getVramSchedulerStatus>;
  wizard: Awaited<ReturnType<typeof getWizardStatus>>;
  acceptanceChecklist: { item: string; status: "done" | "todo" | "blocked"; note?: string }[];
  workerEvidence: ReturnType<typeof createEvidenceRecord>;
  capabilitiesEvidence: ReturnType<typeof createEvidenceRecord>;
  evidence: ReturnType<typeof createEvidenceRecord>[];
};

export async function collectDiagnostics(config?: MiyaPluginConfig): Promise<MiyaDiagnostics> {
  const paths = resolveMiyaPaths(config);
  const [worker, modelBuckets, modelAssets, voice, memoryLite, wizard, recentEvidence, runtimeState] = await Promise.all([
    probeWorkerHealth(config),
    getModelBuckets(paths.modelRoot),
    getModelAssetMap(paths.modelRoot),
    getVoiceStatus(config),
    getMemoryLiteStatus(config),
    getWizardStatus(config),
    readEvidenceTail(12, config),
    readRuntimeState(config),
  ]);
  const nowMs = Date.now();
  const runtimeValidated = Boolean(
    isRecentSuccessfulProbe(runtimeState?.workerHealthProbe, nowMs)
    || isRecentSuccessfulProbe(runtimeState?.voiceProbe, nowMs)
    || isRecentSuccessfulProbe(runtimeState?.imageProbe, nowMs)
    || isRecentSuccessfulProbe(runtimeState?.desktopRunProbe, nowMs)
    || isRecentSuccessfulProbe(runtimeState?.awakeProbe, nowMs),
  );

  const workerEvidence = createEvidenceRecord({
    action: "health_probe",
    result: worker.ok ? "ok" : worker.state === "disabled" || worker.state === "skipped" ? "blocked" : "failed",
    reason: worker.state,
    target: worker.target,
    metadata: {
      detail: worker.detail,
      observedAt: worker.observedAt,
    },
  });
  const capabilitiesEvidence = createEvidenceRecord({
    action: "capabilities_probe",
    result: "ok",
    reason: "diagnostics_compiled",
    metadata: {
      features: resolveFeatureFlags(config),
      assetsPresent: modelAssets.filter((asset) => asset.exists).map((asset) => asset.key),
    },
  });

  return {
    plugin: "miya",
    paths,
    features: resolveFeatureFlags(config),
    worker,
    modelBuckets,
    modelAssets,
    memoryLite,
    personaLite: getPersonaLiteStatus(config),
    voice,
    vramScheduler: getVramSchedulerStatus(config),
    wizard,
    acceptanceChecklist: [
      { item: "Phase 1 worker config + client exists", status: "done" },
      { item: "Worker health probe reaches real runtime", status: worker.state === "healthy" ? "done" : "todo", note: worker.detail },
      { item: "Memory-lite recall runtime available", status: memoryLite.enabled && memoryLite.cacheReady ? "done" : "todo" },
      { item: "Persona-lite prompt injection available", status: getPersonaLiteStatus(config).enabled ? "done" : "todo" },
      { item: "Voice assets mapped to local directories", status: modelAssets.some((asset) => asset.key === "voice.tts" && asset.exists) ? "done" : "todo" },
      { item: "VRAM scheduler lanes defined", status: "done" },
      { item: "Wizard/training descriptors defined", status: "done" },
      { item: "Wizard runner can execute local staged jobs", status: "done" },
      { item: "External runtime validation batch completed", status: runtimeValidated ? "done" : "todo", note: runtimeValidated ? "Recent (<24h) runtime-state contains successful live probe evidence." : "Needs fresh worker/model runtime verification (or recent runtime-state evidence within 24h)." },
    ],
    workerEvidence,
    capabilitiesEvidence,
    evidence: [
      ...recentEvidence,
      workerEvidence,
      capabilitiesEvidence,
    ].slice(-20),
  };
}
