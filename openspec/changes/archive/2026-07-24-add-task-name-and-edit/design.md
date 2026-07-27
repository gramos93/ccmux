## Context

`TaskSpec` (`src/lib/task.ts`) has no human-readable label — `id` is the only identity, and the board renders `id.slice(0,8)`. The daemon exposes create / `POST /{id}/status` / `run` / `resume` / delete (`src/daemon/server.ts`); `task-store.patchTask` can only touch `status` and the link fields (`paneId`/`sessionId`/`nativeSessionId`/`invocationId`), so there is no way to change a `pending` task's `prompt`/`agent`/etc. The cascade resolver (`resolveTask`) folds `defaults → projects[project] → template → input`. SSE already broadcasts `task_updated` with the full instance. A stale requirement in `task-api` (and a stale doc comment in `task-store.ts:81`) still claim a `new-session` create is rejected `400`; `validateNewTask` in fact accepts it.

This slice adds the data + API primitives (name, edit) that the TUI slices depend on. No TUI work here.

## Goals / Non-Goals

**Goals:**
- An optional, human-readable `name` on every task, with a friendly non-id default.
- A field-edit path for `pending` tasks (name + all spec fields), re-validated, event-broadcast.
- Reconcile the obsolete `new-session`-rejection spec/comment.
- No migration; existing persisted tasks keep working and never show a raw id.

**Non-Goals:**
- Editing non-`pending` tasks (running/stopped/done/failed) — deferred.
- Any TUI change (board rows, detail pane, edit form) — slices B and C.
- Re-running the create cascade on edit (cascade is a create-time concern).
- A PATCH verb (kept out of the documented GET/POST/DELETE method set — see D3).

## Decisions

### D1: `name` is an optional, cascade-foldable spec field
`TaskSpec.name?: string` folds through the resolver like other fields (a template/default MAY supply a name pattern). It is display-only text — no charset constraints. **Rationale:** consistent with how every other spec field is layered; lets a template name a family of tasks.

### D2: Derive + persist a default name at creation; read-time fallback for legacy
A pure `deriveTaskName(spec)` (first non-empty prompt line, whitespace-collapsed, capped ~50 chars with ellipsis; else the `command`'s head; else `"task"`). `createTask` sets `name` to the derived value when the resolved name is empty, so the name is **persisted once** and every consumer (CLI `task list`, API, board) sees the same string without reimplementing derivation. A `taskDisplayName(task)` helper returns `task.name ?? deriveTaskName(task)` for tasks persisted before this change (no migration, no rewrite-on-load). **Alternative considered:** derive purely at display and never persist — rejected: CLI/API responses would each need the helper and names could drift if the derivation changes.

### D3: Edit via `POST /tasks/{id}/edit`
A new sub-action endpoint, mirroring `POST /tasks/{id}/status|run|resume`, takes a JSON partial and applies it. **Rationale:** stays inside the spec's documented `GET`/`POST`/`DELETE` method set and matches the existing verb-suffix convention; introducing `PATCH` would widen the method contract for one route. **Alternative considered:** `PATCH /tasks/{id}` — semantically cleaner but breaks the stated method set and the established sub-action pattern.

### D4: Only `pending` tasks are editable
The manager rejects an edit of a non-`pending` task with `409 Conflict` (distinct from `400` malformed and `404` missing). **Rationale:** a launched task owns a pane/session and possibly a `nativeSessionId`; editing its spec would desync the live pane. `pending` has not launched, so all spec fields are safe. **Trade-off:** editing a `stopped` task's prompt before resume would be handy — noted as a future extension, not blocked by this shape.

### D5: Edit = merge editable subset → re-validate → persist
The endpoint picks only the editable fields (`name`, `prompt`, `agent`, `project`, `target`, `targetRef`, `worktree`, `command`) from the body — `id`, `status`, timestamps, and link fields are ignored. It merges them onto the stored spec and runs `validateNewTask` on the merged result, so all creation invariants still hold (e.g. can't blank the prompt unless a `command` is present; unknown target rejected). A failed merge yields `400` and persists nothing; success bumps `updatedAt`, persists, and broadcasts `task_updated`. Store support is a new `editTask(id, patch)` in `task-store` (leaving `patchTask` as the link/status path).

### D6: Remove the stale new-session rejection
Delete the `task-api` "Reserved target rejected over HTTP" requirement/scenario and fix the `task-store.ts` doc comment. `validateNewTask` already accepts `new-session`; the create-cascade requirement's parenthetical about "rejecting the reserved new-session target" is updated to plain validation.

## Risks / Trade-offs

- **Editing `project`/`target` of a pending task** → safe (not launched); the next `run` uses the new values.
- **Edit vs. run race** → the `pending` gate resolves it: once `run` flips status to `running`, a late edit `409`s rather than corrupting a live task.
- **A derived name that changes if `deriveTaskName` is later tweaked** → avoided by persisting the name at creation (D2); only legacy rows use the live fallback.
- **Clearing `name` on edit** → re-derives on display via `taskDisplayName` (never shows a raw id).

## Migration Plan

Additive: a new optional field, a new endpoint, a new store method. Existing task JSON is untouched and reads back through `taskDisplayName`. No config/SSE change. Rollback = revert the field, endpoint, and store method.

## Open Questions

- Should `stopped` also be editable (prompt-only) to tweak before resume? Deferred; D4's shape allows widening the editable-status set later without an API change.
