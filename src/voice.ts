import { resolveVoiceConfig, type MiyaPluginConfig } from "./config.ts";
import { getModelAssetMap } from "./paths.ts";

export type VoiceStageStatus = {
  enabled: boolean;
  provider: string;
  modelPath: string;
  sampleRate: number;
  mappedAsset?: string;
};

export type VoiceStatus = {
  enabled: boolean;
  vad: VoiceStageStatus;
  asr: VoiceStageStatus;
  tts: VoiceStageStatus & { voiceId?: string };
  speakerId: VoiceStageStatus;
  notes: string[];
};

export async function getVoiceStatus(config?: MiyaPluginConfig): Promise<VoiceStatus> {
  const resolved = resolveVoiceConfig(config);
  const assets = await getModelAssetMap(config?.modelRoot);
  const ttsAsset = assets.find((asset) => asset.key === "voice.tts" && asset.exists);
  const speakerIdAsset = assets.find((asset) => asset.key === "voice.speakerId" && asset.exists);

  return {
    enabled: resolved.enabled,
    vad: resolved.vad,
    asr: resolved.asr,
    tts: {
      ...resolved.tts,
      mappedAsset: resolved.tts.modelPath || ttsAsset?.path || "",
    },
    speakerId: {
      ...resolved.speakerId,
      mappedAsset: resolved.speakerId.modelPath || speakerIdAsset?.path || "",
    },
    notes: [
      "ASR, TTS, speaker identify, and VAD are all wired through the local voice sidecar contract.",
      "VAD now prefers a local Silero neural model on CUDA and falls back to energy-based segmentation only when that stack is unavailable.",
      "Speaker identify prefers embedding-grade verification when the optional local speaker stack is present and falls back only when that stack is unavailable.",
    ],
  };
}
