import type { MiyaPluginConfig } from "./config.ts";
import { runVoiceAction } from "./voice-sidecar-client.ts";
import { runImageGenerate } from "./image-sidecar-client.ts";

function getPluginConfig(api: any): MiyaPluginConfig {
  return (api?.pluginConfig ?? api?.config?.plugins?.entries?.miya?.config ?? {}) as MiyaPluginConfig;
}

function toJsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function registerMediaTools(api: any) {
  const config = getPluginConfig(api);

  api.registerTool({
    name: "miya_voice_transcribe",
    description: "Transcribe audio through Miya's local voice runtime contract.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        audioPath: { type: "string" },
      },
    },
    async execute(_id: string, params: { audioPath?: string }) {
      const payload = await runVoiceAction("transcribe", { audioPath: params.audioPath ?? "" }, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_voice_synthesize",
    description: "Synthesize audio through Miya's local voice runtime contract.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string" },
        voiceId: { type: "string" },
      },
    },
    async execute(_id: string, params: { text?: string; voiceId?: string }) {
      const payload = await runVoiceAction("synthesize", {
        text: params.text ?? "",
        voiceId: params.voiceId ?? "miya-default",
      }, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_voice_speaker_identify",
    description: "Identify speaker similarity through Miya's local voice runtime contract.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enrollAudioPath: { type: "string" },
        inputAudioPath: { type: "string" },
      },
    },
    async execute(_id: string, params: { enrollAudioPath?: string; inputAudioPath?: string }) {
      const payload = await runVoiceAction("speaker_identify", {
        enrollAudioPath: params.enrollAudioPath ?? "",
        inputAudioPath: params.inputAudioPath ?? "",
      }, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_image_generate",
    description: "Generate an image through Miya's local image runtime contract.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string" },
        negativePrompt: { type: "string" },
      },
    },
    async execute(_id: string, params: { prompt?: string; negativePrompt?: string }) {
      const payload = await runImageGenerate({
        prompt: params.prompt ?? "",
        negativePrompt: params.negativePrompt ?? "",
      }, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });
}
