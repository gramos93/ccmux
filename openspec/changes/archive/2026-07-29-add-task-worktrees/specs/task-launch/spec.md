## ADDED Requirements

### Requirement: Launch a worktree task in its worktree

When a task carries worktree intent, the daemon SHALL launch the agent with the task's resolved worktree path as the working directory instead of the project root, for every pane target (`new-window`, `split`, `new-session`, and `send-to-existing` where applicable). Worktree resolution is orthogonal to the target: it only substitutes the effective working directory (the `-c` cwd for created panes) and does not otherwise change target semantics. The daemon SHALL persist the resolved worktree path and branch back onto the task instance after a successful launch. The pre-launch working-directory existence check SHALL apply to the resolved worktree path.

Under the **one-session-per-project / one-window-per-worktree** model, a `new-session` worktree task SHALL still key its tmux session on the project (repo/bare root, stamped `@ccmux_project`), and SHALL open a new window in that session rooted at the worktree path and named after the resolved branch. Worktrees of one repository therefore share a single project session rather than fragmenting into separate sessions.

#### Scenario: new-window worktree task launches in the worktree

- **WHEN** a `new-window` task with worktree intent is run
- **THEN** the pane is created with the resolved worktree path as its cwd, the agent launches there, and the task's resolved `worktreePath` and `branch` are persisted

#### Scenario: new-session worktree task opens a branch-named window in the project session

- **WHEN** a `new-session` task with worktree intent is run
- **THEN** the tmux session is keyed on the project (stamped `@ccmux_project`) and a new window named after the resolved branch is opened in it, rooted at the worktree path

#### Scenario: Two worktree tasks of one repo share the project session

- **WHEN** two worktree tasks for different branches of the same repository are run
- **THEN** both land as separate branch-named windows within the same project-keyed tmux session

#### Scenario: A non-wtm repo blocks before any pane is created

- **WHEN** a worktree task is run in a repository that is not wtm-managed
- **THEN** worktree resolution is attempted before pane creation, the run is refused with the actionable error, no pane/session is created, and the task's status is left `pending` (never set to `running` or `failed`)

### Requirement: Resume re-enters the task's worktree

When resuming a task that has a persisted `worktreePath`, the daemon SHALL relaunch the agent in that same worktree (reusing it via the idempotent resolution) rather than the repo root, keeping the resumed conversation in its original working copy.

#### Scenario: Resume lands back in the worktree

- **WHEN** a stopped worktree task with a persisted `worktreePath` is resumed
- **THEN** the resume relaunches the agent in that worktree directory (reused, not recreated)

### Requirement: Task CLI worktree flags

The `ccmux task create` command SHALL accept `--worktree`, `--branch <name>`, and `--base <ref>` flags to express worktree intent. `--worktree` alone SHALL send `worktree: true`; `--branch`/`--base` (with or without `--worktree`) SHALL send the object form `{ branch, base }`. Unset flags SHALL be sent as absent so the default cascade and the daemon's branch/base defaulting apply.

#### Scenario: --worktree sets bare intent

- **WHEN** `ccmux task create --worktree ...` is invoked with no branch or base
- **THEN** the created task's `worktree` is `true`

#### Scenario: --branch/--base set the object form

- **WHEN** `ccmux task create --branch feature-x --base develop ...` is invoked
- **THEN** the created task's `worktree` is `{ branch: "feature-x", base: "develop" }`

#### Scenario: No worktree flags leaves intent unset

- **WHEN** `ccmux task create` is invoked with none of the worktree flags
- **THEN** no `worktree` field is sent and the default cascade decides the task's worktree intent
