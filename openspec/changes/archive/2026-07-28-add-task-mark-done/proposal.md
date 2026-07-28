## Why

The task board can run, resume, edit, clone, and delete tasks, but there is no way to mark a task **done** as a deliberate act. `done` exists in the lifecycle, yet today only a finished `background` invocation ever reaches it — an interactive task you've finished with can only be deleted (losing it) or left cluttering the active groups. Users want a **completion marker that is not a deletion**: the task stays on the board (in the `done` group) as a record and can still be revived — resumed or re-run — if more work is needed.

## What Changes

- **Mark-done action on the board.** A keybind sets the selected task's status to `done` via the existing `POST /tasks/{id}/status` endpoint. Unlike delete, it does **not** remove the task or tear down anything — the task stays on the board and moves to the `done` group (status grouping already renders it). No confirmation (non-destructive), no optimistic mutation; the `task_updated` broadcast relabels the row.
- **`done` is revivable.** Activating (enter) or the explicit run/resume action on a `done` task revives it: **resume** when it retains a `nativeSessionId` (re-attach the conversation), else **run** (relaunch fresh) — mirroring how `stopped` behaves. Reviving moves it back to `running`.
- **Resume accepts `done`.** The daemon's resume path is widened from `stopped`-only to `stopped` **or** `done` (both retain a `nativeSessionId` when interactive), so a done task can be resumed through `POST /tasks/{id}/resume`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-board`: adds a mark-done row action (status → `done`, no teardown) and makes `done` an actionable/revivable status (activate + run/resume treat it like `stopped`, resuming when a `nativeSessionId` is present, else running).
- `task-launch`: the resume endpoint accepts a `done` task in addition to a `stopped` one.

## Impact

- Code: `src/daemon/task-manager.ts` (`resume` gate `stopped` → `stopped | done`), `src/tui/utils/task-create.ts` (`resolveTaskActivation` handles `done`), `src/tui/App.tsx` (a `markDoneSelectedTask` action + a `d` keybind), `src/tui/components/Footer.tsx` (list `d done`). Tests alongside.
- No new endpoint or data-model change — `POST /tasks/{id}/status` already accepts `done` and the store already models it. `done` is not auto-terminal: teardown already leaves non-`running` tasks alone, so a manually-done task stays `done` until revived.
