## Context

The task store landed as pure data (`add-task-store`): `src/lib/task-store.ts` (per-file persistence at `~/.ccmux/tasks/<id>.json`) + `src/lib/task.ts` (`resolveTask`, `validateNewTask`). Nothing in a running system can reach it. The daemon is the single owner of runtime state and the only writer the TUI/CLI talk to over HTTP + SSE (`Bun.serve` in `src/daemon/server.ts`, consumed by `src/tui/utils/sse.ts`).

The `InvocationManager` → `DaemonServer` → SSE chain is the established template for a lifecycle resource: a manager holds/owns the resource and emits a discriminated `"change"` event; the server is dumb transport that maps that event to an `SSEEvent` and broadcasts it, and exposes read/write HTTP endpoints that call into the manager. This change reproduces that shape for tasks.

Key constraints from the codebase and AGENTS.md:
- The SSE protocol spans **three** files and must be changed together: `src/types/events.ts` (shared union + interfaces), `src/daemon/server.ts` (emit), `src/tui/utils/sse.ts` (consume). AGENTS.md calls out server.ts + sse.ts explicitly; the shared types file is the third leg both import.
- A new daemon module MUST be wired into `src/daemon/index.ts` (constructed and passed into the server) or it is unreachable.
- HTTP dispatch is a flat `if`-ladder on `path` + `method`; suffixed routes must precede the generic `/{id}` catch-all. CORS advertises only `GET, POST, DELETE, OPTIONS` — there is no `PATCH`.

## Goals / Non-Goals

**Goals:**
- A `TaskManager` (`EventEmitter`) over the store, emitting one discriminated `"change"` per mutation, with subscriber isolation (a throwing subscriber can't corrupt a mutation).
- `/tasks` CRUD wired into the server, with cascade resolution performed server-side on create.
- `task_created` / `task_updated` / `task_removed` SSE events end-to-end (types → emit → dispatch), plus a `tasks` snapshot on the `init` frame.
- `TaskManager` wired into `index.ts` and the `DaemonServer` ctor.
- Tests for the manager, the handlers, and the SSE dispatch arms.

**Non-Goals:**
- Spawn/pane correlation (capturing `#{pane_id}` for a task), TUI board view, keymap mirror.
- Changing `task-store`/`task.ts` requirements or the store's on-disk format.
- An in-memory task cache in the daemon (store reads are the source of truth this slice).

## Decisions

**D1 — `TaskManager` is a thin EventEmitter over the store; no in-memory index.** It wraps `listTasks`/`getTask`/`createTask`/`updateTaskStatus`/`deleteTask` and, after each successful mutation, emits `"change"` with a discriminated `TaskManagerEvent`:
`{ kind: "created" | "updated"; task: TaskInstance }` or `{ kind: "removed"; id: string }`. Emission uses a `safeEmit` wrapper (try/catch around `this.emit`) mirroring `InvocationManager.safeEmit`, so a throwing SSE subscriber cannot break persistence (which has already completed by emit time).
- *Alternative — hold an in-memory `Map` like `InvocationManager`:* rejected. `InvocationManager` is memory-only by nature; tasks are already persisted per-file and reads are cheap (`readdir` + N reads at POC scale). A cache would add coherence risk for no benefit. Revisit only if list latency is proven a problem.

**D2 — Routes and the response envelope.** Add to the `if`-ladder, suffixed-before-generic:
```
GET    /tasks               -> { tasks: TaskInstance[] }         200
POST   /tasks               -> { success, task } | error          200 create / 400 bad
POST   /tasks/{id}/status   -> { success, task } | error          200 / 400 / 404   (before the {id} catch-all)
GET    /tasks/{id}          -> TaskInstance                       200 / 404
DELETE /tasks/{id}          -> { success: true }                  200 (idempotent)
```
`GET /tasks` returns `{ tasks }` mirroring `{ invocations }`. Bodies are read with the `try { await req.json() } catch { return badRequest("Invalid JSON body") }` idiom. Status update uses `POST .../status` because the method set has no `PATCH`. Get-missing → `404`; update-missing → `404` (the store's `updateTaskStatus` returns `undefined`); delete is idempotent → always `200` (the store treats a missing file as non-error). Create/status validation failures → `400`.
- *Alternative — `PATCH /tasks/{id}`:* rejected; not in the daemon's advertised methods, and adding it means touching the CORS allow-list for no gain over `POST .../status`.

**D3 — Create resolves the cascade server-side.** `POST /tasks` body is `{ project: string; template?: string } & Partial<TaskSpec>` (the remaining fields are the creation-time `input` layer). The handler loads `getPreferences()`, calls `resolveTask({ defaults, projects, templates }, { project, template, input })`, then `createTask(resolved)` (which itself calls `validateNewTask`, rejecting `new-session`). This keeps the cascade a single server-owned source of truth rather than trusting a client to pre-fold it, matching "the daemon owns the lifecycle."
- *Alternative — client sends a fully-resolved `TaskSpec`:* rejected; it duplicates cascade logic in every client and lets a client bypass project/template policy.

**D4 — SSE tri-file change, flat envelope.** Following the existing convention (no `event:` line; discriminator is the `type` field; flat top-level fields, no nested `data`):
- `src/types/events.ts`: add `task_created`/`task_updated`/`task_removed` to `SSEEventType`; add `TaskCreatedEvent`/`TaskUpdatedEvent` (`task: TaskInstance`) and `TaskRemovedEvent` (`id: string`), each `extends BaseSSEEvent`; add them to the `SSEEvent` union; add optional `tasks?: TaskInstance[]` to `InitEvent`.
- `src/daemon/server.ts`: a pure `taskEventToSSE(event: TaskManagerEvent): SSEEvent` mapper (mirroring `invocationEventToSSE`); subscribe to the manager's `"change"` in the ctor and `broadcastEvent(taskEventToSSE(e))`; populate `init.tasks` from `taskManager.list()` in `handleSSE`.
- `src/tui/utils/sse.ts`: add `onTaskCreated?/onTaskUpdated?/onTaskRemoved?` to `SSECallbacks` and matching `case` arms in the pure `dispatchSSEEvent`.

**D5 — Wiring in `index.ts`.** Declare `private taskManager: TaskManager;`, construct it in the ctor, and add it as a new **positional** arg to the `DaemonServer` constructor (extending the ctor signature and storing it as a field alongside `invocationManager`). The server ctor subscribes-and-broadcasts. This satisfies the AGENTS.md rule that new daemon modules are wired in `index.ts`.

**D6 — Validation error mapping.** `validateNewTask` throws `Error` with a message. The create handler catches it and returns `400` with `{ success: false, message }` (protocol-shaped like `handleInvoke`'s `badRequest`). Status update validates the incoming status against `VALID_TASK_STATUSES` before calling the store; unknown → `400`.

## Risks / Trade-offs

- **No in-memory index → `GET /tasks` and the `init` snapshot do disk reads on every call.** → Negligible at POC scale; `listTasks` already skips malformed files. If a hot path emerges, add a cache behind the same `TaskManager` API without touching callers.
- **`init.tasks` grows the connect frame.** → Bounded by task count (ephemeral, deleted on done); matches the existing `invocations` snapshot precedent, so no new pattern.
- **Broadcast carries the full `TaskInstance` (includes `prompt`).** → Same exposure as sessions/invocations already broadcast over loopback-only SSE; the server's DNS-rebind + cross-origin guards already gate the endpoint. No new surface.
- **Three-file SSE edits can drift (add a type in one file, forget another).** → Typecheck catches the union/interface half; a dispatch-arm test and a manager→SSE mapper test cover the emit/consume halves.

## Migration Plan

Additive. New routes and event types only; `init.tasks` is optional so existing SSE consumers are unaffected, and unknown event types are already ignored by `dispatchSSEEvent`. No protocol version bump, no on-disk format change. Rollback = revert; the store and its files are untouched.

## Open Questions

- Should `POST /tasks/{id}/status` be the only mutation, or should a general `POST /tasks/{id}` (patch arbitrary fields) exist? Deferred — status is the only field the next slices need to mutate; arbitrary patch can be added when a use case appears.
