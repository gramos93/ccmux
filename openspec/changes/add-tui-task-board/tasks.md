## 1. Store: tasks slice + view (`src/tui/store.ts`)

- [x] 1.1 Add `tasks: TaskInstance[]` to `TUIState` and init `tasks: []` in `createStore`
- [x] 1.2 Add actions `setTasks`/`addTask`/`updateTask` (replace-by-`id` via `findIndex`)/`removeTask` (filter by `id`), mirroring the session actions
- [x] 1.3 Add `reconcileTasks(snapshot)` copying the `reconcileInvocations` shape (wholesale replace)
- [x] 1.4 Add `view: "sessions" | "tasks"` to `TUIState` (default `"sessions"`) + a `toggleView`/`setView` action

## 2. SSE wiring (`src/tui/App.tsx` + `src/tui/utils/sse.ts`)

- [x] 2.1 `sse.ts`: extend `onInit` to `(sessions, activePaneId, invocations, tasks?)` and pass `event.tasks` from the `init` dispatch arm
- [x] 2.2 `App.tsx`: in the `SSEClient` literal add `onTaskCreated`→`addTask`, `onTaskUpdated`→`updateTask`, `onTaskRemoved`→`removeTask`
- [x] 2.3 `App.tsx`: `onInit` calls `store.actions.reconcileTasks(tasks ?? [])`

## 3. Components (`src/tui/components/`)

- [x] 3.1 Add a task-status color helper (`pending→overlay, running→peach, stopped→yellow, done→green, failed→red`), shaped like `getStatusColor`
- [x] 3.2 `TaskRow.tsx`: short id + status badge + agent (`agentColorFor`) + project basename; for a `running` task, join `getSessionById(task.sessionId)` and render its `<StatusBadge>` activity (blank when unlinked)
- [x] 3.3 `TaskBoard.tsx`: flat list over `store.state.tasks` with `j/k` selection and an empty state; mirror `SessionList`/`SessionItem` styling

## 4. View branch + keybinds (`src/tui/App.tsx`)

- [x] 4.1 Branch the middle region on `store.state.view`: `<TaskBoard>` when `"tasks"`, else `<SessionList>`
- [x] 4.2 Add `t` to toggle the view
- [x] 4.3 Add a task-view guard in `useKeyboard` (early `if (view === "tasks") { … return }`) handling `j/k` nav, `enter`/`r` resume (stopped only), `x` delete, `t` back
- [x] 4.4 Resume/delete actions: fire-and-forget `POST ${getDaemonUrl()}/tasks/${id}/resume` / `DELETE ${getDaemonUrl()}/tasks/${id}` (no optimistic store mutation)

## 5. Tests

- [x] 5.1 Store: task actions (add/update-by-id/remove) + `reconcileTasks` replace; add a `mockTask` helper to `test-helpers.tsx`
- [x] 5.2 `sse.ts`: `dispatchSSEEvent` `init` forwards `tasks` to `onInit` (extend the existing dispatch test)
- [x] 5.3 `TaskRow` (`testRender`): renders id/status/agent/project; a running task with a joined session shows live activity; a stopped task shows a resumable indicator
- [x] 5.4 `TaskBoard` (`testRender`): renders rows from store tasks; empty state when none

## 6. Verification

- [ ] 6.1 `bun run typecheck` passes
- [ ] 6.2 `bun test` passes (new suites included)
- [ ] 6.3 **Renderer check (mandatory, AGENTS.md):** launch `ccmux picker` in a detached tmux session (`tmux new-session -d -s ccmux-verify -x 200 -y 50`), create a couple of tasks (one running, one stopped) via the daemon, toggle to the board with `t`, and `capture-pane` to confirm rows render (status colors, agent, live-activity for running, short id) and the empty state reads well; resize to a narrow viewport and re-capture. Tear down the session.
- [ ] 6.4 Confirm no daemon/protocol changes (TUI-only slice)
