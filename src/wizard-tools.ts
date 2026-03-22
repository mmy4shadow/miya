import { getWizardStatus, createWizardJob, updateWizardJob, runWizardJob, type TrainingJobDescriptor } from "./wizard.ts";
import type { MiyaPluginConfig } from "./config.ts";
import { appendEvidenceRecord, createEvidenceRecord } from "./evidence.ts";
import { updateRuntimeState } from "./runtime-state.ts";

function getPluginConfig(api: any): MiyaPluginConfig {
  return (api?.pluginConfig ?? api?.config?.plugins?.entries?.miya?.config ?? {}) as MiyaPluginConfig;
}

export async function recordWizardExecution(action: string, payload: any, config: MiyaPluginConfig) {
  const ok = payload?.status === "ok";
  const job = payload?.job;
  const artifactPath = Array.isArray(job?.notes)
    ? (
      job.notes.find((note: string) => typeof note === "string" && note.startsWith("manifest_ready:"))?.replace("manifest_ready:", "")
      ?? job.notes.find((note: string) => typeof note === "string" && note.startsWith("artifacts_ready:"))?.replace("artifacts_ready:", "")
    )
    : undefined;
  await appendEvidenceRecord(createEvidenceRecord({
    action: "wizard",
    result: ok ? "ok" : "failed",
    reason: String(payload?.code ?? payload?.status ?? "unknown"),
    target: `wizard:${action}`,
    metadata: {
      action,
      jobId: job?.id,
      jobStatus: job?.status,
      artifactPath,
    },
  }), config);
  await updateRuntimeState({
    wizardProbe: {
      updatedAt: new Date().toISOString(),
      ok,
      action,
      jobId: typeof job?.id === "string" ? job.id : undefined,
      artifactPath,
      payload,
      error: ok ? undefined : typeof payload?.error === "string" ? payload.error : undefined,
    },
  }, config);
}

export function registerWizardTools(api: any) {
  const config = getPluginConfig(api);

  api.registerTool({
    name: "miya_wizard_status",
    description: "Read Miya wizard training ledger status.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      const payload = await getWizardStatus(config);
      await recordWizardExecution("status", { status: "ok", job: undefined, payload }, config);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_wizard_start_job",
    description: "Persist a staged wizard/training job descriptor.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["persona-dataset", "voice-adapter", "vision-adapter", "lora-finetune", "full-finetune"] },
        datasetPath: { type: "string" },
        outputPath: { type: "string" },
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
        trainer: {
          type: "object",
          additionalProperties: false,
          properties: {
            profile: { type: "string", enum: ["lora", "finetune"] },
            command: { type: "string" },
            args: { type: "array", items: { type: "string" } },
            cwd: { type: "string" },
            artifactGlobs: { type: "array", items: { type: "string" } },
            env: { type: "object", additionalProperties: { type: "string" } },
          },
        },
      },
      required: ["kind", "datasetPath", "outputPath"],
    },
    async execute(_id: string, params: Partial<TrainingJobDescriptor>) {
      const payload = await createWizardJob({
        kind: params.kind as TrainingJobDescriptor["kind"],
        datasetPath: String(params.datasetPath ?? ""),
        outputPath: String(params.outputPath ?? ""),
        command: typeof params.command === "string" ? params.command : undefined,
        args: Array.isArray((params as any).args) ? (params as any).args.map((value: unknown) => String(value)) : undefined,
        notes: Array.isArray(params.notes) ? params.notes.map((value) => String(value)) : [],
        trainer: (params as any).trainer,
      }, config);
      await recordWizardExecution("start", payload, config);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_wizard_update_job",
    description: "Update an existing wizard job status or notes.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["idle", "collecting", "preparing", "queued", "running", "complete", "failed"] },
        notes: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
    async execute(_id: string, params: { id: string; status?: TrainingJobDescriptor["status"]; notes?: string[] }) {
      const payload = await updateWizardJob(params.id, {
        status: params.status,
        notes: Array.isArray(params.notes) ? params.notes.map((value) => String(value)) : undefined,
      }, config);
      await recordWizardExecution("update", payload, config);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_wizard_run_job",
    description: "Execute a staged wizard job through the local runner.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    async execute(_id: string, params: { id: string }) {
      const payload = await runWizardJob(String(params.id ?? ""), config);
      await recordWizardExecution("run", payload, config);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });
}
