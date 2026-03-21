import { resolveDesktopWorkerRuntime, runDesktopWorker, runPingWorker } from "./desktop-worker-runner.mjs";

function assertOk(name, payload, predicate = (x) => x?.status === "ok" || x?.status === "pong") {
  if (!predicate(payload)) {
    if (payload?.human_mutex === true) {
      throw new Error(`${name} blocked by human mutex: ${JSON.stringify(payload)}`);
    }
    throw new Error(`${name} failed: ${JSON.stringify(payload)}`);
  }
  console.log(`[miya-smoke] ${name}: ok`);
}

const runtime = resolveDesktopWorkerRuntime();
const summary = {
  runtime: {
    transport: runtime.transport,
    endpoint: runtime.endpoint,
    timeoutMs: runtime.timeoutMs,
    configPath: runtime.configPath,
  },
};

try {
  const ping = await runPingWorker();
  assertOk("ping", ping, (x) => x?.status === "pong");
  summary.ping = { status: ping.status, worker: ping.worker, observed_at: ping.observed_at };

  const capture = await runDesktopWorker("capture", ["640", "45"]);
  assertOk("capture", capture, (x) => x?.status === "ok" && x?.kind === "capture" && Number(x?.bytes || 0) > 0);
  summary.capture = { status: capture.status, bytes: capture.bytes, width: capture.width, height: capture.height, source: capture.source };

  const inspect = await runDesktopWorker("inspect_ui", ["5"]);
  assertOk("inspect_ui", inspect, (x) => x?.status === "ok" && x?.kind === "inspect_ui");
  summary.inspect_ui = { status: inspect.status, count: inspect.count, window: inspect.window?.name ?? "" };

  const click = await runDesktopWorker("click", ["100", "100", "true"]);
  assertOk("click_dry_run", click, (x) => x?.status === "ok" && x?.kind === "click" && x?.dry_run === true);
  summary.click_dry_run = { status: click.status, dry_run: click.dry_run, monitor_errors: click?.human_mutex?.monitor_errors ?? [] };

  console.log(JSON.stringify({ status: "ok", summary }, null, 2));
} catch (error) {
  console.error(`[miya-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
