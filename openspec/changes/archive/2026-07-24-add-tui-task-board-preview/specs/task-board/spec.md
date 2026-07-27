## MODIFIED Requirements

### Requirement: Task board view

The TUI SHALL provide a task board view, toggled from the session view by a keybind, that lists the store's tasks. Each row SHALL lead with the task's **display name** — its `name`, or a name derived from its content when `name` is absent — followed by its lifecycle status (distinctly colored per `pending`/`running`/`stopped`/`done`/`failed`), its agent, and its project; the task's short id MAY appear as a secondary, de-emphasized token rather than the leading identifier. For a `running` task with a linked session, the row SHALL also show that session's live activity (working/waiting/idle) via a read-time join on `sessionId` (never persisted onto the task). An empty task list SHALL render a clear empty state.

#### Scenario: Toggle to the board

- **WHEN** the user presses the task-view keybind
- **THEN** the middle region renders the task board instead of the session list, and the keybind toggles back

#### Scenario: Rows lead with the display name

- **WHEN** the board renders a task
- **THEN** the row leads with the task's display name (its `name`, or a derived fallback), followed by a status-colored badge, its agent, and its project, with the short id shown only as a de-emphasized secondary token

#### Scenario: Running task borrows live activity

- **WHEN** a `running` task is linked to a session
- **THEN** the row shows that session's live activity, joined at render time and not stored on the task

#### Scenario: Empty board

- **WHEN** there are no tasks
- **THEN** the board shows an empty state rather than a blank region

## ADDED Requirements

### Requirement: Task board preview pane

The task board SHALL present a preview pane on the right that reflects the selected task, mirroring the session view's list-plus-preview layout. The pane SHALL be shown only when the session view's preview is enabled (the shared `showPreview` state) and not in sidebar mode, and SHALL be sized by the shared `previewWidth`. The board SHALL resolve a selected task (defaulting to the first task when none is explicitly selected) so the pane is never blank while tasks exist. For a `running` task linked to a live session, the pane SHALL render that session's live pane capture using the same preview component as the session view. For any other task — `pending`, `stopped`, `done`, `failed`, or a `running` task with no linked session — the pane SHALL render a task-detail card (no tmux capture) showing the task's display name, status, agent, project, target (and, for `new-session`, the explicit or project-derived session name), the full prompt in a scrollable region, worktree intent, created/updated timestamps, the linked session id when present, and a failure hint for a `failed` task. The board SHALL reuse the session view's preview toggle and preview-focus/scroll keybinds and state (`showPreview`, `previewWidth`, `previewFocused`) rather than introducing a separate preview model.

#### Scenario: Running linked task shows its live pane

- **WHEN** the selected board task is `running` and linked to a live session, with the preview enabled
- **THEN** the right pane renders that session's live pane capture (the same preview component the session view uses)

#### Scenario: Paneless task shows a detail card

- **WHEN** the selected board task is `pending`, `stopped`, `done`, `failed`, or `running` without a linked session
- **THEN** the right pane renders a task-detail card (name, status, agent, project, target/session name, the scrollable prompt, worktree, timestamps, linked session id, and a failure hint for `failed`) with no tmux capture

#### Scenario: Selection drives the pane

- **WHEN** the user moves the selection between task rows
- **THEN** the preview pane updates to reflect the newly selected task

#### Scenario: Preview hidden when disabled or in sidebar

- **WHEN** the shared preview is toggled off, or the board is rendered in sidebar mode
- **THEN** no preview pane is shown and the list uses the full width

#### Scenario: Default selection when entering the board

- **WHEN** the board is shown and no task is explicitly selected
- **THEN** the first task is treated as selected and its preview is shown
