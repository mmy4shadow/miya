# Miya Development Workflow

## Principle

Avoid editing the live linked plugin directory in large bursts.

## Directories

- Live plugin: `F:\openclaw\miya`
- Staging/dev copy: `F:\openclaw\miya-dev`

## Default flow

1. Develop in `miya-dev`
2. Review structure/content there first
3. Copy only the approved changes into `miya`
4. Restart Gateway once if runtime reload is required

## Why

Frequent writes inside a live linked plugin directory can collide with plugin loading and Gateway handshake timing, interrupting the coding flow.

## Operational guardrails

- Gateway handshake tolerance is increased with:
  - `OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS=15000`
- Prefer one deliberate restart over many small restarts
- Keep Phase 0/1 changes small and explicit
- Do not mix speculative features into the live plugin tree
