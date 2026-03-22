import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveMemoryLiteConfig, type MiyaPluginConfig } from "./config.ts";

export type MemoryLiteStatus = {
  enabled: boolean;
  provider: "core-memory" | "local-embedding" | "none";
  collection: string;
  maxRecallItems: number;
  fallbackStrategy: "identity-only" | "core-only";
  runtimeMode: "pass-through" | "placeholder" | "sidecar-index" | "local-recall";
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
    runtimeMode: resolved.provider === "local-embedding" ? "local-recall" : resolved.provider === "core-memory" ? "pass-through" : "sidecar-index",
    cacheFile,
    cacheReady,
    notes: [
      "Memory-lite does not replace OpenClaw core memory.",
      resolved.provider === "local-embedding"
        ? "Local embedding assets now back Miya-side recall from the local memory-lite index."
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
