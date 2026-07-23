## Why

The task store (`add-task-store`) is pure data with no way to reach it from a running system. The daemon is the single process that owns runtime state and the only writer other slices (TUI, spawn) can talk to. This change puts the task store behind the daemon's HTTP API and live SSE stream — the second slice of the launch/track plane — so the TUI and CLI can create, list, update, and delete tasks and observe changes in real time. It follows the exact `InvocationManager` → `DaemonServer` → SSE template the fork identified as the reference model.

## What Changes

- Add a `TaskManager` daemon module (`src/daemon/task-manager.ts`, `extends EventEmitter`) over `src/lib/task-store.ts`: `list` / `get` / `create` / `updateStatus` / `delete`, emitting a discriminated `"change"` event after every mutation. The store stays the sole persistence layer; the manager adds the lifecycle event that SSE needs. Modeled on `InvocationManager`.
- Add HTTP routes to `src/daemon/server.ts` (method set constrained to the daemon's existing `GET`/`POST`/`DELETE`):
  - `GET /tasks` — list
  - `GET /tasks/{id}` — get by id (404 if absent)
  - `POST /tasks` — create; the daemon runs the default cascade (`resolveTask`) server-side from global `defaults` → per-project override → named `template` → request input, then persists
  - `POST /tasks/{id}/status` — update status (400 on unknown status, 404 if absent)
  - `DELETE /tasks/{id}` — delete (idempotent)
- Add three SSE event types — `task_created`, `task_updated`, `task_removed` — across the three files the protocol spans: `src/types/events.ts` (union + interfaces), `src/daemon/server.ts` (map manager `"change"` → SSE + broadcast, and add a `tasks` snapshot to the `init` frame for reconnect reconciliation), and `src/tui/utils/sse.ts` (`SSECallbacks` + `dispatchSSEEvent` arms).
- Wire `TaskManager` into `src/daemon/index.ts` (construct it, pass it as a new positional arg into the `DaemonServer` constructor, subscribe-and-broadcast in the server ctor).

Non-goals (later slices): spawn/pane correlation (capturing `#{pane_id}` for a created task), the TUI launch/board view, and the keymap mirror.

## Capabilities

### New Capabilities
- `task-api`: The daemon-facing task plane — the `TaskManager` lifecycle wrapper, the `/tasks` HTTP CRUD endpoints (including server-side cascade resolution on create), and the `task_created` / `task_updated` / `task_removed` SSE events plus the `init`-frame task snapshot.

### Modified Capabilities
<!-- None. This consumes the `task-store` capability's data model and store API without changing its requirements. -->

## Impact

- **New code:** `src/daemon/task-manager.ts`, a `TaskManager`↔SSE mapper in `server.ts`, `/tasks` route handlers in `server.ts`.
- **Modified code:** `src/types/events.ts` (new event types + `InitEvent.tasks`), `src/daemon/server.ts` (routes, ctor arg, subscribe/broadcast, init snapshot), `src/tui/utils/sse.ts` (callbacks + dispatch arms), `src/daemon/index.ts` (construct + wire `TaskManager`).
- **Consumes (unchanged):** `src/lib/task-store.ts`, `src/lib/task.ts` (`resolveTask`, `validateNewTask`), `getPreferences()` for the cascade config.
- **Protocol:** additive SSE event types; existing consumers ignore unknown types, and the added `init.tasks` field is optional. No breaking change.
- **Dependencies:** none added.
