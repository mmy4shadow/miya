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
      "Voice stages are config placeholders until an external runtime or worker is attached.",
      "Only asset mapping is implemented in-plugin right now; no ASR/TTS/VAD execution is claimed.",
    ],
  };
}
