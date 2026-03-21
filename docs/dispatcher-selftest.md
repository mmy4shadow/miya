# Dispatcher Selftest Notes

## Current entrypoints

Workspace-level selftest:
- `F:\openclaw\workspace\scripts\continuous-dispatcher-selftest.mjs`

Plugin-local shim:
- `F:\openclaw\miya\scripts\dispatcher-selftest.mjs`
- package script: `npm run dispatcher:selftest`

## What the selftest is intended to verify

- stale `running` task is detected
- `--apply` rewrites stale task to `retry`
- queued follow-up task remains present
- auto-repair note is written into the queue

## Current limitation

The selftest entrypoints have been created and wired, but they still need to be actually executed in a runtime where `exec` is available.

## Next validation target

When runtime execution is available again:
1. run `npm run dispatcher:selftest` from `F:\openclaw\miya`
2. capture the JSON output
3. write the result into `memory/2026-03-20.md`
4. if the output reveals schema drift, patch dispatcher and rerun
