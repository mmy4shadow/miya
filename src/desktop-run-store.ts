import { promises as fs } from "node:fs";
import path from "node:path";
import type { MiyaPluginConfig } from "./config.ts";
import { resolveMiyaPaths, DEFAULT_PLUGIN_ROOT } from "./paths.ts";

export function createDesktopRunId(now = new Date()) {
  return `desktop-run-${now.toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
}

export function getDesktopRunDir(config?: MiyaPluginConfig) {
  const paths = resolveMiyaPaths(config);
  return path.join(paths.pluginRoot || DEFAULT_PLUGIN_ROOT, "state", "desktop-runs");
}

export async function writeDesktopRunArtifact(
  runId: string,
  payload: Record<string, unknown>,
  config?: MiyaPluginConfig,
) {
  const runDir = getDesktopRunDir(config);
  const runFile = path.join(runDir, `${runId}.json`);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(runFile, JSON.stringify(payload, null, 2), "utf8");
  return runFile;
}
