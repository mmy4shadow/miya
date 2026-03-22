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
  const runtimeValidated = Boolean(
    runtimeState?.voiceProbe?.ok
    || runtimeState?.imageProbe?.ok
    || runtimeState?.desktopRunProbe?.ok
    || runtimeState?.awakeProbe?.ok,
  );

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
      { item: "External runtime validation batch completed", status: runtimeValidated ? "done" : "todo", note: runtimeValidated ? "Recent runtime-state contains successful live probe evidence." : "Needs manual worker/model runtime verification." },
    ],
    evidence: [
      ...recentEvidence,
      createEvidenceRecord({
        action: "health_probe",
        result: worker.ok ? "ok" : worker.state === "disabled" || worker.state === "skipped" ? "blocked" : "failed",
        reason: worker.state,
        target: worker.target,
        metadata: {
          detail: worker.detail,
          observedAt: worker.observedAt,
        },
      }),
      createEvidenceRecord({
        action: "capabilities_probe",
        result: "ok",
        reason: "diagnostics_compiled",
        metadata: {
          features: resolveFeatureFlags(config),
          assetsPresent: modelAssets.filter((asset) => asset.exists).map((asset) => asset.key),
        },
      }),
    ].slice(-20),
  };
}
