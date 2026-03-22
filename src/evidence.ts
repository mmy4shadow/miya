import { promises as fs } from "node:fs";
import path from "node:path";
import type { MiyaPluginConfig } from "./config.ts";
import { resolveMiyaPaths, DEFAULT_PLUGIN_ROOT } from "./paths.ts";

export type WorkerActionName =
  | "capture"
  | "inspect"
  | "click"
  | "click_selector"
  | "health_probe"
  | "capabilities_probe"
  | "ping"
  | "dispatcher"
  | "workflow_hook"
  | "continuation_wake"
  | "desktop_run"
  | "wizard";

export type WorkerEvidenceRecord = {
  time: string;
  action: WorkerActionName;
  result: "ok" | "blocked" | "failed";
  reason: string;
  selector?: {
    name?: string;
    controlType?: string;
    automationId?: string;
  };
  target?: string;
  metadata?: Record<string, unknown>;
};

function getEvidenceFile(config?: MiyaPluginConfig) {
  const paths = resolveMiyaPaths(config);
  return path.join(paths.pluginRoot || DEFAULT_PLUGIN_ROOT, "state", "evidence.jsonl");
}

export function createEvidenceRecord(input: Omit<WorkerEvidenceRecord, "time">): WorkerEvidenceRecord {
  return {
    time: new Date().toISOString(),
    ...input,
  };
}

export async function appendEvidenceRecord(record: WorkerEvidenceRecord, config?: MiyaPluginConfig): Promise<void> {
  const evidenceFile = getEvidenceFile(config);
  await fs.mkdir(path.dirname(evidenceFile), { recursive: true });
  await fs.appendFile(evidenceFile, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readEvidenceTail(limit = 20, config?: MiyaPluginConfig): Promise<WorkerEvidenceRecord[]> {
  const evidenceFile = getEvidenceFile(config);
  try {
    const raw = await fs.readFile(evidenceFile, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-Math.max(1, limit))
      .map((line) => JSON.parse(line) as WorkerEvidenceRecord);
  } catch {
    return [];
  }
}
