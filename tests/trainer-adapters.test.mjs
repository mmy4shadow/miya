import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/trainer-adapters.ts")).href;
const { resolveTrainerAdapterSpec } = await import(moduleUrl);

test("resolveTrainerAdapterSpec translates a generic command trainer profile", () => {
  const result = resolveTrainerAdapterSpec({
    kind: "lora-finetune",
    datasetPath: "F:/dataset",
    outputPath: "F:/output",
    trainer: {
      profile: "lora",
      command: "python",
      args: ["train.py", "--dataset", "{datasetPath}", "--output", "{outputPath}"],
      artifactGlobs: ["**/*.safetensors"],
    },
  });

  assert.equal(result.adapterType, "generic-command");
  assert.equal(result.resolvedCommand, "python");
  assert.deepEqual(result.resolvedArgs, ["train.py", "--dataset", "F:/dataset", "--output", "F:/output"]);
  assert.deepEqual(result.expectedArtifacts, ["**/*.safetensors"]);
});

test("resolveTrainerAdapterSpec translates python script shorthand into a normalized command", () => {
  const result = resolveTrainerAdapterSpec({
    kind: "full-finetune",
    datasetPath: "F:/dataset",
    outputPath: "F:/output",
    trainer: {
      profile: "finetune",
      command: "trainer.py",
      args: ["--data", "{datasetPath}"],
    },
  });

  assert.equal(result.adapterType, "python-script");
  assert.equal(result.resolvedCommand, "python");
  assert.deepEqual(result.resolvedArgs, ["trainer.py", "--data", "F:/dataset"]);
});
