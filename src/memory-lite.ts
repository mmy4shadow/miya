import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveMemoryLiteConfig, type MiyaPluginConfig } from "./config.ts";

export type MemoryLiteStatus = {
  enabled: boolean;
  provider: "core-memory" | "local-embedding" | "none";
  collection: string;
  maxRecallItems: number;
  fallbackStrategy: "identity-only" | "core-only";
  runtimeMode: "pass-through" | "placeholder" | "sidecar-index";
  notes: string[];
  cacheFile: string;
  cacheReady: boolean;
};

export async function getMemoryLiteStatus(config?: MiyaPluginConfig): Promise<MemoryLiteStatus> {
  const resolved = resolveMemoryLiteConfig(config);
  const cacheFile = path.join(config?.pluginRoot?.trim() || "F:\\openclaw\\miya", "state", "memory-lite", "index.json");
  const cacheReady = await ensureMemoryLiteCache(cacheFile, resolved.collection);
  return {
    ...resolved,
    runtimeMode: resolved.provider === "core-memory" ? "pass-through" : "sidecar-index",
    cacheFile,
    cacheReady,
    notes: [
      "Memory-lite does not replace OpenClaw core memory.",
      resolved.provider === "local-embedding"
        ? "Local embedding assets are documented; current runtime keeps a sidecar cache scaffold ready for future recall wiring."
        : "Current runtime reuses core memory while maintaining a local sidecar cache scaffold for Miya-specific recall metadata.",
    ],
  };
}

async function ensureMemoryLiteCache(cacheFile: string, collection: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    try {
      await fs.access(cacheFile);
    } catch {
      await fs.writeFile(cacheFile, JSON.stringify({
        collection,
        createdAt: new Date().toISOString(),
        items: [],
      }, null, 2), "utf8");
    }
    return true;
  } catch {
    return false;
  }
}
