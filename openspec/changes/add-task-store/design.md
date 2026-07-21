## Context

ccmux persists two kinds of state today, both under the config dir `~/.config/ccmux` (`$CCMUX_HOME`): user preferences (`ccmux.json`) and runtime UI state (`state.json`, via `src/lib/state.ts`). The fork adds a `Task` primitive that underpins all future launch/track features (spawn, board, templates). Task *instances* are ephemeral runtime data that should not live in the config dir, and mixing them with user-edited config invites the same read/write races `state.ts` already warns about.

This change is slice-1 steps 1–2: the data model, a new state home, the instance store, and the config-side surface. It is deliberately pure data — no daemon, HTTP/SSE, TUI, or tmux spawning — so it ships behind `bun test` with zero renderer risk and unblocks the daemon `/tasks` and TUI slices that follow.

## Goals / Non-Goals

**Goals:**
- One `Task` schema, two lifecycles (template = persistent/config, instance = ephemeral/state).
- A state home separate from the config dir, user-relocatable.
- A minimal, dependency-free instance store modeled on `state.ts` (JSON, degrade-to-empty).
- Config surface for `templates`, `projects`, `defaults` plus a pure default-cascade resolver.
- Full unit-test coverage of the store and the cascade.

**Non-Goals:**
- Daemon `/tasks` CRUD + SSE (next change; per AGENTS.md must touch both `server.ts` and `sse.ts`).
- Spawn/pane correlation (`#{pane_id}` capture), TUI launch/board view, keymap mirror.
- Relocating existing runtime state (`state.json`, markers, pid/log) out of the config dir.
- `new-session` target support.

## Decisions

**D1 — New env var `$CCMUX_STATE_HOME`, default `~/.ccmux`.** `$CCMUX_HOME` is already bound to the config dir in `src/lib/config.ts:137` (`~/.config/ccmux`), so it cannot double as the state home. Introduce a sibling resolver that reads `$CCMUX_STATE_HOME` at call time (mirroring the `getCcmuxDirPath()` pattern at `config.ts:158`, so tests can redirect it after import) and defaults to `~/.ccmux`.
- *Alternative — reuse config dir / add `state/` subdir:* rejected; the fork principle keeps config-only vs state separate, and the user explicitly wants `~/.ccmux`.
- *Alternative — honor `$XDG_STATE_HOME`:* rejected per the user's call — too rarely used; the single override plus a clean default is enough.

**D2 — Store shape: one file per instance, `~/.ccmux/tasks/<id>.json`.** Each mutation touches exactly one file: `createTask` writes `<id>.json` (lazy `mkdirSync(tasksDir, {recursive:true})` + `Bun.write`), `updateTaskStatus`/`getTask` read-modify-write a single file, `deleteTask` is an `unlink`, and `listTasks` is `readdir` + read each (each read try/catch'd so a malformed/absent file is skipped, degrading to empty). Chosen over a single `tasks.json` map: it isolates every write (no whole-map read-modify-write clobber when the daemon becomes a frequent per-task status writer next slice) and mirrors ccmux's own one-file-per-entity idioms — markers (`~/.config/ccmux/session-pids/<agent>-<id>.json`) and jobs (`jobs/<short>/state.json`). Delete-on-done is a trivial `unlink`, and the daemon slice can `fs.watch`/chokidar the `tasks/` dir for per-task SSE events, exactly as `HookManager` watches the markers dir.
- *Alternative — single `tasks.json` map (`id → TaskInstance`):* rejected. Simpler (one `Bun.write`, closest to `state.ts`) but every status update rewrites the whole map, so concurrent writers clobber and delete means a rewrite. `state.ts` holds one singleton blob, not a mutated collection — wrong analogy for tasks.
- *Alternative — SQLite:* rejected as premature for a POC store; per-file JSON matches existing conventions and adds no dependency.

**D3 — `Task` as one schema; template vs instance by placement, not by type.** A template is a `Task`-shaped preset stored in config (`Preferences.templates[name]`) with instance-only fields (`id`, timestamps, `status`) optional/absent. An instance is the same shape with those fields required, stored in the state home. This keeps a single source of truth for fields and lets the cascade treat every layer as a partial `Task`. Concretely: `TaskSpec` = the shared field set (`project`, `target`, `agent`, `prompt`, optional `targetRef`, optional `worktree`); `TaskTemplate = Partial<TaskSpec>`; `TaskInstance = TaskSpec & { id; createdAt; updatedAt; status }`.

Two field types are widened now (cheap, pure data) so no breaking schema change is needed when the spawn/worktree slices land:
- `worktree?: boolean | { branch?: string; base?: string }` — the object form carries the branch/base to name at creation, honoring the "name the worktree/branch when creating a task" intent even though wtm creation is a later slice.
- `targetRef?: string` — the pane/session id a `split` or `send-to-existing` target acts on. Modeled and persisted now; not behaviorally enforced this slice. `new-window` ignores it; `send-to-existing` will require it once spawn lands. (Kept a single string rather than a `paneId | sessionId` union — the referent's kind is implied by `target`, and over-modeling it now buys nothing.)

**D4 — Cascade is a pure per-field fold.** `resolveTask(project, templateName?, input)` folds `defaults → projects[project] → templates[templateName] → input`, each a `Partial<TaskSpec>`, later wins per field. Pure function, no I/O (callers pass in the loaded `Preferences`), so it is trivially testable and reusable by the future daemon/TUI. Built-in fallbacks (e.g. `target: "new-window"`, `status: "pending"`) apply only after the fold leaves a field unset.

**D5 — Types location.** Put the `Task` field types in `src/lib/task.ts` alongside the store, and the config-surface types (`TaskTemplate`, `ProjectConfig`, `TaskDefaults`) in `src/lib/preferences.ts` next to `Preferences` (extended at `preferences.ts:286`). `preferences.ts` imports the shared `TaskSpec` from `task.ts` to avoid duplication.

**D6 — Validation is minimal and local.** Reject the reserved `new-session` target and unknown `status` at create time; otherwise trust config shapes (consistent with how ccmux already treats `ccmux.json` as loosely validated). No schema library added.

**D7 — Injectable clock for deterministic timestamps.** `createTask`/`updateTaskStatus` stamp `createdAt`/`updatedAt` themselves, so `new Date()` inside them would make tests time-dependent (the repo convention is fixed timestamps like `"2024-01-15T12:00:00Z"`). Give the store an injectable clock: a module-level `now: () => string` (default `() => new Date().toISOString()`) that tests can override, so `createdAt`/`updatedAt` are deterministic and `updatedAt`-refresh can be asserted against exact values rather than relative ordering. This keeps production callers unchanged (they use the default) while making the timestamp tests non-flaky.
- *Alternative — assert only monotonic change (`updatedAt` after ≠ before):* weaker (can't pin exact values) and still needs care to avoid same-millisecond ties; the injectable clock is strictly better and trivially cheap.

## Risks / Trade-offs

- **Per-file layout → `listTasks` does N reads instead of one.** → Negligible at POC scale (dozens of ephemeral instances, deleted on done); and it buys write isolation (no whole-map clobber) plus cheap per-task watch/delete. Revisit only if task counts grow large enough that `readdir`+N-reads on every list is measurably slow.
- **A partially-written or malformed `<id>.json` could break a list.** → Each per-file read in `listTasks` is individually try/catch'd, so one bad file is skipped rather than failing the whole listing; writes use lazy `mkdirSync` + `Bun.write` (no read on the write path).
- **`~/.ccmux` is a new top-level dotdir users may not expect.** → It is documented, created lazily (never on read), and relocatable via `$CCMUX_STATE_HOME`.
- **Two type homes (`task.ts` + `preferences.ts`) could drift.** → `preferences.ts` imports `TaskSpec` from `task.ts` rather than redeclaring, so the shared field set has one definition.
- **Cascade semantics (per-field vs whole-object override) can surprise.** → Locked as per-field, later-wins, and pinned by explicit spec scenarios so behavior is test-enforced.

## Migration Plan

Additive only. No existing files move or change format; new `Preferences` keys are optional and default to undefined, so old `ccmux.json` files load unchanged. Rollback = revert the change; `~/.ccmux` (if created) is inert and can be deleted. No daemon or protocol version bump.

## Open Questions

- Store layout resolved: per-file `~/.ccmux/tasks/<id>.json` (see D2). The daemon slice reads this same dir and can watch it for per-task SSE events.
- Whether `defaults`/`projects`/`templates` should also be expressible per-project in a repo-local file later — out of scope now, but the cascade layering is designed to admit a project-local layer without reordering.
