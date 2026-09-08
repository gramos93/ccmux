## ADDED Requirements

### Requirement: Worktree correlation fields

A task instance SHALL carry optional resolved worktree correlation fields set after a successful worktree launch (absent at creation, persisted like the other post-launch correlation fields): the resolved absolute `worktreePath` and the resolved `branch`. These fields SHALL be persisted through the store's editable/patchable field set so they survive reload and are available to resume and the TUI. They SHALL NOT be settable as creation input — only the `worktree` intent field is creation input; `worktreePath`/`branch` are derived at launch.

#### Scenario: Resolved worktree fields persist across reload

- **WHEN** a worktree task is launched and its resolved `worktreePath` and `branch` are recorded
- **THEN** re-reading the task from the store returns those values

#### Scenario: Worktree correlation fields absent before launch

- **WHEN** a worktree task is created but not yet run
- **THEN** its `worktreePath` and `branch` fields are absent
