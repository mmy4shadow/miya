import { spawn } from "node:child_process";

export async function runJsonSidecar(command: string, args: string[], payload: Record<string, unknown>, timeoutMs: number) {
  return await new Promise<Record<string, unknown>>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({
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
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        status: "error",
        code: "sidecar_spawn_error",
        reason: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        resolve({
          status: "error",
          code: "sidecar_exit_error",
          reason: stderr.trim() || `sidecar exited with code ${code}`,
        });
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim() || "{}") as Record<string, unknown>);
      } catch (error) {
        resolve({
          status: "error",
          code: "sidecar_invalid_json",
          reason: `invalid sidecar json: ${error instanceof Error ? error.message : String(error)}`,
          raw: stdout.trim(),
          stderr: stderr.trim(),
        });
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
