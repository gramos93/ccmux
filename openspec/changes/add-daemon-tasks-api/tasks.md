## 1. SSE event types (`src/types/events.ts`)

- [x] 1.1 Add `task_created`, `task_updated`, `task_removed` to the `SSEEventType` string union
- [x] 1.2 Add `TaskCreatedEvent`/`TaskUpdatedEvent` (`task: TaskInstance`) and `TaskRemovedEvent` (`id: string`), each `extends BaseSSEEvent`; import `TaskInstance` from `../lib/task`
- [x] 1.3 Add the three interfaces to the `SSEEvent` union
- [x] 1.4 Add optional `tasks?: TaskInstance[]` to `InitEvent`

## 2. Task lifecycle manager (`src/daemon/task-manager.ts`)

- [x] 2.1 Define `TaskManagerEvent` = `{ kind: "created" | "updated"; task: TaskInstance } | { kind: "removed"; id: string }`
- [x] 2.2 `class TaskManager extends EventEmitter` with `list()`, `get(id)`, delegating to the store
- [x] 2.3 `create(body)`: load `getPreferences()`, `resolveTask({defaults,projects,templates}, {project, template, input})`, `createTask(resolved)`, emit `{kind:"created", task}`
- [x] 2.4 `updateStatus(id, status)`: `updateTaskStatus`; emit `{kind:"updated", task}` when it returns an instance; return undefined when absent (no emit)
- [x] 2.5 `delete(id)`: `deleteTask(id)`; emit `{kind:"removed", id}`
- [x] 2.6 Add a `safeEmit` wrapper (try/catch around `this.emit("change", event)`) mirroring `InvocationManager.safeEmit`

## 3. HTTP routes + manager→SSE mapper (`src/daemon/server.ts`)

- [x] 3.1 Accept a `TaskManager` as a new positional ctor arg; store it as a field alongside `invocationManager`
- [x] 3.2 Add a pure `taskEventToSSE(event: TaskManagerEvent): SSEEvent` mapper (mirror `invocationEventToSSE`)
- [x] 3.3 In the ctor, subscribe to `taskManager.on("change", e => this.broadcastEvent(taskEventToSSE(e)))`
- [x] 3.4 In `handleSSE`, populate `init.tasks` from `taskManager.list()`
- [x] 3.5 Add routes to the `if`-ladder, suffixed-before-generic: `GET /tasks`, `POST /tasks`, `POST /tasks/{id}/status`, `GET /tasks/{id}`, `DELETE /tasks/{id}`
- [x] 3.6 `handleGetTasks` → `{ tasks }` (200); `handleGetTask` → instance (200) or 404
- [x] 3.7 `handleCreateTask`: JSON body try/catch → 400; call `taskManager.create`; map a `validateNewTask` throw (incl. `new-session`) → 400 `{success:false,message}`; success → 200 `{success:true, task}`
- [x] 3.8 `handleUpdateTaskStatus`: validate status ∈ `VALID_TASK_STATUSES` (→400); call `updateStatus`; 404 when undefined; 200 `{success:true, task}` otherwise
- [x] 3.9 `handleDeleteTask`: call `delete`; return 200 `{success:true}` (idempotent)

## 4. SSE consumer (`src/tui/utils/sse.ts`)

- [x] 4.1 Add `onTaskCreated?`, `onTaskUpdated?`, `onTaskRemoved?` to `SSECallbacks`
- [x] 4.2 Add `case "task_created"/"task_updated"/"task_removed"` arms to `dispatchSSEEvent`

## 5. Wiring (`src/daemon/index.ts`)

- [x] 5.1 Declare `private taskManager: TaskManager;` and construct it in the daemon ctor
- [x] 5.2 Pass `taskManager` into the `DaemonServer` constructor call (new positional arg matching 3.1)

## 6. Tests

- [ ] 6.1 `task-manager.test.ts`: create/update/delete emit the correct discriminated `"change"` events; update-missing returns undefined and does not emit; a throwing subscriber does not break the mutation (use temp `$CCMUX_STATE_HOME` + injected clock)
- [ ] 6.2 Manager create runs the cascade: template+defaults+input fold reflected in the persisted task; a resolved `new-session` target throws
- [ ] 6.3 `taskEventToSSE` mapper: each `TaskManagerEvent` kind maps to the right SSE `type` with the right payload
- [ ] 6.4 `dispatchSSEEvent` arms: `task_created`/`task_updated`/`task_removed` invoke the matching callback; unknown type is ignored (extend existing sse dispatch test)
- [ ] 6.5 HTTP handler tests (or exercise handlers directly): list shape, get 404, create 400 on bad JSON, create 400 on `new-session`, status 400 on unknown status, status 404 on missing id, delete idempotent

## 7. Verification

- [ ] 7.1 `bun run typecheck` passes
- [ ] 7.2 `bun test` passes (new suites included)
- [ ] 7.3 End-to-end smoke: with the daemon running, `POST /tasks` then `GET /tasks` returns it, `POST /tasks/{id}/status` updates it, `DELETE /tasks/{id}` removes it, and an SSE client observes `task_created`/`task_updated`/`task_removed` (curl the daemon on port 2269)
- [ ] 7.4 Confirm no TUI renderer components changed (only `sse.ts` on the TUI side); no spawn/keymap files touched
