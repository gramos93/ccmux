## ADDED Requirements

### Requirement: Task store slice fed by SSE

The TUI store SHALL hold a `tasks` collection kept in sync with the daemon over SSE: it SHALL seed from the `init` frame's task snapshot on (re)connect, add on `task_created`, replace-by-id on `task_updated`, and remove on `task_removed`. An `init` frame without a task snapshot SHALL be treated as an empty set (older daemon).

#### Scenario: Init seeds the task list

- **WHEN** the TUI connects and the `init` frame carries a task snapshot
- **THEN** the store's task list reflects that snapshot

#### Scenario: Task events update the store

- **WHEN** `task_created`, `task_updated`, or `task_removed` events arrive
- **THEN** the store adds, replaces-by-id, or removes the corresponding task

#### Scenario: Reconnect reconciles

- **WHEN** the TUI reconnects and receives a fresh `init` snapshot
- **THEN** the store's task list is replaced to match the snapshot

### Requirement: Task board view

The TUI SHALL provide a task board view, toggled from the session view by a keybind, that lists the store's tasks. Each row SHALL show the task's short id, its lifecycle status (distinctly colored per `pending`/`running`/`stopped`/`done`/`failed`), its agent, and its project. For a `running` task with a linked session, the row SHALL also show that session's live activity (working/waiting/idle) via a read-time join on `sessionId` (never persisted onto the task). An empty task list SHALL render a clear empty state.

#### Scenario: Toggle to the board

- **WHEN** the user presses the task-view keybind
- **THEN** the middle region renders the task board instead of the session list, and the keybind toggles back

#### Scenario: Rows show status, agent, and project

- **WHEN** the board renders a task
- **THEN** the row shows its short id, a status-colored badge, its agent, and its project

#### Scenario: Running task borrows live activity

- **WHEN** a `running` task is linked to a session
- **THEN** the row shows that session's live activity, joined at render time and not stored on the task

#### Scenario: Empty board

- **WHEN** there are no tasks
- **THEN** the board shows an empty state rather than a blank region

### Requirement: Task board row actions

From the task board the user SHALL be able to resume a `stopped` task and delete any task, each dispatched to the existing daemon endpoints. The board SHALL NOT optimistically mutate the store; the resulting `task_updated`/`task_removed` broadcast updates the row.

#### Scenario: Resume a stopped task from the board

- **WHEN** the user triggers resume on a `stopped` row
- **THEN** the TUI POSTs to the task's resume endpoint, and the row updates to `running` when the broadcast arrives

#### Scenario: Delete a task from the board

- **WHEN** the user triggers delete on a row
- **THEN** the TUI deletes the task via the daemon, and the row disappears when the broadcast arrives

#### Scenario: Resume is offered only for stopped tasks

- **WHEN** the selected row is not `stopped`
- **THEN** the resume action does nothing (or is not offered)
