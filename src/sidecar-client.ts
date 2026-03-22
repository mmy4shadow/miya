import { spawn } from "node:child_process";

function extractJsonPayload(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "{}";
  }

  const candidates = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const candidate of candidates) {
    if ((candidate.startsWith("{") && candidate.endsWith("}")) || (candidate.startsWith("[") && candidate.endsWith("]"))) {
      return candidate;
    }
  }

  const objectStart = trimmed.lastIndexOf("{");
  if (objectStart >= 0) {
    return trimmed.slice(objectStart);
  }

  return trimmed;
}

export async function runJsonSidecar(command: string, args: string[], payload: Record<string, unknown>, timeoutMs: number) {
  return await new Promise<Record<string, unknown>>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: Record<string, unknown>) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        status: "error",
        code: "sidecar_timeout",
        reason: `sidecar timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdin.on("error", (error) => {
      finish({
        status: "error",
        code: "sidecar_stdin_error",
        reason: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("error", (error) => {
      finish({
        status: "error",
        code: "sidecar_spawn_error",
        reason: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("exit", (code) => {
      if (!stdout.trim()) {
        finish({
          status: "error",
          code: code === 0 ? "sidecar_empty_response" : "sidecar_exit_error",
          reason: stderr.trim() || (code === 0 ? "sidecar exited without returning JSON" : `sidecar exited with code ${code}`),
        });
        return;
      }

      try {
        const jsonText = extractJsonPayload(stdout);
        finish(JSON.parse(jsonText) as Record<string, unknown>);
      } catch (error) {
        finish({
          status: "error",
          code: "sidecar_invalid_json",
          reason: `invalid sidecar json: ${error instanceof Error ? error.message : String(error)}`,
          raw: stdout.trim(),
          stderr: stderr.trim(),
        });
      }
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (error) {
      finish({
        status: "error",
        code: "sidecar_stdin_error",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
