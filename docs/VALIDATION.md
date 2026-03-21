# Miya Validation Checklist

Use this file to validate the current plugin batch honestly.

## What this batch should prove

- plugin loads with expanded config schema
- `/miya-probe` returns a readable status snapshot
- `/miya-worker-health` safely handles disabled worker config
- `/miya-capabilities` shows mapped assets and acceptance items
- local model directories are discoverable from the configured model root
- `/plugins/miya/desktop/run` exposes a stable single-call desktop task contract
- `/plugins/miya/desktop/run` supports structured desktop actions beyond click
- desktop task runs persist standalone evidence files under `state/desktop-runs/`
- `/plugins/miya/workflow/*` exposes queue-backed control routes
- `/plugins/miya/voice/*` exposes truthful local voice runtime contracts
- `/plugins/miya/image/generate` exposes a truthful local image runtime contract

## What this batch does NOT prove

- local vision inference is active by default without `llama-server` + `mmproj`
- real voice runtime execution
- real memory recall behavior
- real VRAM arbitration
- real training jobs

## Manual validation steps

1. Install/link the plugin build you want to test.
2. Enable the plugin.
3. Restart Gateway once for the whole batch.
4. Run:
   - `/miya-probe`
   - `/miya-worker-health`
   - `/miya-capabilities`
   - `GET /plugins/miya/desktop/help`
   - `POST /plugins/miya/desktop/run`
   - `GET|POST /plugins/miya/workflow/check`
   - `POST /plugins/miya/workflow/start`
   - `POST /plugins/miya/workflow/stop`
   - `POST /plugins/miya/voice/transcribe`
   - `POST /plugins/miya/voice/synthesize`
   - `POST /plugins/miya/voice/speaker_identify`
   - `POST /plugins/miya/image/generate`
5. Confirm:
   - paths point where expected
   - worker state is `disabled`, `skipped`, or a truthful probe result
   - model buckets/assets reflect reality
   - `help` lists the `run` action
   - each desktop run produces a `runFile`
   - if no local vision command is configured, the route returns `vision_unavailable` instead of pretending the model ran
   - if local voice/image executors are not attached, the routes return `*_runtime_unavailable` instead of pretending the models ran

## Vision runtime bootstrap

To make the project-owned local vision runtime actually runnable on Windows, install the missing runtime assets from the plugin root:

```bash
npm run vision:setup
```

That helper downloads:

- the latest official `llama.cpp` Windows runtime archive
- the official Qwen3-VL `mmproj` file into `model/vision/qwen3vl_4b_instruct_q4_k_m/`

After that, `worker/vision_sidecar.py` can truthfully attempt to launch the local sidecar-backed `llama-server`.

For cold-start local vision, keep `vision.timeoutMs` high enough for first-load latency. The project default is now `60000`.

## Optional worker validation

If you have a tiny loopback worker exposing `GET /health`:

1. Set `desktopWorker.enabled=true`
2. Point `desktopWorker.endpoint` at the worker
3. Keep probe mode as `http`
4. Run `/miya-worker-health`
5. Expect `healthy` only if the endpoint actually returns the configured status

## Local acceptance shortcut

From the plugin root you can now run the exact local acceptance chain in one command:

```bash
npm run acceptance
```

That script executes `ping -> capture -> inspect_ui -> click(dry-run)` in strict order and fails fast with the original step payload if any stage breaks. If the click dry-run is blocked by active human input, it now reports `status: "blocked-external"` with `blockerType: "external"` instead of pretending it was a generic runtime error.

## Recommended next validation batch

After this batch passes, validate one real click case that requires sidecar disambiguation and one keyboard action against a live desktop app.
