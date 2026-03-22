import { promises as fs } from "node:fs";
import path from "node:path";

export type DatasetValidationInput = {
  kind: string;
  datasetPath: string;
  outputPath: string;
  trainer?: { command?: string };
};

export type DatasetValidationResult = {
  ok: boolean;
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  stats: {
    fileCount: number;
    totalBytes: number;
  };
  normalizedDataset: {
    root: string;
    files: string[];
    outputPath: string;
  };
};

const SUPPORTED_SUFFIXES = new Set([".jsonl", ".json", ".txt", ".md", ".wav", ".png", ".jpg", ".jpeg"]);

async function walkFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(target));
    } else if (entry.isFile() && SUPPORTED_SUFFIXES.has(path.extname(entry.name).toLowerCase())) {
      files.push(target);
    }
  }
  return files;
}

export async function validateTrainingDataset(input: DatasetValidationInput, _config: unknown): Promise<DatasetValidationResult> {
  const errors: Array<{ code: string; message: string }> = [];
  const warnings: Array<{ code: string; message: string }> = [];
  let files: string[] = [];
  let totalBytes = 0;

  try {
    const stat = await fs.stat(input.datasetPath);
    if (!stat.isDirectory()) {
      errors.push({ code: "dataset_not_directory", message: `dataset path is not a directory: ${input.datasetPath}` });
    } else {
      files = await walkFiles(input.datasetPath);
    }
  } catch {
    errors.push({ code: "dataset_missing", message: `dataset path not found: ${input.datasetPath}` });
  }

  if (!errors.length && files.length === 0) {
    errors.push({ code: "dataset_empty", message: "dataset has no supported files" });
  }

  for (const file of files) {
    try {
      totalBytes += (await fs.stat(file)).size;
    } catch {
      warnings.push({ code: "file_stat_failed", message: `failed to stat ${file}` });
    }
  }

  try {
    await fs.mkdir(input.outputPath, { recursive: true });
    const probe = path.join(input.outputPath, ".miya-write-test");
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
  } catch {
    errors.push({ code: "output_not_writable", message: `output path is not writable: ${input.outputPath}` });
  }

  if ((input.kind === "lora-finetune" || input.kind === "full-finetune") && !input.trainer?.command) {
    errors.push({ code: "trainer_missing", message: `trainer command is required for ${input.kind}` });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      fileCount: files.length,
      totalBytes,
    },
    normalizedDataset: {
      root: input.datasetPath,
      files,
      outputPath: input.outputPath,
    },
  };
}
