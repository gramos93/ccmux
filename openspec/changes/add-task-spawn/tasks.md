## 1. Data model + store patch

- [x] 1.1 Add optional `paneId?: string` and `sessionId?: string` to `TaskInstance` (`src/lib/task.ts`) — link fields set post-launch, not part of `TaskSpec`
- [x] 1.2 Add `patchTask(id, patch: Partial<Pick<TaskInstance, "status" | "paneId" | "sessionId">>)` to `src/lib/task-store.ts`: single-file read-modify-write, merge fields, refresh `updatedAt`, return instance or undefined
- [x] 1.3 Re-express `updateTaskStatus(id, status)` via `patchTask(id, { status })` to avoid two writers

## 2. Task launcher (`src/daemon/task-launcher.ts`)

- [ ] 2.1 Pure `buildTaskCommand(task, agentBinary)`: agent binary + single-quote-escaped `--prompt '<prompt>'` (reuse the `handleSpawn` escaping idiom)
- [ ] 2.2 Define `TaskLauncherDeps` = `{ getAgentByType, spawn, prefs }` and `launchTask(task, deps): Promise<{ paneId?: string }>`
- [ ] 2.3 `new-window`/`split`: `tmux new-window|split-window -c <cwd> -P -F '#{pane_id}'`, capture pane id, `send-keys` the command, return `{ paneId }`
- [ ] 2.4 `send-to-existing`: require `targetRef`; `send-keys` the prompt into it; return `{}` (no created pane)
- [ ] 2.5 Reject `new-session` (and any unknown target) with a clear error

## 3. TaskManager.run + correlation (`src/daemon/task-manager.ts`)

- [ ] 3.1 Add an injected launcher dep (constructor option, default = the real `launchTask` bound to real deps); keep `new TaskManager()` working
- [ ] 3.2 Add `pendingCorrelation: Map<string, string>` (paneId → taskId)
- [ ] 3.3 `run(id)`: get task (undefined → caller maps 404); call the launcher; on a created pane record `paneId` via `patchTask` and add to `pendingCorrelation`; set status `running`; emit `updated`
- [ ] 3.4 `run` for `send-to-existing`: after launch, correlate immediately against `targetRef` (see 3.5) rather than adding a pending entry
- [ ] 3.5 `correlateSession(paneId, sessionId)`: if `paneId` is in `pendingCorrelation`, `patchTask(taskId, { sessionId })`, delete the entry, emit `updated`; no-op otherwise

## 4. Server route + backfill (`src/daemon/server.ts`)

- [ ] 4.1 Add `POST /tasks/{id}/run` route (suffixed, before the generic `/tasks/{id}` routes)
- [ ] 4.2 `handleRunTask`: 404 when the task is missing; 400 on `new-session`/missing `targetRef`/launch error; 200 `{ success: true, task }` on launch
- [ ] 4.3 Add `backfillTaskLink(session)` calling `taskManager.correlateSession(session.tmuxPane, session.id)`; invoke it in `sessionEventToSSE` wherever `backfillInvocationLink` is called (visible created/updated)

## 5. CLI (`src/commands/task.ts`)

- [ ] 5.1 `createTaskCommand()` with subcommands `list`, `create <project> [--agent] [--prompt] [--template] [--target] [--run]`, `run <id>`, `rm <id>`; each calls `ensureDaemon()` then `fetch` the `/tasks` endpoints (model on `spawn`/`invoke`)
- [ ] 5.2 Register the command in `src/index.ts`

## 6. Tests

- [ ] 6.1 Store: `patchTask` merges fields + refreshes `updatedAt` + preserves others; patch-missing → undefined; `updateTaskStatus` still works (regression)
- [ ] 6.2 Launcher: `buildTaskCommand` escaping; `launchTask` new-window/split issues the right tmux args and returns the captured pane id (inject a fake spawn); `send-to-existing` requires `targetRef`; `new-session` rejected
- [ ] 6.3 Manager: `run` records `paneId` + status `running` + emits `updated` (inject a fake launcher); `correlateSession` links a pending pane and emits `updated`; unrelated pane is a no-op; `run` of a missing id returns undefined
- [ ] 6.4 Server: `POST /tasks/{id}/run` → 404 missing, 400 new-session, 400 send-to-existing without targetRef, 200 happy path (inject/stub launcher via the manager); `backfillTaskLink` links a task when a session event carries the matching pane
- [ ] 6.5 CLI smoke (unit-level): `create --run` posts create then run; `list`/`rm` hit the right endpoints (can mock fetch or assert URL building)

## 7. Verification

- [ ] 7.1 `bun run typecheck` passes
- [ ] 7.2 `bun test` passes (new suites included)
- [ ] 7.3 End-to-end smoke on an isolated daemon (temp `$CCMUX_HOME`/`$CCMUX_STATE_HOME`, `CCMUX_PORT`, inside a detached tmux session): `ccmux task create <proj> --agent claude --prompt '...' --run` (or curl `POST /tasks` then `/run`) creates a real pane, records `paneId`, and once a session binds, the task's `sessionId` is back-filled; an SSE client sees `task_updated`
- [ ] 7.4 Confirm no TUI renderer components changed; worktree/keymap untouched; only the launch + correlation + CLI surface added
