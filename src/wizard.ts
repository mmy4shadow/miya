import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveWizardConfig, type MiyaPluginConfig } from "./config.ts";

export type WizardStage = "idle" | "collecting" | "preparing" | "queued" | "running" | "complete" | "failed";

export type TrainingJobDescriptor = {
  id: string;
  kind: "persona-dataset" | "voice-adapter" | "vision-adapter";
  datasetPath: string;
  outputPath: string;
  status: WizardStage;
  requestedAt: string;
  notes?: string[];
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

export async function getWizardStatus(config?: MiyaPluginConfig): Promise<WizardStatus> {
  const resolved = resolveWizardConfig(config);
  await ensureWizardScaffold(resolved.workspaceDir, resolved.datasetDir, resolved.outputDir);
  const jobs = await loadWizardJobs(resolved.outputDir);
  return {
    ...resolved,
    currentState: jobs.find((job) => job.status === "running")?.status ?? jobs.find((job) => job.status === "queued")?.status ?? "idle",
    jobs,
    notes: [
      "Wizard persists local training intent under the plugin state directory.",
      "It still does not launch finetunes automatically; this is a local job ledger / staging layer.",
    ],
  };
}

async function ensureWizardScaffold(workspaceDir: string, datasetDir: string, outputDir: string) {
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(datasetDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const exampleJobPath = path.join(outputDir, "example-persona-dataset.json");
  try {
    await fs.access(exampleJobPath);
  } catch {
    const exampleJob: TrainingJobDescriptor = {
      id: "example-persona-dataset",
      kind: "persona-dataset",
      datasetPath: datasetDir,
      outputPath: outputDir,
      status: "queued",
      requestedAt: new Date(0).toISOString(),
      notes: ["Example staged job. Replace with real collected data later."],
    };
    await fs.writeFile(exampleJobPath, JSON.stringify(exampleJob, null, 2), "utf8");
  }
}

async function loadWizardJobs(outputDir: string): Promise<TrainingJobDescriptor[]> {
  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const jobs: TrainingJobDescriptor[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(outputDir, entry.name), "utf8");
        jobs.push(JSON.parse(raw) as TrainingJobDescriptor);
      } catch {
        continue;
      }
    }
    return jobs.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  } catch {
    return [];
  }
}
