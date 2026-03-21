import { resolvePersonaLiteConfig, type MiyaPluginConfig } from "./config.ts";

export type PersonaLiteStatus = {
  enabled: boolean;
  profileName: string;
  styleTags: string[];
  referenceImageDir: string;
  injectionMode: "static" | "core-system" | "none";
  fallbackStrategy: "static-summary" | "identity-only";
  runtimeMode: "static-only" | "placeholder";
  notes: string[];
};

export function getPersonaLiteStatus(config?: MiyaPluginConfig): PersonaLiteStatus {
  const resolved = resolvePersonaLiteConfig(config);
  return {
    ...resolved,
    runtimeMode: resolved.injectionMode === "static" ? "static-only" : "placeholder",
    notes: [
      "Persona-lite currently documents tone and assets rather than mutating unsupported runtime prompts.",
      "If dynamic injection is unavailable, fallback is a static profile summary plus reference image directory.",
    ],
  };
}
