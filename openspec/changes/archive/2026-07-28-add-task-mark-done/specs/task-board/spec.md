## MODIFIED Requirements

### Requirement: Task board row actions

From the task board the user SHALL be able to activate a row, explicitly run/resume the actionable statuses, mark a task `done`, edit a `pending` task, clone a task, and delete a task (behind a confirmation), each dispatched to the existing daemon endpoints. Activating (enter) a `pending` task SHALL run it; activating a `stopped` task SHALL resume it; activating a `done` task SHALL revive it — **resume** when it retains a `nativeSessionId`, otherwise **run**; activating a `running` task linked to a session SHALL jump to that session's pane (mirroring the session view's activate). The explicit run/resume action SHALL start a `pending` task (run), re-attach a `stopped` task (resume), revive a `done` task (resume when it has a `nativeSessionId`, else run), and SHALL do nothing for other statuses. Marking a task `done` SHALL set its status to `done` via the existing status endpoint (`POST /tasks/{id}/status`) **without** deleting it or tearing down any pane — the task stays on the board and moves to the `done` group; it needs no confirmation. Deleting a task SHALL first require an explicit confirmation naming the task; only on confirmation SHALL the TUI dispatch `DELETE` to the daemon, and cancelling SHALL leave the task untouched. The board SHALL NOT optimistically mutate the store; the resulting `task_updated`/`task_removed` broadcast updates the row.

#### Scenario: Run a pending task from the board

- **WHEN** the user activates (enter) or runs a `pending` row
- **THEN** the TUI POSTs to the task's run endpoint, and the row updates to `running` when the broadcast arrives

#### Scenario: Resume a stopped task from the board

- **WHEN** the user resumes (or activates) a `stopped` row
- **THEN** the TUI POSTs to the task's resume endpoint, and the row updates to `running` when the broadcast arrives

#### Scenario: Activate a running task jumps to its session

- **WHEN** the user activates (enter) a `running` row linked to a session
- **THEN** the TUI jumps to that session's tmux pane

#### Scenario: Mark a task done

- **WHEN** the user triggers mark-done on a row
- **THEN** the TUI POSTs `done` to the task's status endpoint, and the row moves to the `done` group when the `task_updated` broadcast arrives — the task is not removed

#### Scenario: A done task stays on the board and is revivable

- **WHEN** a task has been marked `done`
- **THEN** it remains listed (in the `done` group), and activating or run/resuming it revives it — resuming when it has a `nativeSessionId`, otherwise running — moving it back to `running`

#### Scenario: Delete a task requires confirmation

- **WHEN** the user triggers delete on a row
- **THEN** a confirmation naming the task is shown, and the task is deleted (via the daemon) only after the user confirms, the row disappearing when the `task_removed` broadcast arrives

#### Scenario: Cancel a delete

- **WHEN** the delete confirmation is shown and the user cancels
- **THEN** no delete is dispatched and the task remains

#### Scenario: Run/resume applies only to actionable statuses

- **WHEN** the selected row is `running` or `failed`
- **THEN** the explicit run/resume action does nothing (a `running` row is revisited via activate→jump, not run/resume)
