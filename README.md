# dsh-temp-full-access

Temporarily grants **full access**, then puts the session back to **Workspace Write** on a timer.

When a session switches to `danger-full-access`, this plugin starts a countdown.
When it runs out, the session's permission is set back to `workspace-write`, and
a small toast says so. Switching the session back by hand cancels the timer
immediately; entering full access again starts a fresh countdown.

## Settings

A settings section named **Temporary full access** / **临时完全访问**:

- **Enable auto-revert** — on by default. Turning it off cancels every pending
  countdown without reverting anything.
- **Auto-revert after** — 1–120 minutes, default 10.
- A status line shows the shortest pending countdown ("Waiting to revert: N min
  left") or "No session is waiting to revert."

## How it works

| Half | File | Job |
| --- | --- | --- |
| host | `index.js` | Polls `sessions.list()` every 2 s, reads each session's effective preset via `permissionPresets.current(session)`, remembers `danger-full-access` deadlines, and writes `permissionPresets.set(session, "workspace-write")` when one fires. |
| shared | `lib/schedule.js` | The timer model: one deadline per session, cancel on leaving full access, restart on re-entry. Pure and clock-injected, so tests drive it. |
| browser | `client.js` | Settings section, countdown line, toast, and the `/temp-full-access/config` push. |

Contract evidence (where the permission API is documented and used):

- `dsh-tool-cordis/lib/types/api-catalog.js:2094-2137` — service `permissionPresets`:
  `current(session)` at `:2112`, `set(session, name)` at `:2132`.
- `dsh-tool-cordis/lib/types/api-catalog.js:3084-3147` — service `sessions`: `list()` at `:3136`.
- `dsh-subagent/lib/index.js:410` — real caller:
  `const preset = parent.ctx.get("permissionPresets")?.current(parent.session);`
- `dsh-sidechat/lib/index.js:4683-4684` — a third-party plugin calling
  `this.ctx.permissionPresets.current(...)` and `.set(...)`.

The browser half never touches the permission API — the host writes presets,
the browser only asks about the timer state over two small routes
(`/temp-full-access/status`, `/temp-full-access/config`).

## Test

```sh
node --check client.js && node --check index.js && node --check test/classify.test.mjs
node test/classify.test.mjs            # expect: PASS — 10 groups
node cangku/tmp/261117_gate_temp_full_access.mjs   # expect: STATIC VERDICT: clean
```

Ten groups: shipped defaults, minute clamping, timer start, single fire,
manual cancel, re-entry restart, host status/config round-trip, settings-page
controls. Every group was proven able to fail (see `cangku/tmp/tfa-probe.mjs`).

## Known limits

- The countdown is per-session; the settings page shows the shortest one.
- A host restart forgets pending countdowns (the ticket allows this); the next
  full-access switch starts a fresh one.
- The toast appears in the Web UI the browser half runs in.
- No history, no per-workspace exceptions, no notification sounds — deliberately.
