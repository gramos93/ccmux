## ADDED Requirements

### Requirement: Task board preview shows the resolved worktree

The task board preview pane (`TaskDetail`) SHALL, for a task that has launched into a worktree, display the resolved worktree path and branch (from the task's `worktreePath`/`branch` correlation fields) in addition to the existing `worktree` intent line. Before launch (no resolved fields), it SHALL continue to show only the intent as today.

#### Scenario: Preview shows resolved worktree after launch

- **WHEN** the preview renders a worktree task that has a resolved `worktreePath` and `branch`
- **THEN** the pane shows the resolved worktree path and branch

#### Scenario: Preview shows only intent before launch

- **WHEN** the preview renders a worktree task that has not yet launched
- **THEN** the pane shows the `worktree` intent line and no resolved path/branch
