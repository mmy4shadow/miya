import fs from "node:fs";
import path from "node:path";
import type { MiyaPluginConfig } from "./config.ts";
import { resolveImageRuntimeConfig } from "./config.ts";
import { resolveMiyaPaths } from "./paths.ts";
import { runJsonSidecar } from "./sidecar-client.ts";
import { acquireVramLane, releaseVramLane } from "./vram-scheduler.ts";

function imageModelInfo(config?: MiyaPluginConfig) {
  const modelRoot = config?.modelRoot?.trim() || "F:\\openclaw\\miya\\model";
  const fastPath = path.join(modelRoot, "image", "flux_1_schnell");
  const balancedPath = path.join(modelRoot, "image", "flux_2_klein_4b_apache2");
  return {
    fast: {
      path: fastPath,
      exists: fs.existsSync(path.join(fastPath, "model_index.json")),
    },
    balanced: {
      path: balancedPath,
      exists: fs.existsSync(path.join(balancedPath, "model_index.json")),
    },
  };
}

export async function runImageGenerate(
  input: Record<string, unknown>,
  config?: MiyaPluginConfig,
) {
  const models = imageModelInfo(config);
  const leaseResult = acquireVramLane("image", config);
  if (!leaseResult.ok) {
    return {
      status: "unavailable",
      code: "image_lane_busy",
      reason: String(leaseResult.reason),
      lane: "image",
      models,
      admission: leaseResult,
      request: input,
    };
  }

  try {
    const imageConfig = resolveImageRuntimeConfig(config);
    const resolvedPaths = resolveMiyaPaths(config);
    const sidecarPath = imageConfig.sidecarPath || path.join(resolvedPaths.pluginRoot, "worker", "image_sidecar.py");
    if (imageConfig.enabled && fs.existsSync(sidecarPath)) {
      const payload = await runJsonSidecar(
        imageConfig.pythonCommand,
        [sidecarPath],
        {
          input,
          models,
          imageConfig,
          paths: {
            pluginRoot: resolvedPaths.pluginRoot,
            stateRoot: resolvedPaths.stateRoot,
            artifactRoot: path.join(resolvedPaths.pluginRoot, "state", "image"),
          },
        },
        imageConfig.timeoutMs,
      );
      return {
        ...payload,
        admission: leaseResult,
      };
    }

    return {
      status: "unavailable",
      code: "image_runtime_unavailable",
      reason: models.fast.exists || models.balanced.exists
        ? "image model paths exist but local diffusers executor is not attached yet"
        : "image model assets are missing",
      lane: "image",
      models,
      admission: leaseResult,
      request: input,
    };
  } finally {
    releaseVramLane(leaseResult.lease?.id, "image", config);
  }
}
