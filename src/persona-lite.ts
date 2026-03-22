import { resolvePersonaLiteConfig, type MiyaPluginConfig } from "./config.ts";

export type PersonaLiteStatus = {
  enabled: boolean;
  profileName: string;
  styleTags: string[];
  referenceImageDir: string;
  injectionMode: "static" | "core-system" | "none";
  fallbackStrategy: "static-summary" | "identity-only";
  runtimeMode: "static-only" | "placeholder" | "dynamic-before-prompt-build";
  notes: string[];
};

export function getPersonaLiteStatus(config?: MiyaPluginConfig): PersonaLiteStatus {
  const resolved = resolvePersonaLiteConfig(config);
  return {
    ...resolved,
    runtimeMode: resolved.injectionMode === "none" ? "placeholder" : "dynamic-before-prompt-build",
    notes: [
      "Persona-lite now injects a structured persona block during before_prompt_build.",
      "If dynamic injection is unavailable, fallback is a static profile summary plus reference image directory.",
    ],
  };
}
