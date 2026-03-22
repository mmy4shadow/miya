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
- `/plugins/miya/wizard/*` exposes staged training-ledger routes
- VRAM scheduler can force-evict lower-priority lanes when configured
- wizard trainer profiles can launch external LoRA / finetune commands and emit artifact manifests
- `before_prompt_build` injects a single assembled `guard + persona + recall` prefix
- `memory-lite` can recall from the local Miya-side index with budget trimming
- invalid finetune datasets are blocked before runner spawn
- `worker/voice_sidecar.py` can produce a real neural VAD artifact JSON file
- `worker/voice_sidecar.py` can produce a real transcript artifact when `faster-whisper` is available
- `worker/voice_sidecar.py` can produce a real embedding speaker-match artifact against local reference audio
- `worker/voice_sidecar.py` can produce a real TTS waveform artifact through local `qwen_tts`
- `worker/image_sidecar.py` can produce a real PNG artifact through the local FLUX stack
- `worker/vision_sidecar.py` can boot local `llama-server` and return a structured click decision
- voice/image HTTP routes persist runtime-state and evidence, not only tool invocations

## What this batch does NOT prove

- real memory recall behavior
- runtime-native model load/unload coordination inside external executors

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
   - `GET|POST /plugins/miya/wizard/status`
   - `POST /plugins/miya/wizard/start`
   - `POST /plugins/miya/wizard/update`
   - `POST /plugins/miya/wizard/run`
   - `POST /plugins/miya/voice/vad`
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
   - if VAD runs, it writes a `vadJson` artifact file and prefers `silero-vad:cuda:0` when the local neural stack is present
   - if `faster-whisper` is available, transcription writes a transcript artifact JSON file
   - if local speaker references are present, speaker identification writes a match artifact JSON file using `ERes2Net` embeddings when ModelScope deps are available
   - if local `qwen_tts` weights are present, synthesis writes a WAV artifact file
   - if the local FLUX stack is present and CUDA is available, image generation writes a PNG artifact file
   - if the local Qwen3-VL GGUF assets and Vulkan runtime are present, the vision sidecar returns a structured JSON decision instead of `vision_unavailable`
   - successful voice/image route calls update `state/runtime-state.json` and append `state/evidence.jsonl`
   - wizard start/update calls persist JSON job files under `state/wizard/jobs/`
   - wizard run calls can move persona-dataset jobs to `complete` and emit a manifest artifact under the configured output path
   - when `vramScheduler.allowForceEvict=true`, a higher-priority lane can reclaim lower-priority evictable leases and record them under `state/vram-scheduler.json`
   - when `wizard.trainer.lora` or `wizard.trainer.finetune` is configured, wizard runs can launch the external trainer, capture artifacts, and release the training lease after the runner exits
   - prompt probe runtime-state includes the assembled prefix preview and truncation metadata

## Vision runtime bootstrap

To make the project-owned local vision runtime actually runnable on Windows, install the missing runtime assets from the plugin root:

```bash
npm run vision:setup
```

That helper downloads or refreshes:

- the latest official `llama.cpp` Windows Vulkan runtime archive by default
- the official Qwen3-VL `mmproj` file into `model/vision/qwen3vl_4b_instruct_q4_k_m/`

After that, `worker/vision_sidecar.py` can truthfully launch the local sidecar-backed `llama-server`.

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

## Local gate

From the plugin root, the baseline gate is now:

```bash
python ./scripts/verify_all.py
```

Use this when you want a non-desktop verification pass. Add `--with-acceptance` only when the machine is idle enough to allow desktop interaction checks.

## Recommended next validation batch

After this batch passes, validate one real click case that requires sidecar disambiguation and one keyboard action against a live desktop app.
