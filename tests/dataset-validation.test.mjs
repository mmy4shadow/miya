import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/dataset-validation.ts")).href;
const { validateTrainingDataset } = await import(moduleUrl);

test("validateTrainingDataset rejects missing dataset path", async () => {
  const result = await validateTrainingDataset({
    kind: "lora-finetune",
    datasetPath: "F:/missing/path",
    outputPath: "F:/output",
  }, {});

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "dataset_missing"));
});

test("validateTrainingDataset accepts a minimal persona dataset and reports stats", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-dataset-"));
  try {
    const datasetDir = path.join(root, "dataset");
    const outputDir = path.join(root, "output");
    fs.mkdirSync(datasetDir, { recursive: true });
    fs.writeFileSync(path.join(datasetDir, "sample.txt"), "hello", "utf8");

    const result = await validateTrainingDataset({
      kind: "persona-dataset",
      datasetPath: datasetDir,
      outputPath: outputDir,
    }, {});

    assert.equal(result.ok, true);
    assert.equal(result.stats.fileCount, 1);
    assert.equal(result.normalizedDataset.files.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
