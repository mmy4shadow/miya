import { promises as fs } from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { resolveWizardConfig, type MiyaPluginConfig } from "./config.ts";
import { resolveMiyaPaths } from "./paths.ts";
import { acquireVramLane, releaseOwnedVramLeases, releaseVramLane } from "./vram-scheduler.ts";
import { validateTrainingDataset, type DatasetValidationResult } from "./dataset-validation.ts";
import { resolveTrainerAdapterSpec, type TrainerAdapterSpec } from "./trainer-adapters.ts";
import { replaceFileAtomic } from "./atomic-file.ts";

export type WizardStage = "idle" | "collecting" | "preparing" | "queued" | "running" | "complete" | "failed";
export type WizardJobKind = "persona-dataset" | "voice-adapter" | "vision-adapter" | "lora-finetune" | "full-finetune";

export type WizardTrainerBinding = {
  profile?: "lora" | "finetune";
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  artifactGlobs?: string[];
};

export type TrainingJobDescriptor = {
  id: string;
  kind: WizardJobKind;
  datasetPath: string;
  outputPath: string;
  status: WizardStage;
  requestedAt: string;
  notes?: string[];
  command?: string;
  args?: string[];
  pid?: number;
  logPath?: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  vramLeaseId?: string;
  trainer?: WizardTrainerBinding;
  validation?: DatasetValidationResult;
  trainerAdapter?: TrainerAdapterSpec;
};

export type WizardStatus = {
  enabled: boolean;
  workspaceDir: string;
  datasetDir: string;
  outputDir: string;
  currentState: WizardStage;
  jobs: TrainingJobDescriptor[];
  notes: string[];
};

async function writeJsonAtomic(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  try {
    await replaceFileAtomic(tempPath, filePath);
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {
      // Best effort temp cleanup only; preserve original failure.
    }
    throw error;
  }
}

export async function getWizardStatus(config?: MiyaPluginConfig): Promise<WizardStatus> {
  const resolved = resolveWizardConfig(config);
  await ensureWizardScaffold(resolved.workspaceDir, resolved.datasetDir, resolved.outputDir);
  const jobs = await loadWizardJobs(resolved.outputDir, config);
  return {
    ...resolved,
    currentState: jobs.find((job) => job.status === "running")?.status ?? jobs.find((job) => job.status === "queued")?.status ?? "idle",
    jobs,
    notes: [
      "Wizard persists local training intent under the plugin state directory.",
      "Wizard can now run local staged jobs and persona dataset preparation through the bundled runner.",
      "External LoRA and finetune trainer profiles can now be bound through wizard.trainer or per-job overrides.",
    ],
  };
}

export async function createWizardJob(
  input: Pick<TrainingJobDescriptor, "kind" | "datasetPath" | "outputPath"> & { notes?: string[]; command?: string; args?: string[]; trainer?: WizardTrainerBinding },
  config?: MiyaPluginConfig,
): Promise<{ status: "ok"; job: TrainingJobDescriptor; persisted: string }> {
  const resolved = resolveWizardConfig(config);
  await ensureWizardScaffold(resolved.workspaceDir, resolved.datasetDir, resolved.outputDir);

  const requestedAt = new Date().toISOString();
  const id = `wizard-${requestedAt.replace(/[:.]/g, "-")}`;
  const job: TrainingJobDescriptor = {
    id,
    kind: input.kind,
    datasetPath: input.datasetPath,
    outputPath: input.outputPath,
    status: "queued",
    requestedAt,
    notes: normalizeNotes(input.notes),
    command: input.command?.trim() || undefined,
    args: Array.isArray(input.args) ? input.args.map((value) => String(value)) : undefined,
    trainer: resolveTrainerBinding(input.kind, input.trainer, config),
  };

  const persisted = getWizardJobPath(resolved.outputDir, job.id);
  await writeJsonAtomic(persisted, job);
  return { status: "ok", job, persisted };
}

export async function updateWizardJob(
  id: string,
  patch: Partial<Pick<TrainingJobDescriptor, "status" | "notes">>,
  config?: MiyaPluginConfig,
): Promise<{ status: "ok"; job: TrainingJobDescriptor; persisted: string } | { status: "error"; code: "wizard_job_not_found"; id: string }> {
  const resolved = resolveWizardConfig(config);
  await ensureWizardScaffold(resolved.workspaceDir, resolved.datasetDir, resolved.outputDir);
  const existing = await getWizardJobById(id, config);
  if (!existing) {
    return {
      status: "error",
      code: "wizard_job_not_found",
      id,
    };
  }

  const job: TrainingJobDescriptor = {
    ...existing,
    status: patch.status ?? existing.status,
    notes: patch.notes === undefined ? existing.notes : normalizeNotes(patch.notes),
  };
  const persisted = getWizardJobPath(resolved.outputDir, id);
  await writeJsonAtomic(persisted, job);
  return { status: "ok", job, persisted };
}

export async function getWizardJobById(id: string, config?: MiyaPluginConfig): Promise<TrainingJobDescriptor | null> {
  const resolved = resolveWizardConfig(config);
  await ensureWizardScaffold(resolved.workspaceDir, resolved.datasetDir, resolved.outputDir);
  const persisted = getWizardJobPath(resolved.outputDir, id);
  try {
    const raw = await fs.readFile(persisted, "utf8");
    return JSON.parse(raw) as TrainingJobDescriptor;
  } catch {
    return null;
  }
}

export async function runWizardJob(
  id: string,
  config?: MiyaPluginConfig,
): Promise<
  | { status: "ok"; job: TrainingJobDescriptor; persisted: string }
  | { status: "error"; code: "wizard_job_not_found" | "wizard_job_already_running" | "wizard_validation_failed"; id: string; error?: string; validation?: DatasetValidationResult }
> {
  const resolved = resolveWizardConfig(config);
  await ensureWizardScaffold(resolved.workspaceDir, resolved.datasetDir, resolved.outputDir);
  const job = await getWizardJobById(id, config);
  if (!job) {
    return { status: "error", code: "wizard_job_not_found", id };
  }
  if (job.status === "running") {
    return { status: "error", code: "wizard_job_already_running", id };
  }

  const paths = resolveMiyaPaths(config);
  const runnerPath = path.join(paths.pluginRoot, "worker", "wizard_job_runner.py");
  const persisted = getWizardJobPath(resolved.outputDir, id);
  const logPath = path.join(resolved.outputDir, `${id}.log`);
  const pythonCommand = config?.desktopWorker?.probe?.command?.trim() || "python";
  const trainer = resolveTrainerBinding(job.kind, job.trainer, config);
  const validation = await validateTrainingDataset({
    kind: job.kind,
    datasetPath: job.datasetPath,
    outputPath: job.outputPath,
    trainer,
  }, config);
  if (!validation.ok) {
    const failedJob: TrainingJobDescriptor = {
      ...job,
      status: "failed",
      trainer,
      validation,
      completedAt: new Date().toISOString(),
      notes: normalizeNotes([...(job.notes ?? []), ...validation.errors.map((item) => `validation_failed:${item.code}`)]),
    };
    await fs.writeFile(persisted, JSON.stringify(failedJob, null, 2), "utf8");
    return { status: "error", code: "wizard_validation_failed", id, validation };
  }
  const trainerAdapter = trainer?.command ? resolveTrainerAdapterSpec({
    kind: job.kind,
    datasetPath: job.datasetPath,
    outputPath: job.outputPath,
    trainer,
  }) : undefined;
  const trainerNotes = trainer?.command ? [`trainer_profile:${trainer.profile ?? "custom"}`] : [];
  const preparedJob: TrainingJobDescriptor = {
    ...job,
    trainer,
    validation,
    trainerAdapter,
    logPath,
    notes: normalizeNotes([...(job.notes ?? []), ...trainerNotes, trainerAdapter ? `trainer_adapter:${trainerAdapter.adapterType}` : ""]),
  };
  await fs.writeFile(persisted, JSON.stringify(preparedJob, null, 2), "utf8");
  const child = childProcess.spawn(
    pythonCommand,
    [runnerPath, "--job", persisted, "--log", logPath],
    {
      cwd: paths.pluginRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();

  const estimatedTrainingVramMb = trainerAdapter?.estimatedVramMb ?? estimateTrainingVramMb(job);
  const admission = estimatedTrainingVramMb > 0
    ? acquireVramLane("training", config, { ownerPid: child.pid, estimatedVramMb: estimatedTrainingVramMb })
    : null;
  if (admission && !admission.ok) {
    try {
      process.kill(child.pid);
    } catch {
      // best effort
    }
    const failedJob: TrainingJobDescriptor = {
      ...job,
      status: "failed",
      trainer,
      validation,
      trainerAdapter,
      logPath,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      exitCode: 1,
      notes: normalizeNotes([...(job.notes ?? []), `training_lane_denied:${String((admission as any).code ?? "unknown")}`]),
    };
    await fs.writeFile(persisted, JSON.stringify(failedJob, null, 2), "utf8");
    return { status: "ok", job: failedJob, persisted };
  }

  const updated: TrainingJobDescriptor = {
    ...preparedJob,
    status: "running",
    pid: child.pid,
    vramLeaseId: admission?.lease?.id,
    startedAt: new Date().toISOString(),
    notes: normalizeNotes([...(preparedJob.notes ?? []), "runner_spawned"]),
  };
  await writeJsonAtomic(persisted, updated);
  return { status: "ok", job: updated, persisted };
}

async function ensureWizardScaffold(workspaceDir: string, datasetDir: string, outputDir: string) {
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(datasetDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
}

async function loadWizardJobs(outputDir: string, config?: MiyaPluginConfig): Promise<TrainingJobDescriptor[]> {
  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const jobs: TrainingJobDescriptor[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const jobPath = path.join(outputDir, entry.name);
        const raw = await fs.readFile(jobPath, "utf8");
        const parsed = JSON.parse(raw) as TrainingJobDescriptor;
        if (parsed.id === "example-persona-dataset") {
          continue;
        }
        const reconciled = reconcileWizardJob(parsed, config);
        if (JSON.stringify(parsed) !== JSON.stringify(reconciled)) {
          await fs.writeFile(jobPath, JSON.stringify(reconciled, null, 2), "utf8");
        }
        jobs.push(reconciled);
      } catch {
        continue;
      }
    }
    return jobs.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  } catch {
    return [];
  }
}

function getWizardJobPath(outputDir: string, id: string) {
  return path.join(outputDir, `${id}.json`);
}

function normalizeNotes(notes?: string[]) {
  return Array.isArray(notes) ? notes.map((note) => String(note)).filter(Boolean) : [];
}

function estimateTrainingVramMb(job: TrainingJobDescriptor) {
  if (job.kind === "persona-dataset" && !job.command && !job.trainer?.command) {
    return 0;
  }
  switch (job.kind) {
    case "voice-adapter":
    case "lora-finetune":
      return 8192;
    case "vision-adapter":
    case "full-finetune":
      return 12288;
    case "persona-dataset":
      return 2048;
  }
}

function resolveTrainerBinding(kind: WizardJobKind, inputTrainer: WizardTrainerBinding | undefined, config?: MiyaPluginConfig): WizardTrainerBinding | undefined {
  if (inputTrainer?.command?.trim()) {
    return {
      profile: inputTrainer.profile,
      command: inputTrainer.command.trim(),
      args: Array.isArray(inputTrainer.args) ? inputTrainer.args.map((value) => String(value)) : [],
      cwd: inputTrainer.cwd?.trim() || "",
      env: normalizeEnv(inputTrainer.env),
      artifactGlobs: normalizeStrings(inputTrainer.artifactGlobs),
    };
  }

  const resolved = resolveWizardConfig(config);
  const profile = kind === "lora-finetune" ? resolved.trainer?.lora : kind === "full-finetune" ? resolved.trainer?.finetune : undefined;
  if (!profile?.enabled || !profile.command) {
    return undefined;
  }
  return {
    profile: kind === "lora-finetune" ? "lora" : "finetune",
    command: profile.command,
    args: normalizeStrings(profile.args),
    cwd: profile.cwd || "",
    env: normalizeEnv(profile.env),
    artifactGlobs: normalizeStrings(profile.artifactGlobs),
  };
}

function normalizeStrings(values?: string[]) {
  return Array.isArray(values) ? values.map((value) => String(value)).filter(Boolean) : [];
}

function normalizeEnv(env?: Record<string, string>) {
  if (!env || typeof env !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [String(key), String(value)] as const)
      .filter(([key]) => Boolean(key)),
  );
}

function reconcileWizardJob(job: TrainingJobDescriptor, config?: MiyaPluginConfig): TrainingJobDescriptor {
  const terminalWithLease = Boolean(job.vramLeaseId && (job.status === "complete" || job.status === "failed"));
  if (terminalWithLease) {
    releaseVramLane(job.vramLeaseId, "training", config);
    return {
      ...job,
      vramLeaseId: undefined,
      notes: normalizeNotes([...(job.notes ?? []), "vram_lease_released"]),
    };
  }

  const shouldReleaseLease = Boolean(job.vramLeaseId && job.pid && !processIsAlive(job.pid));
  if (shouldReleaseLease) {
    releaseOwnedVramLeases(job.pid, config);
  }
  if (job.status === "running" && job.pid && !processIsAlive(job.pid)) {
    return {
      ...job,
      status: job.exitCode === 0 ? "complete" : "failed",
      vramLeaseId: undefined,
      completedAt: job.completedAt ?? new Date().toISOString(),
      notes: normalizeNotes([...(job.notes ?? []), "runner_reconciled_after_exit", "vram_lease_released"]),
    };
  }
  if (shouldReleaseLease) {
    return {
      ...job,
      vramLeaseId: undefined,
      notes: normalizeNotes([...(job.notes ?? []), "vram_lease_released"]),
    };
  }
  return job;
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
