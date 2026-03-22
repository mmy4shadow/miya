# Miya Local Model Inventory

Model root: `F:\openclaw\miya\model`

This file records what is already present locally so later phases can reuse it instead of inventing new storage conventions.

## Discovered top-level buckets

- `audio/`
  - `qwen3_tts_12hz_1_7b_customvoice`
  - current use: mapped as Phase 3 TTS asset only
- `image/`
  - `flux_1_schnell`
  - `flux_2_klein_4b_apache2`
  - `long_term/` reference images
  - current use: persona-lite reference directory + future image runtime candidates
- `memory/`
  - `qwen3_embedding_0_6b`
  - current use: documented candidate for memory-lite embedding experiments
- `speaker_id/`
  - `eres2net`
  - current use: mapped candidate for future speaker-id flow
- `vision/`
  - `qwen3vl_4b_instruct_q4_k_m`
  - current use: documented candidate for later screenshot understanding

## Current plugin-side asset map

The plugin now exposes these logical mappings through diagnostics:

- `persona.referenceImages` → `image/long_term`
- `memory.embedding` → `memory/qwen3_embedding_0_6b`
- `voice.tts` → `audio/qwen3_tts_12hz_1_7b_customvoice`
- `voice.speakerId` → `speaker_id/eres2net`
- `vision.primary` → `vision/qwen3vl_4b_instruct_q4_k_m`
- `image.fast` → `image/flux_1_schnell`

## Important notes

- These are documented assets and mapped paths, not guaranteed running features.
- The plugin now has real local execution paths for mapped voice / image / vision assets when the required runtimes are installed.
- Memory-lite assets remain documented-only until recall composition is implemented.
- Path defaults assume the current OpenClaw state root is `F:\openclaw`.
- Persona reference imagery also exists under `image/long_term/`.

## Phase guidance

### Phase 2
- keep memory-lite/persona-lite mostly descriptive
- prefer static/fallback behavior over unsupported runtime prompt injection

### Phase 3
- attach only one external runtime path at a time
- start with TTS or worker-mediated voice metadata, not the full voice stack

### Phase 4+
- tie model activation to VRAM lanes before enabling multiple heavy runtimes simultaneously
