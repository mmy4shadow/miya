import path from "node:path";

type TrainerBinding = {
  profile?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  artifactGlobs?: string[];
};

type TrainerInput = {
  kind: string;
  datasetPath: string;
  outputPath: string;
  trainer?: TrainerBinding;
};

export type TrainerAdapterSpec = {
  adapterType: "generic-command" | "python-script";
  trainerProfile?: string;
  resolvedCommand: string;
  resolvedArgs: string[];
  resolvedEnv: Record<string, string>;
  resolvedCwd: string;
  expectedArtifacts: string[];
  estimatedVramMb: number;
};

function replacePlaceholders(value: string, input: TrainerInput) {
  return String(value)
    .replaceAll("{datasetPath}", input.datasetPath)
    .replaceAll("{outputPath}", input.outputPath)
    .replaceAll("{kind}", input.kind);
}

function estimateVramMb(kind: string) {
  switch (kind) {
    case "lora-finetune":
      return 8192;
    case "full-finetune":
      return 12288;
    case "voice-adapter":
      return 8192;
    case "vision-adapter":
      return 12288;
    default:
      return 2048;
  }
}

export function resolveTrainerAdapterSpec(input: TrainerInput): TrainerAdapterSpec {
  const trainer = input.trainer ?? {};
  const rawCommand = String(trainer.command ?? "").trim();
  const artifactGlobs = Array.isArray(trainer.artifactGlobs) && trainer.artifactGlobs.length
    ? trainer.artifactGlobs.map((value) => String(value))
    : ["**/*.safetensors", "**/*.bin", "**/*.json"];
  const env = Object.fromEntries(
    Object.entries(trainer.env ?? {}).map(([key, value]) => [String(key), replacePlaceholders(String(value), input)]),
  );

  if (rawCommand.toLowerCase().endsWith(".py")) {
    return {
      adapterType: "python-script",
      trainerProfile: trainer.profile,
      resolvedCommand: "python",
      resolvedArgs: [replacePlaceholders(rawCommand, input), ...(trainer.args ?? []).map((arg) => replacePlaceholders(String(arg), input))],
      resolvedEnv: env,
      resolvedCwd: replacePlaceholders(trainer.cwd || input.outputPath, input),
      expectedArtifacts: artifactGlobs,
      estimatedVramMb: estimateVramMb(input.kind),
    };
  }

  return {
    adapterType: "generic-command",
    trainerProfile: trainer.profile,
    resolvedCommand: replacePlaceholders(rawCommand, input),
    resolvedArgs: (trainer.args ?? []).map((arg) => replacePlaceholders(String(arg), input)),
    resolvedEnv: env,
    resolvedCwd: replacePlaceholders(trainer.cwd || input.outputPath, input),
    expectedArtifacts: artifactGlobs,
    estimatedVramMb: estimateVramMb(input.kind),
  };
}
