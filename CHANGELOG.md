# Changelog

## 0.1.0 — 2026-11-17

### Added

- Host half: polls every live session's effective permission preset every 2
  seconds; a session seen in `danger-full-access` gets a deadline; when the
  deadline passes, the host writes `permissionPresets.set(session,
  "workspace-write")` and records the revert for the toast.
- Leaving full access by hand cancels the deadline; re-entering starts a fresh
  one. Disabling the feature clears every pending deadline without reverting.
- Settings section "Temporary full access" / 「临时完全访问」: on/off switch
  (default on), 1–120 minute delay (default 10), and a countdown line showing
  the shortest pending deadline.
- Toast "Permission was put back to Workspace Write." after an automatic
  revert.
- `lib/schedule.js`: the pure, clock-injected timer model, shared by the host
  and the tests.
- Routes `/temp-full-access/status` (read) and `/temp-full-access/config`
  (write), both marker-gated with `x-temp-full-access: 1`.
- Test suite: 10 groups, each proven able to fail (see `cangku/tmp/tfa-probe.mjs`).
