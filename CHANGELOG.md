# Changelog

## 0.1.2 — 2026-11-17

**Packaging only: `engines.dsh`.** This release adds
`"engines": { "dsh": ">=0.2.2-rc.1 <0.3.0-0" }` so the host — and any directory
that lists the plugin — can check up front that a compatible DSH is installed.
Nothing else changed: no behaviour, no timer logic, no settings. If you already
run 0.1.1, installing 0.1.2 looks and acts exactly the same.

## 0.1.1 — 2026-11-17

### Fixed

- **The client half no longer declares anything at module scope.** The harness
  concatenates every plugin's client half into a single module, so one bare
  `const NS` there takes the whole page down with
  `Uncaught SyntaxError: Identifier 'NS' has already been declared` and every
  plugin reports `failed`. `client.js` is now one
  `window.__ModuleLoader__.load({ id, factory })` call with nothing outside it.
- Settings write-back goes through
  `GET /temp-full-access/config?enabled=&minutes=` instead of a POST body: the
  host web server answers `GET`/`HEAD` only and returns 405 for anything else,
  which is why the delay used to stay at its default no matter what the page
  sent.
- The client half takes `slots` and `locale` with `ctx.get(...)` plus a 250 ms
  retry instead of touching `ctx.slots` / `ctx.locale` directly — property
  access throws `cannot get property "locale" without inject` when the client
  half boots before those services exist, which is exactly what happens in a
  small profile.

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
