import { runDesktopWorker, runPingWorker } from "./desktop-worker-runner.mjs";

function stepFailure(step, payload, completed) {
  const blockedByHumanMutex = payload?.human_mutex === true;
  return {
    status: blockedByHumanMutex ? "blocked-external" : "error",
    failedStep: step,
    completed,
    blockerType: blockedByHumanMutex ? "external" : undefined,
    error: typeof payload?.error === "string" ? payload.error : `step ${step} failed`,
    hint: blockedByHumanMutex ? "Human mutex is active; pause desktop actions until keyboard/mouse activity stops." : undefined,
    payload,
  };
}

async function main() {
  const completed = [];

  const ping = await runPingWorker();
  if (ping?.status !== "pong" && ping?.status !== "ok") {
    console.log(JSON.stringify(stepFailure("ping", ping, completed), null, 2));
    process.exitCode = 1;
    return;
  }
  completed.push("ping");

  const capture = await runDesktopWorker("capture", ["960", "55"]);
  if (capture?.status !== "ok") {
    console.log(JSON.stringify(stepFailure("capture", capture, completed), null, 2));
    process.exitCode = 1;
    return;
  }
  completed.push("capture");

  const inspect = await runDesktopWorker("inspect_ui", ["50"]);
  if (inspect?.status !== "ok") {
    console.log(JSON.stringify(stepFailure("inspect_ui", inspect, completed), null, 2));
    process.exitCode = 1;
    return;
  }
  completed.push("inspect_ui");

  const firstItem = Array.isArray(inspect?.items) && inspect.items.length > 0 ? inspect.items[0] : null;
  const clickX = firstItem ? Math.round(((firstItem.rect?.left ?? 0) + (firstItem.rect?.right ?? 0)) / 2) : 100;
  const clickY = firstItem ? Math.round(((firstItem.rect?.top ?? 0) + (firstItem.rect?.bottom ?? 0)) / 2) : 100;
  const click = await runDesktopWorker("click", [String(clickX), String(clickY), "true"]);
  if (click?.status !== "ok") {
    console.log(JSON.stringify(stepFailure("click", click, completed), null, 2));
    process.exitCode = 1;
    return;
  }
  completed.push("click");

  console.log(JSON.stringify({
    status: "ok",
    sequence: ["ping", "capture", "inspect_ui", "click"],
    completed,
    ping,
    capture: {
      status: capture?.status,
      width: capture?.width,
      height: capture?.height,
      bytes: capture?.bytes,
      source: capture?.source,
    },
    inspect: {
      status: inspect?.status,
      window: inspect?.window,
      count: inspect?.count,
      note: inspect?.note,
    },
    click,
  }, null, 2));
}

await main();
