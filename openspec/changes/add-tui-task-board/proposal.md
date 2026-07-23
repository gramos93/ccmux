## Why

Tasks are fully wired on the daemon (CRUD, SSE, run/resume, correlation) but **invisible in the TUI** — the task SSE callbacks and the `init.tasks` snapshot are declared yet never consumed, and there's no view to see or act on tasks. This change surfaces them: a task board in the picker/sidebar TUI that lists tasks with their lifecycle status, borrows the linked agent's live activity for running tasks, and lets you resume a `stopped` task with one key. It's the "pick up where you left off" surface the lifecycle work was building toward — and the first slice that re-enters the renderer.

## What Changes

- **Store: a `tasks` slice.** Add `tasks: TaskInstance[]` to the TUI store with `setTasks`/`addTask`/`updateTask`/`removeTask` (keyed by `id`, mirroring the session actions) and a `reconcileTasks` that seeds from the `init` snapshot (modeled on `reconcileInvocations`).
- **Wire the task SSE path.** Pass `onTaskCreated`/`onTaskUpdated`/`onTaskRemoved` into the `SSEClient` (currently omitted), and extend `onInit` to also carry `event.tasks` (currently dropped) so the board hydrates on connect/reconnect.
- **A `view` toggle.** Add `view: "sessions" | "tasks"` to store state (additive; the launch-time `sidebar` boolean is untouched), toggled by a `t` keybind. When `view === "tasks"` the middle region renders a new `<TaskBoard>` instead of `<SessionList>`.
- **`TaskBoard` + `TaskRow` components.** A flat list showing short id, a task-status badge (own color map for `pending/running/stopped/done/failed`), the agent (reusing `agentColorFor`), the project, and — for `running` tasks — the linked session's live activity via a `sessionId → session` join rendered with the existing `StatusBadge`.
- **Board actions.** On a `stopped` row, `enter`/`r` resumes it (`POST /tasks/{id}/resume`, re-attach); `x` deletes a task (`DELETE /tasks/{id}`). `j/k` navigate. `--stopped`-style filtering isn't needed here — status is on every row.

Non-goals: resume-with-a-follow-up-prompt from the TUI (needs an input modal — CLI covers it), task creation from the TUI (CLI covers it), a full `sidebar → view` refactor, and a kanban/column layout (flat list for now).

## Capabilities

### New Capabilities
- `task-board`: the TUI task view — store `tasks` slice + SSE/init consumption, the `view` toggle, the `TaskBoard`/`TaskRow` rendering (status/agent/live-activity), and the resume/delete row actions.

### Modified Capabilities
<!-- None: the daemon capabilities (task-store/task-api/task-launch) are consumed unchanged. -->

## Impact

- **New code:** `src/tui/components/TaskBoard.tsx`, `TaskRow.tsx` (+ tests), a task-status color helper.
- **Modified code:** `src/tui/store.ts` (`tasks` slice + actions + `reconcileTasks` + `view` state/toggle), `src/tui/App.tsx` (SSE task wiring, `onInit` tasks, `view` render branch, keybinds, resume/delete fetch), `src/tui/utils/sse.ts` (`onInit` signature carries `tasks`; dispatch passes `event.tasks`).
- **Reused (unchanged):** `agentColorFor`, `StatusBadge`, `getSessionById`, `getDaemonUrl`, the `/tasks/{id}/resume` + `DELETE /tasks/{id}` endpoints.
- **Verification:** first renderer change → requires the detached-tmux `capture-pane` check per AGENTS.md, not just unit tests.
- **Dependencies:** none.
