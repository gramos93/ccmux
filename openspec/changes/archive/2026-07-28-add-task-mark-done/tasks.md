## 1. Daemon: resume accepts done

- [x] 1.1 `src/daemon/task-manager.ts` `resume()`: widen the status gate from `status !== "stopped"` to reject only when status is neither `stopped` nor `done` (keep the existing `nativeSessionId` + resumable-agent gates and the 404/400 behavior).
- [x] 1.2 Tests (`task-manager.test.ts`): resume a `done` task with a `nativeSessionId` → relaunches, status → `running`, `updated` emitted; resume a `done` task **without** a `nativeSessionId` → still rejected (no nativeSessionId gate); `pending`/`running`/`failed` still rejected.

## 2. Activation: done is revivable

- [x] 2.1 `src/tui/utils/task-create.ts` `resolveTaskActivation`: add a `done` arm — `resume` when `task.nativeSessionId` is set, else `run`.
- [x] 2.2 Tests (`task-create.test.ts`): done + nativeSessionId → `{kind:"resume"}`; done + no nativeSessionId → `{kind:"run"}`; existing pending/stopped/running/failed cases unchanged.

## 3. Board action + keybind

- [x] 3.1 `src/tui/App.tsx`: add `markDoneSelectedTask()` — POST `done` to `/tasks/{id}/status` for `selectedTask()`; no confirmation, no optimistic mutation (row updates via `task_updated`).
- [x] 3.2 `src/tui/App.tsx` task-view key branch: bind `d` → `markDoneSelectedTask()` (leave `ctrl-d` preview-scroll intact). Confirm `runOrResumeSelectedTask` already routes the new `done`→run/resume activation (it dispatches `run`/`resume` kinds).
- [x] 3.3 `src/tui/components/Footer.tsx`: add `d done` to the task-view footer (fit on one line).

## 4. Tests + verify

- [x] 4.1 `Footer.test.tsx`: task-view footer contains `d done`.
- [x] 4.2 `bun run typecheck` and full `bun test` green.
- [x] 4.3 Render/behavior verification in a detached tmux session (per AGENTS.md): on the board, `d` on a running/stopped task → it moves to a `done` group and stays listed; select the done task and press enter/`r` → it revives (resume when it has a session, else run) and returns to `running`. Clean up any throwaway tasks afterward (delete by explicit id — never an empty ref).