# Miya Plugin Roadmap

## Scope

This repo is a minimal OpenClaw plugin scaffold for Miya.
Current work now covers honest Phase 1-6 foundations without claiming external runtime success.

## Phase 0 — plugin capability probe

Goal: prove that OpenClaw can discover, link, load, and expose a tiny Miya-owned command.

Delivered:
- `openclaw.plugin.json` manifest with config schema
- package-local extension entry via `openclaw.extensions`
- `/miya-probe` command for read-only status
- centralized path defaults for plugin root, model root, and state root
- model inventory notes in `docs/MODELS.md`

## Phase 1 — minimal Windows desktop worker integration

Goal: add a very small, explicit bridge to a local Windows worker for desktop actions that core does not already provide.

Delivered foundations:
- worker config block with `transport`, `endpoint`, `timeoutMs`, and `probe`
- health probe abstraction supporting:
  - loopback HTTP probe
  - local command probe
  - explicit `none`
- small client module: `src/worker-client.ts`
- evidence record type: `src/evidence.ts`
- safe command: `/miya-worker-health`
- stable desktop run route: `POST /plugins/miya/desktop/run`
- high-level desktop run tool: `miya_desktop_run`

Still missing:
- real worker server
- richer action semantics beyond the current minimal set

## Phase 2 — memory lite + persona lite

Goal: add small Miya-specific memory and persona helpers without replacing core memory systems.

Delivered foundations:
- `memoryLite` config, resolver, and status helper
- `personaLite` config, resolver, and status helper
- explicit fallback strategy docs in code:
  - memory-lite falls back to core/identity behavior
  - persona-lite falls back to static summary/reference assets

Still missing:
- runtime recall composition
- dynamic prompt injection hook, if OpenClaw exposes a stable surface for it

## Phase 3 — voice foundations

Goal: define voice-related config and map real local assets without pretending they already run.

Delivered foundations:
- config/types for `vad`, `asr`, `tts`, `speakerId`
- model mapping to local assets under `model/`
- diagnostics exposure through `/miya-probe` and `/miya-capabilities`

Still missing:
- audio pipeline runtime
- worker/API adapter for ASR/TTS/VAD
- speaker enrollment and scoring flow

## Phase 4 — VRAM scheduler foundations

Goal: define scheduling intent before implementing any allocator.

Delivered foundations:
- declarative lane config
- priorities for `interactive`, `voice`, `vision`, `image`, `training`
- example uses per lane

Still missing:
- real runtime coordination
- model load/unload policy implementation

## Phase 5 — wizard/training foundations

Goal: capture local training intent and descriptors without launching fake jobs.

Delivered foundations:
- wizard config
- wizard state type
- training job descriptor type
- example job placeholder

Still missing:
- persistence
- dataset validation
- queue runner
- external trainer integration

## Phase 6 — diagnostics, acceptance, and continuous-work control

Goal: make the project inspectable and honest.

Delivered foundations:
- consolidated diagnostics collector
- acceptance checklist
- validation doc
- capability/status commands
- queue-backed workflow commands:
  - `miya-workflow-start`
  - `miya-workflow-check`
  - `miya-workflow-stop`
- queue-backed workflow routes:
  - `/plugins/miya/workflow/check`
  - `/plugins/miya/workflow/start`
  - `/plugins/miya/workflow/stop`
- queue-backed workflow tools:
  - `miya_workflow_start`
  - `miya_workflow_check`
  - `miya_workflow_stop`
- dispatcher-backed continuation hooks

Still missing:
- live runtime acceptance run against a real worker and chosen model stack
- voice runtime execution
- image runtime execution
- real scheduler admission between voice/vision/image lanes

## Explicit non-goals for this scaffold

- No custom channel implementation
- No replacement for built-in OpenClaw core features
- No fake claims about voice/image/vision execution
- No silent desktop control loop
- No Canvas feature claims yet
