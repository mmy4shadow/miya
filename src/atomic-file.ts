import fs from "node:fs";
import { promises as fsp } from "node:fs";

const RETRYABLE_REPLACE_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const REPLACE_RETRY_DELAYS_MS = [10, 25, 50];

function isRetryableReplaceError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && RETRYABLE_REPLACE_CODES.has(code);
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(filePath: string) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pathExistsSync(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function replaceFileAtomic(tempPath: string, targetPath: string) {
  let lastError: unknown;
  for (const retryDelayMs of [0, ...REPLACE_RETRY_DELAYS_MS]) {
    if (retryDelayMs > 0) {
      await delay(retryDelayMs);
    }
    try {
      await fsp.rename(tempPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableReplaceError(error)) {
        break;
      }
    }
  }

  if (isRetryableReplaceError(lastError) && await pathExists(targetPath)) {
    await fsp.copyFile(tempPath, targetPath);
    await fsp.rm(tempPath, { force: true });
    return;
  }
  throw lastError;
}

export function replaceFileAtomicSync(tempPath: string, targetPath: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= REPLACE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      fs.renameSync(tempPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableReplaceError(error)) {
        break;
      }
    }
  }

  if (isRetryableReplaceError(lastError) && pathExistsSync(targetPath)) {
    fs.copyFileSync(tempPath, targetPath);
    fs.rmSync(tempPath, { force: true });
    return;
  }
  throw lastError;
}
