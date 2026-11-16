/**
 * Scheduling rules for `dsh-temp-full-access`.
 *
 * This module is deliberately free of Cordis, DOM and timers: the host polls
 * the live permission presets every couple of seconds and feeds each session's
 * effective mode in here, the client renders the remaining time from the same
 * shapes, and the test file drives it with an explicit clock. One model, three
 * consumers, no hidden state.
 */

/** The one preset this plugin watches for. */
export const MODE_FULL = "danger-full-access";

/** The one preset this plugin writes when the timer fires. */
export const MODE_WORKSPACE = "workspace-write";

/** Allowed range of the auto-revoke delay. */
export const MINUTES = { min: 1, max: 120, fallback: 10 };

/** Shipped defaults: on, ten minutes. */
export function defaultSettings() {
  return { enabled: true, minutes: MINUTES.fallback };
}

/** Clamp one minute value into the allowed range; junk falls back to the default. */
export function clampMinutes(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) === false) return MINUTES.fallback;
  return Math.min(MINUTES.max, Math.max(MINUTES.min, Math.round(numeric)));
}

/** Sanitise a stored settings record. `enabled` defaults to true, never truthy-junk. */
export function sanitizeSettings(raw) {
  const base = defaultSettings();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  return {
    enabled: raw.enabled !== false,
    minutes: clampMinutes(raw.minutes),
  };
}

/** Whole minutes shown to a human; anything still pending reads as at least 1. */
export function remainingMinutes(remainingMs) {
  const numeric = Number(remainingMs);
  if (Number.isFinite(numeric) === false || numeric <= 0) return 0;
  return Math.max(1, Math.ceil(numeric / 60_000));
}

/**
 * One scheduler for all live sessions.
 *
 * `observe` is called on every poll with the session's *effective* preset. A
 * full-access session gets a deadline the first time it is seen; staying in
 * full access keeps that deadline (no drift from polling); leaving full access
 * drops it immediately, which is how a manual switch back cancels the timer.
 * Re-entering afterwards starts a fresh deadline, as the ticket asks.
 */
export function createScheduler(clock = () => Date.now()) {
  const deadlines = new Map();

  return {
    /**
     * Feed one observation. Returns what happened, which the tests assert on:
     * `started`, `kept`, `cancelled` or `idle`.
     */
    observe(sessionId, mode, minutes, now = clock()) {
      const id = String(sessionId ?? "");
      if (id === "") return "idle";
      if (mode === MODE_FULL) {
        if (deadlines.has(id)) return "kept";
        deadlines.set(id, now + clampMinutes(minutes) * 60_000);
        return "started";
      }
      return deadlines.delete(id) ? "cancelled" : "idle";
    },

    /** Session ids whose deadline has passed; each id comes back exactly once. */
    takeDue(now = clock()) {
      const due = [];
      for (const [id, at] of deadlines) {
        if (now >= at) {
          due.push(id);
          deadlines.delete(id);
        }
      }
      return due;
    },

    /** Pending deadlines, soonest first, with the time left in milliseconds. */
    pending(now = clock()) {
      return [...deadlines.entries()]
        .map(([sessionId, at]) => ({ sessionId, remainingMs: Math.max(0, at - now) }))
        .sort((left, right) => left.remainingMs - right.remainingMs);
    },

    /** Forget every deadline without reverting anything (disable, teardown). */
    clear() {
      deadlines.clear();
    },

    size() {
      return deadlines.size;
    },
  };
}
