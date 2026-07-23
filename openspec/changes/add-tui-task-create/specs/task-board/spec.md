## MODIFIED Requirements

### Requirement: Task board row actions

From the task board the user SHALL be able to activate a row, explicitly run/resume the actionable statuses, and delete any task, each dispatched to the existing daemon endpoints. Activating (enter) a `pending` task SHALL run it; activating a `stopped` task SHALL resume it; activating a `running` task linked to a session SHALL jump to that session's pane (mirroring the session view's activate). The explicit run/resume action SHALL start a `pending` task (run) and re-attach a `stopped` task (resume), and SHALL do nothing for other statuses. The board SHALL NOT optimistically mutate the store; the resulting `task_updated`/`task_removed` broadcast updates the row.

#### Scenario: Run a pending task from the board

- **WHEN** the user activates (enter) or runs a `pending` row
- **THEN** the TUI POSTs to the task's run endpoint, and the row updates to `running` when the broadcast arrives

#### Scenario: Resume a stopped task from the board

- **WHEN** the user resumes (or activates) a `stopped` row
- **THEN** the TUI POSTs to the task's resume endpoint, and the row updates to `running` when the broadcast arrives

#### Scenario: Activate a running task jumps to its session

- **WHEN** the user activates (enter) a `running` row linked to a session
- **THEN** the TUI jumps to that session's tmux pane

#### Scenario: Delete a task from the board

- **WHEN** the user triggers delete on a row
- **THEN** the TUI deletes the task via the daemon, and the row disappears when the broadcast arrives

#### Scenario: Run/resume applies only to actionable statuses

- **WHEN** the selected row is neither `pending` nor `stopped`
- **THEN** the explicit run/resume action does nothing

## ADDED Requirements

### Requirement: Task creation from the board

The task board SHALL provide a create action, opened by a keybind, that presents a single modal form for composing a new task and dispatches it to the existing `POST /tasks` endpoint. The form SHALL offer: agent, project, target, target-ref, template, prompt, a background toggle, and a run-now toggle. Field choices SHALL be sourced from local configuration — agents from the built-in registry plus config `agents`, templates from config `templates`, projects from config `projects` combined with the distinct working directories of live sessions — and the form's initial values SHALL be pre-filled from the same default cascade the daemon resolves (`defaults → projects[project] → templates[template]`). The target-ref field SHALL be offered only for `split` and `send-to-existing` targets and SHALL pick from the live session list (the value sent being the session's tmux pane). On submit the TUI SHALL POST the entered fields to the daemon (omitting unset fields so the daemon's resolver still applies) and, when run-now is set, SHALL additionally run the created task. The form SHALL NOT be submittable without a prompt unless a selected template supplies one. Creation SHALL NOT optimistically mutate the store; the `task_created` (and, for run-now, `task_updated`) broadcast SHALL add and update the row. The create action SHALL leave the daemon's task endpoints unchanged (no new endpoint).

#### Scenario: Open the create form

- **WHEN** the user presses the create keybind on the task board
- **THEN** a modal form opens with fields pre-filled from the default cascade, and the form's key handling takes precedence over the board's keys until it closes

#### Scenario: Create a task

- **WHEN** the user fills the form and submits
- **THEN** the TUI POSTs the entered fields to `/tasks`, the modal closes, and the new row appears when the `task_created` broadcast arrives

#### Scenario: Create and run immediately

- **WHEN** the user submits with the run-now toggle set
- **THEN** the TUI creates the task and then runs it, and the row appears and updates to `running` as the broadcasts arrive

#### Scenario: target-ref is offered only for split/send-to-existing

- **WHEN** the selected target is `split` or `send-to-existing`
- **THEN** the form shows a target-ref picker over the live session list; for `new-window` or `background` the target-ref field is hidden

#### Scenario: Field choices come from local config

- **WHEN** the create form is opened
- **THEN** the agent, template, and project choices reflect local configuration and live-session working directories, without a new daemon request

#### Scenario: Prompt is required unless a template supplies one

- **WHEN** the prompt is empty and no selected template provides a prompt
- **THEN** the form is not submittable

#### Scenario: Cancel the form

- **WHEN** the user cancels the form
- **THEN** the modal closes and no task is created
