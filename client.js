/**
 * Browser half of `dsh-temp-full-access`.
 *
 * The host owns the timer and the permission write; this half owns the two
 * settings a human edits (on/off and the delay) and the visible feedback. It
 * pushes the settings to the host over `/temp-full-access/config`, polls
 * `/temp-full-access/status` for the countdown, and shows a short toast when
 * the host reports that a session was put back to workspace-write.
 *
 * No permission API is called from here: the browser cannot write presets.
 */

window.__ModuleLoader__.load({
  id: "dsh-temp-full-access",
  factory(require) {
    const NS = "temp-full-access";
    const SECTION_ID = "temp-full-access";
    const SECTION_ORDER = 47;
    const SETTINGS_KEY = "dsh.tempFullAccess.settings.v1";
    const ROUTE = "/temp-full-access";
    const POLL_MS = 2000;
    const TOAST_MS = 6000;
    const STYLE_ID = "temp-full-access-style";

    const MINUTES = { min: 1, max: 120, fallback: 10 };

    const ZH = {
      "settings.nav": "临时完全访问",
      "settings.title": "临时完全访问",
      "settings.description": "开启后，切到「完全权限」会自动起一个计时器；到点把该会话调回「工作区内修改」。",
      "settings.enabled": "启用自动撤回",
      "settings.enabledHint": "关掉后计时器立即取消，不会再自动改权限。",
      "settings.minutes": "自动撤回时间",
      "settings.minutesHint": "分钟。到点自动把权限调回工作区修改。",
      "settings.waiting": "当前待撤回：还剩 {minutes} 分钟",
      "settings.idle": "当前没有待撤回的会话。",
      "settings.disabledNote": "自动撤回已停用。",
      "toast.reverted": "已自动把权限调回「工作区内修改」。",
    };

    const EN = {
      "settings.nav": "Temporary full access",
      "settings.title": "Temporary full access",
      "settings.description":
        "While enabled, switching a session to Full access starts a timer; when it runs out the session goes back to Workspace Write.",
      "settings.enabled": "Enable auto-revert",
      "settings.enabledHint": "Turning this off cancels the timer immediately; nothing is changed later.",
      "settings.minutes": "Auto-revert after",
      "settings.minutesHint": "Minutes. The permission goes back to workspace-write when it runs out.",
      "settings.waiting": "Waiting to revert: {minutes} min left",
      "settings.idle": "No session is waiting to revert.",
      "settings.disabledNote": "Auto-revert is off.",
      "toast.reverted": "Permission was put back to Workspace Write.",
    };

    function defaultSettings() {
      return { enabled: true, minutes: MINUTES.fallback };
    }

    function clampMinutes(value) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) === false) return MINUTES.fallback;
      return Math.min(MINUTES.max, Math.max(MINUTES.min, Math.round(numeric)));
    }

    function sanitizeSettings(raw) {
      const base = defaultSettings();
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
      return { enabled: raw.enabled !== false, minutes: clampMinutes(raw.minutes) };
    }

    function readSettings() {
      try {
        const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
        if (typeof raw !== "string" || raw === "") return defaultSettings();
        return sanitizeSettings(JSON.parse(raw));
      } catch {
        return defaultSettings();
      }
    }

    function writeSettings(settings) {
      const clean = sanitizeSettings(settings);
      try {
        globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(clean));
      } catch {
        /* storage is best effort: the session keeps working without it */
      }
      return clean;
    }

    async function pushConfig(settings) {
      const query = new URLSearchParams({
        enabled: settings.enabled === true ? "1" : "0",
        minutes: String(settings.minutes),
      });
      return fetch(`${ROUTE}/config?${query.toString()}`, {
        method: "GET",
        headers: { "x-temp-full-access": "1" },
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
    }

    async function fetchStatus() {
      try {
        const response = await fetch(`${ROUTE}/status`, { headers: { "x-temp-full-access": "1" } });
        if (response.ok === false) return null;
        return await response.json();
      } catch {
        return null;
      }
    }

    function injectStyle(doc) {
      if (doc.getElementById(STYLE_ID) !== null) return;
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      style.textContent = [
        ".tfa-page{display:flex;flex-direction:column;gap:14px;padding:4px 0}",
        ".tfa-title{font-size:16px;font-weight:600;margin:0}",
        ".tfa-text{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#8a8f98);margin:0}",
        ".tfa-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18))}",
        ".tfa-label{font-size:13px}",
        ".tfa-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#8a8f98);margin:2px 0 0}",
        ".tfa-controls{display:inline-flex;align-items:center;gap:6px}",
        ".tfa-step{width:28px;height:28px;border-radius:7px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:14px;cursor:pointer}",
        ".tfa-num{width:64px;height:28px;border-radius:7px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.3));background:transparent;color:inherit;text-align:center;font-size:13px}",
        ".tfa-switch{width:36px;height:20px;border-radius:10px;border:0;position:relative;cursor:pointer;background:rgba(127,127,127,.28)}",
        ".tfa-switch[data-on='true']{background:#2f7d4f}",
        ".tfa-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}",
        ".tfa-switch[data-on='true']::after{left:18px}",
        ".tfa-toast{position:fixed;right:20px;bottom:20px;z-index:2147483000;padding:10px 14px;border-radius:10px;font-size:13px;line-height:18px;color:#fff;background:rgba(30,32,36,.94);box-shadow:0 8px 24px rgba(0,0,0,.28)}",
      ].join("\n");
      doc.head.appendChild(style);
    }

    function removeStyle(doc) {
      doc.getElementById(STYLE_ID)?.remove();
    }

    function showToast(doc, text) {
      const toast = doc.createElement("div");
      toast.className = "tfa-toast";
      toast.textContent = text;
      doc.body.appendChild(toast);
      setTimeout(() => toast.remove(), TOAST_MS);
    }

    function mount(ctx, React) {
      /* `slots` and `locale` throw until the plugin declares them, and a
         bundle can load this half before the UI services exist. `ctx.get` answers
         undefined instead, so wait for both and keep the entry active meanwhile. */
      const slots = typeof ctx.get === "function" ? ctx.get("slots") : slots;
      const locale = typeof ctx.get === "function" ? ctx.get("locale") : locale;
      if (slots === undefined || slots === null || locale === undefined || locale === null) {
        const retry = setTimeout(() => mount(ctx, React), 250);
        return () => clearTimeout(retry);
      }
      const h = React.createElement;
      const doc = globalThis.document;
      if (doc === undefined) return;
      injectStyle(doc);
      ctx.effect(() => () => removeStyle(doc), "temp-full-access: style");

      ctx.effect(() => locale.register(NS, { zh: ZH, en: EN }), "temp-full-access: dictionaries");
      const t = locale.bind(NS);

      let status = null;
      let settings = readSettings();
      let toastAt = 0;
      const listeners = new Set();

      const publish = () => {
        for (const listener of listeners) listener();
      };

      const refresh = async () => {
        const next = await fetchStatus();
        if (next === null) return;
        status = next;
        if (typeof next.lastRevert?.at === "number" && next.lastRevert.at > toastAt) {
          toastAt = next.lastRevert.at;
          showToast(doc, t("toast.reverted"));
        }
        publish();
      };

      const save = (patch) => {
        settings = writeSettings({ ...settings, ...patch });
        void pushConfig(settings);
        publish();
      };

      const SettingsPage = () => {
        const [, bump] = React.useState(0);
        React.useEffect(() => {
          const listener = () => bump((value) => value + 1);
          listeners.add(listener);
          void refresh();
          return () => listeners.delete(listener);
        }, []);
        const pending = Array.isArray(status?.pending) ? status.pending : [];
        const waiting = pending.length > 0 ? pending[0] : null;
        const stateText =
          settings.enabled === false
            ? t("settings.disabledNote")
            : waiting === null
              ? t("settings.idle")
              : t("settings.waiting", { minutes: waiting.minutes });

        return h("div", { className: "tfa-page", "data-temp-full-access": "page" }, [
          h("h2", { key: "title", className: "tfa-title" }, t("settings.title")),
          h("p", { key: "description", className: "tfa-text" }, t("settings.description")),
          h("div", { key: "enabled", className: "tfa-row", "data-tfa-row": "enabled" }, [
            h("div", { key: "label" }, [
              h("div", { key: "name", className: "tfa-label" }, t("settings.enabled")),
              h("p", { key: "hint", className: "tfa-hint" }, t("settings.enabledHint")),
            ]),
            h("button", {
              key: "switch",
              type: "button",
              className: "tfa-switch",
              "data-tfa-toggle": "enabled",
              "data-on": settings.enabled === true ? "true" : "false",
              "aria-pressed": settings.enabled === true ? "true" : "false",
              onClick: () => save({ enabled: settings.enabled !== true }),
            }),
          ]),
          h("div", { key: "minutes", className: "tfa-row", "data-tfa-row": "minutes" }, [
            h("div", { key: "label" }, [
              h("div", { key: "name", className: "tfa-label" }, t("settings.minutes")),
              h("p", { key: "hint", className: "tfa-hint" }, t("settings.minutesHint")),
            ]),
            h("div", { key: "controls", className: "tfa-controls" }, [
              h("button", {
                key: "minus",
                type: "button",
                className: "tfa-step",
                "data-tfa-step": "minus",
                onClick: () => save({ minutes: clampMinutes(settings.minutes - 1) }),
              }, "−"),
              h("input", {
                key: "number",
                type: "number",
                className: "tfa-num",
                "data-tfa-minutes": "value",
                min: MINUTES.min,
                max: MINUTES.max,
                value: String(settings.minutes),
                onChange: (event) => save({ minutes: clampMinutes(event.target.value) }),
              }),
              h("button", {
                key: "plus",
                type: "button",
                className: "tfa-step",
                "data-tfa-step": "plus",
                onClick: () => save({ minutes: clampMinutes(settings.minutes + 1) }),
              }, "＋"),
            ]),
          ]),
          h("p", { key: "state", className: "tfa-text", "data-tfa-status": "state" }, stateText),
        ]);
      };

      ctx.effect(
        () =>
          slots.inject("settings.section", () =>
            slots.register(
              {
                name: "settings.section",
                id: SECTION_ID,
                order: SECTION_ORDER,
                locale: NS,
                label: () => t("settings.nav"),
              },
              SettingsPage,
            ),
          ),
        "temp-full-access: settings section",
      );

      const timer = setInterval(() => void refresh(), POLL_MS);
      ctx.effect(() => () => clearInterval(timer), "temp-full-access: status poll");
      void pushConfig(settings);
      void refresh();
      return () => clearInterval(timer);
    }

    return {
      NS,
      SECTION_ID,
      SETTINGS_KEY,
      defaultSettings,
      sanitizeSettings,
      clampMinutes,
      mount,
      apply: (ctx) => mount(ctx, require("react")),
    };
  },
});
