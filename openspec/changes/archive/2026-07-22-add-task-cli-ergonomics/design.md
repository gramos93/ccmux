## Context

`src/commands/task.ts` shipped in `add-task-spawn`. Three ergonomics gaps: `create` requires a `<project>` positional; its commander defaults (`--agent "claude"`, `--target "new-window"`) always send a value, so the server-side default cascade (`resolveTask` over config `defaults`) never sees an unset field and the config default is dead; and `run`/`rm` require the full UUID. All fixes are CLI-only — the daemon already resolves the cascade and takes full ids.

## Goals / Non-Goals

**Goals:** dir defaults to PWD (`-d/--dir` override); no CLI-forced agent/target so config `defaults` applies; `run`/`rm` accept a unique id prefix; `list` shows a short id.

**Non-Goals:** `--name`, `--bg`/invoke routing, per-agent adapters + `--` passthrough, completion generator — all in change #2 (`agent-adaptive-launch`). No daemon/route/model change.

## Decisions

**D1 — Dir via `-d/--dir`, default PWD; drop the positional.** `create` currently takes `<project>` (required) and the launcher uses it as the tmux `-c` cwd. Replace with `-d/--dir <path>` defaulting to `process.cwd()`, keeping project == the working dir (unified, as today). Send it as the `project` field in the create body.
- *Alternative — optional positional AND `-d`:* rejected; two ways to set one value is confusing. A single flag with a PWD default is clearest.

**D2 — Remove commander defaults for `--agent`/`--target`.** Drop the `"claude"`/`"new-window"` defaults; when the flag is absent, omit the field from the create body entirely. The daemon's `resolveTask` then fills `agent` from config `defaults.agent` (or the request), and `target` from its built-in `new-window`. Consequence to document: with no `--agent` and no config `defaults.agent`, create fails `400` ("agent required") — correct, since agent is genuinely required and now sourced from config-or-flag rather than a silent CLI default.

**D3 — CLI-side prefix resolution (`resolveTaskRef`).** `run`/`rm` call a helper that `GET /tasks`, filters `t.id.startsWith(ref)` (exact-id match short-circuits first), and: one match → its id; several → throw listing the candidate short ids; none → throw. The daemon stays strict (full id only), so resolution logic lives in one CLI helper and the wire contract is unchanged.
- *Alternative — server resolves a `{ref}` path segment:* rejected for this slice; it complicates the route and the strict-id contract for a purely cosmetic CLI convenience. Revisit only if a non-CLI client needs prefix lookup.

**D4 — Short id in `list`.** Print the first 8 chars of the UUID as the handle to type. No stored short id (no model change); prefix resolution makes any unambiguous length work.

## Risks / Trade-offs

- **A prefix can become ambiguous as tasks accumulate.** → Handled: ambiguous → error + list candidates; the user just types more chars. 8-char display is effectively collision-free at POC scale.
- **Removing CLI defaults surfaces a `400` when neither flag nor config supplies an agent.** → Intended and clearer than silently launching claude; the error message names the cause.

## Migration Plan

Pure CLI. No protocol/model change; old task files and daemon unaffected. `ccmux task create <project>` (old positional form) stops working — acceptable, the feature is days old and unreleased. Rollback = revert `src/commands/task.ts`.
