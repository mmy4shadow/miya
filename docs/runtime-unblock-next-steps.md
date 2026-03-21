# Miya / OpenClaw Runtime Unblock Next Steps

## Goal

Provide the plugin-side operator-facing shortest path for the remaining runtime blockers that hold back:
- `dispatcher:selftest`
- `openclaw doctor --non-interactive`
- `openclaw status`

## Execute in this order

1. Reload/restart OpenClaw so active runtime re-reads:
   - `F:\openclaw\openclaw.json`
   - `C:\Users\shadow\.openclaw\exec-approvals.json`
2. Run plugin-local selftest:
   - `cd F:\openclaw\miya && npm run dispatcher:selftest`
3. Record the result in:
   - `F:\openclaw\workspace\docs\dispatcher-selftest-results.md`
4. Run:
   - `openclaw doctor --non-interactive`
   - `openclaw status`
5. If allowlist still fails, extend approvals against the exact observed launcher path, not an assumed path.

## Success condition

- dispatcher selftest passes
- doctor/status actually execute
- then T002/T003 can be advanced honestly
