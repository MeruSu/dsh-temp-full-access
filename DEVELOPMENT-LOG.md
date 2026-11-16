# Development Log

## 0.1.0 — 2026-11-17

- **用户原话**：写个小插件，开启 full-access 之后一定时间后自动把权限调回到工作区修改；需要设置页、可选择自动撤回的时间。
- **查到的事实**（契约证据，全部实读原文）：
  - 权限读写是宿主 Cordis service `permissionPresets`：`ctx.get('permissionPresets').current(session)` 读当前有效预设（`'read-only' | 'workspace-write' | 'danger-full-access'`，另有 `'auto'`/`'custom'`），`ctx.get('permissionPresets').set(session, name)` 写——`dsh-tool-cordis/lib/types/api-catalog.js:2094-2137`（`current` 在 `:2112`、`set` 在 `:2132`）。
  - 会话列表：`ctx.get('sessions').list(): Session[]`——`api-catalog.js:3084-3147`（`list()` 在 `:3136`）。
  - 真实调用样本：`dsh-subagent/lib/index.js:410` → `parent.ctx.get("permissionPresets")?.current(parent.session)`；第三方 `dsh-sidechat/lib/index.js:4683-4684` → `.current(...)` + `.set(...)` + `.names.includes(...)`。
  - 浏览器半段拿不到 `set`（目录里只有 `catalog()` 是 @Remote），所以写权限只能在宿主做；反馈通道用 `/temp-full-access/status|config` 两条 marker-gated 路由（照 better-notice 的 webServer 前缀模式）。
- **已做**：宿主 2s 轮询 + 每会话 deadline（进入 full-access 起表、手动改回即删、再进重置、到点 `set(session,'workspace-write')`）；设置页开关（默认开）+ 1–120 分钟（默认 10）+ 倒计时行 + 撤回 toast；纯模型 `lib/schedule.js` 供宿主与测试共用；10 组单测（每组都用 `cangku/tmp/tfa-probe.mjs` 证明能红）；本地闸门 `cangku/tmp/261117_gate_temp_full_access.mjs`。
- **不许再动**：不做 per-workspace 例外、不做历史、不做通知音效；浏览器半段不许直接碰 `permissionPresets`（只能走宿主路由）；计时口径 = 最后一次进入 `danger-full-access` 起算，宿主重启后不保留在途计时（重新开始）。
