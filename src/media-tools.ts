import type { MiyaPluginConfig } from "./config.ts";
import { runVoiceAction } from "./voice-sidecar-client.ts";
import { runImageGenerate } from "./image-sidecar-client.ts";
import { appendEvidenceRecord, createEvidenceRecord } from "./evidence.ts";
import { updateRuntimeState } from "./runtime-state.ts";

function getPluginConfig(api: any): MiyaPluginConfig {
  return (api?.pluginConfig ?? api?.config?.plugins?.entries?.miya?.config ?? {}) as MiyaPluginConfig;
}

function toJsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function getArtifactPath(payload: any) {
  return payload?.artifact?.audioPath
    || payload?.artifact?.imagePath
    || payload?.artifact?.transcriptJson
    || payload?.artifact?.vadJson
    || payload?.artifact?.matchJson
    || undefined;
}

export async function recordVoiceExecution(action: string, payload: any, config: MiyaPluginConfig) {
  const ok = payload?.status === "ok";
  const artifactPath = getArtifactPath(payload);
  await appendEvidenceRecord(createEvidenceRecord({
    action: action === "transcribe" ? "inspect" : action === "speaker_identify" ? "capabilities_probe" : "ping",
    result: ok ? "ok" : payload?.status === "unavailable" ? "blocked" : "failed",
    reason: String(payload?.code ?? payload?.reason ?? payload?.status ?? "unknown"),
    target: `voice:${action}`,
    metadata: {
      action,
      code: payload?.code,
      artifactPath,
      admission: payload?.admission,
    },
  }), config);
  await updateRuntimeState({
    voiceProbe: {
      updatedAt: new Date().toISOString(),
      ok,
      action,
      code: typeof payload?.code === "string" ? payload.code : undefined,
      artifactPath,
      payload,
      error: ok ? undefined : typeof payload?.reason === "string" ? payload.reason : undefined,
    },
  }, config);
}

export async function recordImageExecution(payload: any, config: MiyaPluginConfig) {
  const ok = payload?.status === "ok";
  const artifactPath = getArtifactPath(payload);
  await appendEvidenceRecord(createEvidenceRecord({
    action: "capabilities_probe",
    result: ok ? "ok" : payload?.status === "unavailable" ? "blocked" : "failed",
    reason: String(payload?.code ?? payload?.reason ?? payload?.status ?? "unknown"),
    target: "image:generate",
    metadata: {
      code: payload?.code,
      artifactPath,
      admission: payload?.admission,
      selectedModel: payload?.selectedModel,
    },
  }), config);
  await updateRuntimeState({
    imageProbe: {
      updatedAt: new Date().toISOString(),
      ok,
      code: typeof payload?.code === "string" ? payload.code : undefined,
      artifactPath,
      payload,
      error: ok ? undefined : typeof payload?.reason === "string" ? payload.reason : undefined,
    },
  }, config);
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
      await recordVoiceExecution("transcribe", payload, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_voice_vad",
    description: "Run local VAD against an audio file through Miya's voice runtime contract.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        audioPath: { type: "string" },
      },
    },
    async execute(_id: string, params: { audioPath?: string }) {
      const payload = await runVoiceAction("vad", { audioPath: params.audioPath ?? "" }, config);
      await recordVoiceExecution("vad", payload, config);
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
        voiceId: params.voiceId ?? "Vivian",
      }, config);
      await recordVoiceExecution("synthesize", payload, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_voice_speaker_identify",
    description: "Identify speaker similarity through Miya's local voice runtime contract, preferring embedding-based verification when available.",
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
      await recordVoiceExecution("speaker_identify", payload, config);
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
      await recordImageExecution(payload, config);
      return {
        content: [{ type: "text", text: toJsonText(payload) }],
        structuredContent: payload,
      };
    },
  });
}
