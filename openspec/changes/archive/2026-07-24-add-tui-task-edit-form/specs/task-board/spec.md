## MODIFIED Requirements

### Requirement: Task creation from the board

The task board SHALL provide a create action, opened by a keybind, that presents a single modal form for composing a new task and dispatches it to the existing `POST /tasks` endpoint. The form SHALL offer: name, agent, project, target, target-ref, template, prompt, and a run-now toggle. The `name` field is optional — when left blank, the daemon derives a name from the prompt (per the task-store capability); when provided it is sent with the create. The `target` field SHALL be a single mutually-exclusive selector cycling every placement — `new-window`, `split`, `send-to-existing`, the headless `background`, and `new-session` — so a task has exactly one placement and background is not a separate co-selectable toggle. Field choices SHALL be sourced from local configuration — agents from the built-in registry plus config `agents`, templates from config `templates`, projects from config `projects` combined with the working directories of live sessions, the projects of existing tasks, and the immediate subdirectories of the configured project root(s) (`projectsRoot`, a one-level scan) — and the form's initial values SHALL be pre-filled from the same default cascade the daemon resolves (`defaults → projects[project] → templates[template]`). The project field SHALL additionally offer a searchable picker (filter-as-you-type over the known projects) with an escape hatch to enter an arbitrary path not yet known. The target-ref field SHALL be offered only for `split` and `send-to-existing` targets, and SHALL pick from the live sessions belonging to the selected project (the value sent being the session's tmux pane); changing the project SHALL drop a target-ref that no longer belongs to it. `new-window`, `background`, and `new-session` do not use a target-ref. On submit the TUI SHALL POST the entered fields to the daemon (omitting unset fields so the daemon's resolver still applies) and, when run-now is set, SHALL additionally run the created task. The form SHALL NOT be submittable without a prompt unless a selected template supplies one, nor when a `split`/`send-to-existing` target has no resolved pane. Creation SHALL NOT optimistically mutate the store; the `task_created` (and, for run-now, `task_updated`) broadcast SHALL add and update the row. The same modal SHALL be reused to edit a pending task and to clone an existing task (see the edit and clone requirements). The create action SHALL leave the daemon's task endpoints unchanged (no new endpoint).

#### Scenario: Open the create form

- **WHEN** the user presses the create keybind on the task board
- **THEN** a modal form opens with fields pre-filled from the default cascade, and the form's key handling takes precedence over the board's keys until it closes

#### Scenario: Create a task

- **WHEN** the user fills the form and submits
- **THEN** the TUI POSTs the entered fields to `/tasks`, the modal closes, and the new row appears when the `task_created` broadcast arrives

#### Scenario: Name field offered and optional

- **WHEN** the create form is open
- **THEN** it offers a `name` text field; submitting with it blank omits `name` (the daemon derives one), and submitting with it set sends that `name`

#### Scenario: Create and run immediately

- **WHEN** the user submits with the run-now toggle set
- **THEN** the TUI creates the task and then runs it, and the row appears and updates to `running` as the broadcasts arrive

#### Scenario: Background and new-session are target values, not co-selectable toggles

- **WHEN** the user cycles the target field
- **THEN** it moves through `new-window`, `split`, `send-to-existing`, `background`, and `new-session` as mutually-exclusive values, with no separate background checkbox that could be set alongside a pane target

#### Scenario: target-ref is offered only for split/send-to-existing and filtered to the project

- **WHEN** the selected target is `split` or `send-to-existing`
- **THEN** the form shows a target-ref picker over the live sessions **in the selected project**; for `new-window`, `background`, or `new-session` the target-ref field is hidden

#### Scenario: new-session is submittable without a pane

- **WHEN** the selected target is `new-session` and a prompt (or prompt-bearing template) is set
- **THEN** the form is submittable without any target-ref

#### Scenario: Changing the project drops a mismatched pane

- **WHEN** a target-ref is chosen and the project is then changed so that pane no longer belongs to it
- **THEN** the target-ref is cleared

#### Scenario: Field choices come from local config

- **WHEN** the create form is opened
- **THEN** the agent, template, and project choices reflect local configuration, live-session working directories, and existing-task projects, without a new daemon request

#### Scenario: Project picker filters and accepts a typed path

- **WHEN** the user opens the project picker and types
- **THEN** the known projects filter by substring, and an escape-hatch choice lets an arbitrary typed path be selected

#### Scenario: Project root folders populate the picker

- **WHEN** a `projectsRoot` is configured
- **THEN** the immediate subdirectories of each root appear as project choices in the picker

#### Scenario: Prompt is required unless a template supplies one

- **WHEN** the prompt is empty and no selected template provides a prompt
- **THEN** the form is not submittable

#### Scenario: A pane target requires a resolved pane

- **WHEN** the target is `split` or `send-to-existing` and no pane is selected
- **THEN** the form is not submittable

#### Scenario: Cancel the form

- **WHEN** the user cancels the form
- **THEN** the modal closes and no task is created

### Requirement: Task board row actions

From the task board the user SHALL be able to activate a row, explicitly run/resume the actionable statuses, edit a `pending` task, clone a task, and delete a task (behind a confirmation), each dispatched to the existing daemon endpoints. Activating (enter) a `pending` task SHALL run it; activating a `stopped` task SHALL resume it; activating a `running` task linked to a session SHALL jump to that session's pane (mirroring the session view's activate). The explicit run/resume action SHALL start a `pending` task (run) and re-attach a `stopped` task (resume), and SHALL do nothing for other statuses. Deleting a task SHALL first require an explicit confirmation naming the task; only on confirmation SHALL the TUI dispatch `DELETE` to the daemon, and cancelling SHALL leave the task untouched. The board SHALL NOT optimistically mutate the store; the resulting `task_updated`/`task_removed` broadcast updates the row.

#### Scenario: Run a pending task from the board

- **WHEN** the user activates (enter) or runs a `pending` row
- **THEN** the TUI POSTs to the task's run endpoint, and the row updates to `running` when the broadcast arrives

#### Scenario: Resume a stopped task from the board

- **WHEN** the user resumes (or activates) a `stopped` row
- **THEN** the TUI POSTs to the task's resume endpoint, and the row updates to `running` when the broadcast arrives

#### Scenario: Activate a running task jumps to its session

- **WHEN** the user activates (enter) a `running` row linked to a session
- **THEN** the TUI jumps to that session's tmux pane

#### Scenario: Delete a task requires confirmation

- **WHEN** the user triggers delete on a row
- **THEN** a confirmation naming the task is shown, and the task is deleted (via the daemon) only after the user confirms, the row disappearing when the `task_removed` broadcast arrives

#### Scenario: Cancel a delete

- **WHEN** the delete confirmation is shown and the user cancels
- **THEN** no delete is dispatched and the task remains

#### Scenario: Run/resume applies only to actionable statuses

- **WHEN** the selected row is neither `pending` nor `stopped`
- **THEN** the explicit run/resume action does nothing

## ADDED Requirements

### Requirement: Edit a pending task from the board

The task board SHALL provide an edit action, on a keybind, that opens the create/edit modal pre-filled from the selected task and, on submit, dispatches `POST /tasks/{id}/edit` (the edit endpoint) rather than creating a new task. Editing SHALL be offered only for a `pending` task; triggering it on a non-`pending` task SHALL surface a message and open nothing. In edit mode the run-now toggle SHALL be hidden (editing never launches) and the modal SHALL indicate it is editing. On a successful edit the modal SHALL close and the row SHALL update when the `task_updated` broadcast arrives (no optimistic mutation); an edit rejected by the daemon (e.g. the task is no longer `pending`, or the merged fields are invalid) SHALL surface a message without discarding the form.

#### Scenario: Edit a pending task

- **WHEN** the user triggers edit on a `pending` row, changes fields, and submits
- **THEN** the TUI POSTs to `/tasks/{id}/edit`, the modal closes, and the row updates when the `task_updated` broadcast arrives

#### Scenario: Edit offered only for pending tasks

- **WHEN** the user triggers edit on a `running`, `stopped`, `done`, or `failed` row
- **THEN** a message is shown and no edit modal opens

#### Scenario: Run-now hidden while editing

- **WHEN** the edit modal is open
- **THEN** the run-now toggle is not shown (editing does not launch the task)

#### Scenario: Rejected edit keeps the form

- **WHEN** a submitted edit is rejected by the daemon
- **THEN** a message is shown and the modal stays open with the entered values

### Requirement: Clone a task from the board

The task board SHALL provide a clone action, on a keybind, that opens the create modal pre-filled from the selected task's fields (name, prompt, agent, project, target, and target-ref) as a **new** task — not an edit. Submitting SHALL create a new task via `POST /tasks` (a fresh id, no correlation/link fields copied). The clone SHALL NOT run automatically unless the user sets run-now.

#### Scenario: Clone an existing task

- **WHEN** the user triggers clone on any row
- **THEN** the create modal opens pre-filled from that task's fields, and submitting creates a new task via `POST /tasks`

#### Scenario: Clone does not copy link fields

- **WHEN** a running, session-linked task is cloned
- **THEN** the new task carries only spec fields (no `sessionId`/`paneId`/`nativeSessionId`) and starts `pending`
