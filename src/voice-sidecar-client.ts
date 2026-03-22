import fs from "node:fs";
import path from "node:path";
import type { MiyaPluginConfig } from "./config.ts";
import { resolveVoiceConfig } from "./config.ts";
import { resolveMiyaPaths } from "./paths.ts";
import { runJsonSidecar } from "./sidecar-client.ts";
import { acquireVramLane, releaseVramLane } from "./vram-scheduler.ts";

type VoiceAction = "transcribe" | "vad" | "synthesize" | "speaker_identify";

function estimateVoiceActionVramMb(action: VoiceAction) {
  switch (action) {
    case "vad":
      return 512;
    case "speaker_identify":
      return 1536;
    case "transcribe":
      return 3072;
    case "synthesize":
      return 4096;
  }
}

function stageExists(modelPath: string) {
  return Boolean(modelPath) && fs.existsSync(modelPath);
}

function detectTtsAsset(modelPath: string) {
  return stageExists(modelPath) && (
    fs.existsSync(path.join(modelPath, "config.json"))
    || fs.existsSync(path.join(modelPath, "README.md"))
  );
}

function detectSpeakerAsset(modelPath: string) {
  return stageExists(modelPath) && (
    fs.existsSync(path.join(modelPath, "eres2net_large_model.ckpt"))
    || fs.existsSync(path.join(modelPath, "README.md"))
  );
}

export async function runVoiceAction(
  action: VoiceAction,
  input: Record<string, unknown>,
  config?: MiyaPluginConfig,
) {
  const voice = resolveVoiceConfig(config);
  const ttsPath = voice.tts.modelPath || "";
  const asrPath = voice.asr.modelPath || "";
  const speakerPath = voice.speakerId.modelPath || "";

  const assets = {
    tts: {
      path: ttsPath,
      exists: detectTtsAsset(ttsPath),
    },
    asr: {
      path: asrPath,
      exists: stageExists(asrPath),
    },
    speakerId: {
      path: speakerPath,
      exists: detectSpeakerAsset(speakerPath),
    },
  };

  const leaseResult = acquireVramLane("voice", config, { estimatedVramMb: estimateVoiceActionVramMb(action) });
  if (!leaseResult.ok) {
    return {
      status: "unavailable",
      code: "voice_lane_busy",
      reason: String(leaseResult.reason),
      action,
      assets,
      admission: leaseResult,
    };
  }

  const paths = resolveMiyaPaths(config);
  const sidecarPath = path.join(paths.pluginRoot, "worker", "voice_sidecar.py");
  const artifactRoot = path.join(paths.pluginRoot, "state", "voice");

  try {
    if (!voice.enabled) {
      return {
        status: "unavailable",
        code: "voice_runtime_unavailable",
        reason: "voice runtime disabled",
        action,
        assets,
        admission: leaseResult,
      };
    }

    if (fs.existsSync(sidecarPath)) {
      const payload = await runJsonSidecar(
        config?.desktopWorker?.probe?.command?.trim() || "python",
        [sidecarPath],
        {
          action,
          input,
          voice,
          assets,
          paths: {
            pluginRoot: paths.pluginRoot,
            stateRoot: paths.stateRoot,
            artifactRoot,
          },
        },
        90000,
      );
      return {
        ...payload,
        admission: leaseResult,
      };
    }

    return {
      status: "unavailable",
      code: "voice_runtime_unavailable",
      reason: "voice sidecar is not installed",
      action,
      assets,
      admission: leaseResult,
    };
  } finally {
    releaseVramLane(leaseResult.lease?.id, "voice", config);
  }
}
