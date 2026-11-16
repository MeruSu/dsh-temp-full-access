/**
 * Host half of `dsh-temp-full-access`.
 *
 * The browser half cannot write a permission preset — only this half can, via
 * the `permissionPresets` service. So the timer lives here: every two seconds
 * the plugin reads each live session's effective preset, remembers when a
 * session entered `danger-full-access`, and puts that session back to
 * `workspace-write` when the configured delay runs out.
 *
 * The browser keeps the human-facing settings (they are per-profile UI state)
 * and pushes them here over one small route; this half keeps no file of its own,
 * so a host restart simply starts the timer over, as the ticket allows.
 */
import {
  clampMinutes,
  createScheduler,
  defaultSettings,
  MINUTES,
  MODE_FULL,
  MODE_WORKSPACE,
  remainingMinutes,
  sanitizeSettings,
} from "./lib/schedule.js";

/** One prefix, two answers: `status` is a read, `config` is a write. */
export const ROUTE = "/temp-full-access";

/** How often live sessions are sampled. Cheap: a Map lookup per session. */
const POLL_MS = 2000;

/** Settings pushed by the browser half; defaults until it says otherwise. */
let config = defaultSettings();

/** Last automatic revert, for the toast. `null` until one happens. */
let lastRevert = null;

/** The scheduler owned by `apply`; status and config read it through here. */
let activeScheduler = null;

function markerOk(request) {
  return request.headers.get("x-temp-full-access") === "1";
}

/** Everything the settings section needs, in one small payload. */
export function statusPayload(now = Date.now()) {
  const scheduler = activeScheduler;
  const pending = scheduler === null ? [] : scheduler.pending(now);
  return {
    ok: true,
    enabled: config.enabled === true,
    minutes: config.minutes,
    minMinutes: MINUTES.min,
    maxMinutes: MINUTES.max,
    pending: pending.map((entry) => ({ ...entry, minutes: remainingMinutes(entry.remainingMs) })),
    lastRevert,
  };
}

/** GET `/temp-full-access/status`. */
export function serveStatus(request, now = Date.now()) {
  if (markerOk(request) === false) return Response.json({ ok: false, reason: "no-marker" }, { status: 403 });
  try {
    return Response.json(statusPayload(now));
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.debug("[temp-full-access] status failed", message);
    return Response.json({ ok: false, reason: "error", error: message }, { status: 500 });
  }
}

/**
 * POST `/temp-full-access/config`. The body is `{enabled, minutes}`; anything
 * else is ignored rather than rejected, because the only writer is our own
 * settings section. Disabling cancels every pending deadline without reverting
 * (the user asked for the feature off, not for an early revoke).
 */
export function serveConfig(request, scheduler = activeScheduler) {
  if (markerOk(request) === false) return Response.json({ ok: false, reason: "no-marker" }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const next = sanitizeSettings({
      enabled: params.get("enabled") === null ? undefined : params.get("enabled") !== "0",
      minutes: params.get("minutes") === null ? undefined : Number(params.get("minutes")),
    });
    config = next;
    if (next.enabled === false && scheduler !== null) scheduler.clear();
    return Response.json({ ok: true, ...statusPayload() });
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.debug("[temp-full-access] config failed", message);
    return Response.json({ ok: false, reason: "error", error: message }, { status: 400 });
  }
}

/** One prefix, dispatched by pathname so router order cannot pick the handler. */
export function serveRequest(request) {
  let pathname = "";
  try {
    pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  } catch {
    pathname = "";
  }
  if (pathname === `${ROUTE}/config`) return serveConfig(request);
  return serveStatus(request);
}

/** Reset module state; the test file drives the host half through this. */
export function _resetForTests(scheduler = null) {
  config = defaultSettings();
  lastRevert = null;
  activeScheduler = scheduler;
}

/** The settings currently in force (the client can read them back from status). */
export function currentConfig() {
  return { ...config };
}

/**
 * One poll: read every live session's effective preset, keep the deadlines
 * current, and revert whatever came due. Split out of `apply` so the whole
 * path — read, schedule, write — can be driven by a test with fake services.
 */
export function runTick({ sessions, presets, scheduler, settings, now = Date.now(), log = () => {} }) {
  const reverted = [];
  if (settings.enabled !== true) return { reverted, observed: 0 };
  let live = [];
  try {
    live = sessions.list();
  } catch {
    return { reverted, observed: 0 };
  }
  for (const session of live) {
    const id = String(session?.id ?? "");
    if (id === "") continue;
    let mode = "custom";
    try {
      mode = presets.current(session);
    } catch {
      continue;
    }
    scheduler.observe(id, mode, settings.minutes, now);
  }
  for (const id of scheduler.takeDue(now)) {
    const session = live.find((entry) => String(entry?.id ?? "") === id);
    if (session === undefined) continue;
    try {
      presets.set(session, MODE_WORKSPACE);
      reverted.push(id);
      log(id);
    } catch (thrown) {
      console.debug("[temp-full-access] revert failed", thrown instanceof Error ? thrown.message : String(thrown));
    }
  }
  return { reverted, observed: live.length };
}

export function apply(ctx) {
  const scheduler = createScheduler();
  activeScheduler = scheduler;

  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: "prefix",
          path: ROUTE,
          resource: (request) => serveRequest(request),
        }),
      "temp-full-access: status and config",
    );
  });

  ctx.inject(["sessions", "permissionPresets"], (scope) => {
    const tick = () => {
      runTick({
        sessions: scope.get("sessions"),
        presets: scope.get("permissionPresets"),
        scheduler,
        settings: config,
        log: (id) => {
          lastRevert = { sessionId: id, at: Date.now(), from: MODE_FULL, to: MODE_WORKSPACE };
          console.debug("[temp-full-access] reverted", id);
        },
      });
    };
    const timer = setInterval(tick, POLL_MS);
    scope.effect(() => () => {
      clearInterval(timer);
      scheduler.clear();
    }, "temp-full-access: poll");
    tick();
  });
}

export { clampMinutes, MINUTES, MODE_FULL, MODE_WORKSPACE };
