---
name: miya-probe
description: Read-only probe helper for the local Miya plugin scaffold and model layout.
metadata:
  { "openclaw": { "emoji": "🍫" } }
---

# Miya Probe

Use this skill when you need a quick read-only check of the local Miya plugin scaffold.

## What it is for

- Confirm the Miya plugin is installed/enabled
- Check the configured state root and model root
- See which top-level local model buckets exist

## Fast path

Run the plugin command:

```bash
/miya-status
```

Expected output is a short status block with:

- plugin id
- state root
- model root
- discovered model buckets

## Scope

This skill does not implement image generation, memory, desktop control, or persona injection.
Those are deferred to later phases documented in `docs/ROADMAP.md`.
