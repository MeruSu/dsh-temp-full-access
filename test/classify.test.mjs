/**
 * Tests for dsh-temp-full-access.
 *
 * Two halves are covered: the pure scheduling rules in lib/schedule.js (the
 * timer model the host runs) and the browser half in client.js (the settings
 * section the user sees). The host wiring itself needs a live Cordis host, so
 * these tests drive its exported route handlers directly with real Request and
 * Response objects — enough to prove the contract without a running instance.
 */
import { readFileSync } from "node:fs";

let groups = 0;
let failed = 0;
const failures = [];

const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

async function runOne(name, fn) {
  groups += 1;
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (thrown) {
    failed += 1;
    failures.push({ name, thrown });
    console.log(`FAIL ${name}`);
    console.log(`  ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  }
}

function assert(condition, message) {
  if (condition !== true) throw new Error(message ?? "assertion failed");
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message ?? "not equal"}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function assertDeep(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message ?? "not deep equal"}: actual=${a} expected=${b}`);
}

/* ---------------------------------------------------------------- DOM stub */

class ClassList {
  constructor() {
    this.values = new Set();
  }
  add(...names) {
    for (const name of names) this.values.add(name);
  }
  remove(...names) {
    for (const name of names) this.values.delete(name);
  }
  contains(name) {
    return this.values.has(name);
  }
}

function element(tagName) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    attributes: new Map(),
    style: {},
    classList: new ClassList(),
    parentElement: null,
    textContent: "",
    id: "",
    get className() {
      return this.attributes.get("class") ?? "";
    },
    set className(value) {
      this.attributes.set("class", String(value));
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentElement = null;
      return child;
    },
    remove() {
      this.parentElement?.removeChild(this);
    },
    setAttribute(name, value) {
      this.attributes.set(String(name), String(value));
      if (name === "id") this.id = String(value);
    },
    getAttribute(name) {
      return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    },
    hasAttribute(name) {
      return this.attributes.has(String(name));
    },
    removeAttribute(name) {
      this.attributes.delete(String(name));
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return node;
}

function installDom() {
  const head = element("head");
  const body = element("body");
  const html = element("html");
  const byId = new Map();
  const document = {
    documentElement: html,
    head,
    body,
    hidden: false,
    createElement: (tag) => element(tag),
    getElementById: (id) => byId.get(String(id)) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = document;
  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia: () => ({ media: "", matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  /* The plugin asks for a style element by id; keep the registry in sync. */
  const create = document.createElement;
  document.createElement = (tag) => {
    const node = create(tag);
    const setAttribute = node.setAttribute.bind(node);
    node.setAttribute = (name, value) => {
      setAttribute(name, value);
      if (name === "id") byId.set(String(value), node);
    };
    return node;
  };
  return { head, body, document, byId };
}

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null;
  }
  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
  removeItem(key) {
    this.map.delete(String(key));
  }
  clear() {
    this.map.clear();
  }
}

const dom = installDom();
globalThis.localStorage = new MemoryStorage();

/* ------------------------------------------------------------- load modules */

const source = readFileSync(new URL("./../client.js", import.meta.url), "utf8");
let loaded = null;
globalThis.window.__ModuleLoader__ = {
  load(spec) {
    loaded = spec;
  },
};
new Function("window", "document", "localStorage", "fetch", source)(globalThis.window, dom.document, globalThis.localStorage, async () => ({
  ok: true,
  json: async () => ({ ok: true, enabled: true, minutes: 10, pending: [], lastRevert: null }),
}));

const SRC = await import("../lib/schedule.js");
const host = await import("../index.js");
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children }, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
};
const api = loaded.factory((name) => {
  if (name === "react") return ReactStub;
  throw new Error(`unexpected require: ${name}`);
});

/* ------------------------------------------------------------ pure helpers */

test("the shipped defaults are enabled and ten minutes", () => {
  assertDeep(SRC.defaultSettings(), { enabled: true, minutes: 10 });
  assertEqual(SRC.MINUTES.min, 1);
  assertEqual(SRC.MINUTES.max, 120);
});

test("the delay is clamped into one to one hundred twenty minutes", () => {
  assertEqual(SRC.clampMinutes(0), 1, "zero floors at one minute");
  assertEqual(SRC.clampMinutes(999), 120, "huge values cap at two hours");
  assertEqual(SRC.clampMinutes(3.6), 4, "fractions round");
  assertEqual(SRC.clampMinutes("nonsense"), 10, "junk falls back to the default");
  assertEqual(SRC.sanitizeSettings({ enabled: false, minutes: -4 }).minutes, 1, "stored values are clamped too");
  assertEqual(SRC.sanitizeSettings({ enabled: false, minutes: -4 }).enabled, false, "off survives a sanitise");
  assertEqual(SRC.sanitizeSettings(null).enabled, true, "missing settings default to on");
});

test("switching a session to full access starts the timer", () => {
  const scheduler = SRC.createScheduler(() => 0);
  assertEqual(scheduler.observe("s1", SRC.MODE_FULL, 10, 0), "started", "the first full-access observation starts");
  assertDeep(scheduler.pending(0), [{ sessionId: "s1", remainingMs: 600_000 }], "ten minutes on the clock");
  assertEqual(scheduler.observe("s1", SRC.MODE_FULL, 10, 1_000), "kept", "staying in full access keeps the same deadline");
  assertEqual(scheduler.pending(0)[0].remainingMs, 600_000, "polling does not drift the deadline");
});

test("the deadline puts the session back exactly once", () => {
  const scheduler = SRC.createScheduler(() => 0);
  scheduler.observe("s1", SRC.MODE_FULL, 1, 0);
  assertDeep(scheduler.takeDue(59_999), [], "nothing is due before the minute is up");
  assertDeep(scheduler.takeDue(60_000), ["s1"], "the deadline returns the session");
  assertDeep(scheduler.takeDue(60_000), [], "the same deadline never fires twice");
  assertEqual(scheduler.size(), 0, "the deadline is gone after firing");
});

test("switching back by hand cancels the timer", () => {
  const scheduler = SRC.createScheduler(() => 0);
  scheduler.observe("s1", SRC.MODE_FULL, 10, 0);
  assertEqual(scheduler.observe("s1", SRC.MODE_WORKSPACE, 10, 1_000), "cancelled", "a manual switch back cancels");
  assertDeep(scheduler.pending(1_000), [], "nothing is left to wait for");
  assertDeep(scheduler.takeDue(60 * 60_000), [], "and nothing fires later");
});

test("entering full access again restarts the clock", () => {
  const scheduler = SRC.createScheduler(() => 0);
  scheduler.observe("s1", SRC.MODE_FULL, 10, 0);
  scheduler.observe("s1", SRC.MODE_WORKSPACE, 10, 300_000);
  assertEqual(scheduler.observe("s1", SRC.MODE_FULL, 10, 300_000), "started", "re-entering starts a fresh deadline");
  assertDeep(scheduler.takeDue(600_000), [], "the old deadline no longer fires");
  assertDeep(scheduler.takeDue(900_000), ["s1"], "the new deadline is ten minutes after re-entry");
});

test("the host answers status and accepts a config push", async () => {
  host._resetForTests(SRC.createScheduler(() => 0));
  const push = await host.serveConfig(
    new Request("http://local/temp-full-access/config?enabled=0&minutes=1", {
      headers: { "x-temp-full-access": "1" },
    }),
  );
  const saved = await push.json();
  assertEqual(saved.ok, true, "the push is accepted");
  assertEqual(saved.minutes, 1, "the pushed delay is stored");
  assertEqual(saved.enabled, false, "the pushed switch is stored");
  const status = await host.serveStatus(
    new Request("http://local/temp-full-access/status", { headers: { "x-temp-full-access": "1" } }),
    1_000,
  );
  const payload = await status.json();
  assertEqual(payload.ok, true, "status answers ok");
  assertDeep(payload.pending, [], "no session is pending");
  const forbidden = await host.serveStatus(new Request("http://local/temp-full-access/status"));
  assertEqual(forbidden.status, 403, "a request without the marker is refused");
  host._resetForTests(null);
});

test("one host tick reverts the session when the delay is up", () => {
  const scheduler = SRC.createScheduler(() => 0);
  const session = { id: "s1" };
  const written = [];
  const deps = {
    sessions: { list: () => [session] },
    presets: { current: () => SRC.MODE_FULL, set: (target, name) => written.push([target.id, name]) },
    scheduler,
    settings: { enabled: true, minutes: 1 },
    now: 0,
  };
  host.runTick(deps);
  assertDeep(written, [], "nothing is written before the minute is up");
  host.runTick({ ...deps, now: 60_000 });
  assertDeep(written, [["s1", SRC.MODE_WORKSPACE]], "the tick writes workspace-write once");
  host.runTick({ ...deps, now: 120_000 });
  assertEqual(written.length, 1, "a later tick does not write again");
});

test("a disabled feature never reverts", () => {
  const scheduler = SRC.createScheduler(() => 0);
  const written = [];
  const deps = {
    sessions: { list: () => [{ id: "s1" }] },
    presets: { current: () => SRC.MODE_FULL, set: (target, name) => written.push([target.id, name]) },
    scheduler,
    settings: { enabled: false, minutes: 1 },
    now: 0,
  };
  host.runTick(deps);
  host.runTick({ ...deps, now: 600_000 });
  assertDeep(written, [], "the disabled plugin leaves the permission alone");
  assertEqual(scheduler.size(), 0, "and it schedules nothing");
});

test("the settings page shows the switch, the stepper and the countdown", () => {
  globalThis.localStorage.clear();
  const entries = new Map();
  const ctx = {
    effect: (factory) => {
      factory();
    },
    locale: {
      register: () => {},
      bind: () => (key, params) => {
        const text = api.NS === "temp-full-access" ? key : key;
        if (params && params.minutes !== undefined) return `${text}:${params.minutes}`;
        return text;
      },
    },
    slots: {
      inject: (key, callback) => {
        if (key === "settings.section") callback();
      },
      register: (spec, component) => {
        entries.set(spec.id, { spec, component });
      },
    },
  };
  /* Cordis hands services out only inside an inject scope; the real client
     borrows `locale` and `slots` that way, so the stub has to as well. */
  ctx.get = (name) => (name === 'slots' ? ctx.slots : name === 'locale' ? ctx.locale : undefined);
  const dispose = api.mount(ctx, ReactStub);
  assert(entries.has("temp-full-access"), "the settings section is registered");
  const page = entries.get("temp-full-access").component({});
  const walk = (node, into) => {
    if (node === null || node === undefined) return into;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, into);
      return into;
    }
    if (typeof node === "object") {
      into.push(node);
      for (const child of Array.isArray(node.children) ? node.children : []) walk(child, into);
    }
    return into;
  };
  const all = walk(page, []);
  const toggle = all.find((node) => node.props?.["data-tfa-toggle"] === "enabled");
  const minutes = all.find((node) => node.props?.["data-tfa-minutes"] === "value");
  const state = all.find((node) => node.props?.["data-tfa-status"] === "state");
  assert(toggle !== undefined, "the enable switch renders");
  assertEqual(toggle.props["data-on"], "true", "it starts on");
  assert(minutes !== undefined, "the minute field renders");
  assertEqual(minutes.props.value, "10", "it starts at ten minutes");
  assert(state !== undefined, "the countdown line renders");
  toggle.props.onClick();
  const stored = JSON.parse(globalThis.localStorage.getItem(api.SETTINGS_KEY));
  assertEqual(stored.enabled, false, "the switch writes the stored settings");
  dispose();
});

/* ---------------------------------------------------------------- summary */

for (const item of queue) await runOne(item.name, item.fn);

console.log("");
if (failed > 0) {
  for (const failure of failures) console.log(`FAILED ${failure.name}: ${failure.thrown?.stack ?? failure.thrown}`);
  console.log(`FAILED — ${failed} of ${groups} groups`);
  process.exit(1);
} else {
  console.log(`PASS — ${groups} groups`);
}
