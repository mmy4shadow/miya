import { promises as fs } from "node:fs";
import path from "node:path";

export const DEFAULT_STATE_ROOT = "F:\\openclaw";
export const DEFAULT_PLUGIN_ROOT = "F:\\openclaw\\miya";
export const DEFAULT_MODEL_ROOT = path.join(DEFAULT_PLUGIN_ROOT, "model");

export type ModelBucket = {
  name: string;
  path: string;
  exists: boolean;
  children: string[];
};

export type ModelAssetRecord = {
  key: string;
  capability: "persona" | "memory" | "tts" | "speaker-id" | "vision" | "image";
  path: string;
  exists: boolean;
  notes: string;
};

export function resolveMiyaPaths(config?: Record<string, unknown>) {
  const stateRoot = typeof config?.stateRoot === "string" && config.stateRoot.trim()
    ? config.stateRoot
    : DEFAULT_STATE_ROOT;
  const pluginRoot = typeof config?.pluginRoot === "string" && config.pluginRoot.trim()
    ? config.pluginRoot
    : DEFAULT_PLUGIN_ROOT;
  const modelRoot = typeof config?.modelRoot === "string" && config.modelRoot.trim()
    ? config.modelRoot
    : DEFAULT_MODEL_ROOT;

  return { stateRoot, pluginRoot, modelRoot };
}

async function listChildrenSafe(target: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function existsDirectory(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function getModelBuckets(modelRoot = DEFAULT_MODEL_ROOT): Promise<ModelBucket[]> {
  const bucketNames = ["audio", "image", "memory", "speaker_id", "vision"];

  return Promise.all(
    bucketNames.map(async (name) => {
      const bucketPath = path.join(modelRoot, name);
      try {
        const stat = await fs.stat(bucketPath);
        return {
          name,
          path: bucketPath,
          exists: stat.isDirectory(),
          children: stat.isDirectory() ? await listChildrenSafe(bucketPath) : [],
        } satisfies ModelBucket;
      } catch {
        return {
          name,
          path: bucketPath,
          exists: false,
          children: [],
        } satisfies ModelBucket;
      }
    }),
  );
}

export async function getModelAssetMap(modelRoot = DEFAULT_MODEL_ROOT): Promise<ModelAssetRecord[]> {
  const assets: Omit<ModelAssetRecord, "exists">[] = [
    {
      key: "persona.referenceImages",
      capability: "persona",
      path: path.join(modelRoot, "image", "long_term"),
      notes: "Reference imagery for persona-lite prompts and future image conditioning.",
    },
    {
      key: "memory.embedding",
      capability: "memory",
      path: path.join(modelRoot, "memory", "qwen3_embedding_0_6b"),
      notes: "Embedding asset for later memory-lite recall experiments.",
    },
    {
      key: "voice.tts",
      capability: "tts",
      path: path.join(modelRoot, "audio", "qwen3_tts_12hz_1_7b_customvoice"),
      notes: "Candidate local TTS asset; external runtime wiring still required.",
    },
    {
      key: "voice.speakerId",
      capability: "speaker-id",
      path: path.join(modelRoot, "speaker_id", "eres2net"),
      notes: "Speaker identification asset for later voice routing.",
    },
    {
      key: "vision.primary",
      capability: "vision",
      path: path.join(modelRoot, "vision", "qwen3vl_4b_instruct_q4_k_m"),
      notes: "Lightweight local vision asset for later screenshot understanding.",
    },
    {
      key: "image.fast",
      capability: "image",
      path: path.join(modelRoot, "image", "flux_1_schnell"),
      notes: "Fast image generation candidate; not activated by plugin yet.",
    },
  ];

  return Promise.all(assets.map(async (asset) => ({ ...asset, exists: await existsDirectory(asset.path) })));
}
