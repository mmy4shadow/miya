import { resolvePersonaLiteConfig, type MiyaPluginConfig } from "./config.ts";
import type { MemoryLiteRecallResult } from "./memory-lite-runtime.ts";

export type PersonaLiteRuntimeResult = {
  enabled: boolean;
  block: string;
  debug: {
    profileName: string;
    styleTags: string[];
    recalledItems: number;
  };
};

export function buildPersonaLiteBlock(
  config?: MiyaPluginConfig,
  recall?: Pick<MemoryLiteRecallResult, "items">,
): PersonaLiteRuntimeResult {
  const resolved = resolvePersonaLiteConfig(config);
  const recalledItems = recall?.items ?? [];
  if (!resolved.enabled || resolved.injectionMode === "none") {
    return {
      enabled: false,
      block: "",
      debug: {
        profileName: resolved.profileName,
        styleTags: resolved.styleTags,
        recalledItems: recalledItems.length,
      },
    };
  }

  const lines = [
    "[Persona block]",
    "Identity:",
    `- Name: Miya`,
    `- Profile: ${resolved.profileName}`,
    "Tone:",
    `- ${resolved.styleTags.join(" / ")}`,
    "Boundaries:",
    "- Tool reality first. Do not invent local machine state.",
    "- Respect runtime guard instructions over style.",
    "Current stable preferences:",
    `- Reference images: ${resolved.referenceImageDir}`,
    `- Fallback strategy: ${resolved.fallbackStrategy}`,
    "Relevant recalled context:",
  ];

  if (recalledItems.length) {
    for (const item of recalledItems) {
      lines.push(`- ${item.content}`);
    }
  } else {
    lines.push("- None");
  }

  return {
    enabled: true,
    block: lines.join("\n"),
    debug: {
      profileName: resolved.profileName,
      styleTags: resolved.styleTags,
      recalledItems: recalledItems.length,
    },
  };
}
