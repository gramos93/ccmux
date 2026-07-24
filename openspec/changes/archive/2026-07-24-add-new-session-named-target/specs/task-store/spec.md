## MODIFIED Requirements

### Requirement: Task data model

The system SHALL define a `Task` type with a single schema serving two lifecycles: a persistent **template** and an ephemeral **instance**. A `Task` MUST carry the fields `project`, `target`, `agent`, `prompt`, and `status`, and MAY carry `worktree`, `targetRef`, and `command`. A slash-command, when present, SHALL be part of the `prompt` string, not a separate field. Instances additionally carry a unique `id`, creation/update timestamps, and MAY carry the correlation link fields `paneId` (the tmux pane the task was launched into), `sessionId` (the ccmux session correlated to it), and `nativeSessionId` (the agent's own conversation id, the durable anchor used to resume). `paneId`/`sessionId` are per-launch and replaced on each (re)launch; `nativeSessionId` persists across launches. The link fields are absent at creation and set post-launch/post-correlation.

The `target` field SHALL be one of `new-window`, `split`, `send-to-existing`, `background`, or `new-session`. `background` denotes a headless run (no pane) executed via the invoke subsystem. `new-session` denotes a launch into a dedicated tmux session named after the project (behavior defined by the task-launch capability). No target value is reserved.

The optional `targetRef` field SHALL identify the tmux pane or session that a target acts on: the pane for `split` and `send-to-existing`, and — for `new-session` — an optional explicit session name to launch into instead of the project-derived name (behavior defined by the task-launch capability). The data model persists the field for any target; spawn behavior enforcing it is defined by the task-launch capability, where `send-to-existing` requires it. `new-window` does not use it.

The optional `command` field SHALL be a raw argv (`string[]`) that, when present, is launched verbatim instead of a command built from the agent adapter. It is the passthrough escape hatch; the data model only persists it. When `command` is present, `prompt` is NOT required (the command is self-contained).

Instances MAY additionally carry an optional `invocationId` link field, set when a `background` task is dispatched to the invoke subsystem, so the task can be joined to its invocation.

The `worktree` field SHALL be either a boolean or an object `{ branch?: string; base?: string }`. Absent or `false` means no worktree; `true` means a worktree with defaulted naming; the object form names the branch and/or base for the worktree created by a later capability. Actual worktree creation is out of scope for the data model.

The `status` field of an instance SHALL be one of `pending`, `running`, `stopped`, `done`, or `failed`. `stopped` denotes an interactive task whose agent/pane has closed but whose `nativeSessionId` is retained, making it resumable. `failed` is the terminal state for a failed background invocation (interactive tasks do not reach it).

#### Scenario: Valid instance accepted

- **WHEN** a task instance is created with `project`, `target: "new-window"`, `agent`, `prompt`, and `status: "pending"`
- **THEN** the store persists it and assigns a unique `id` and creation timestamp

#### Scenario: new-session target accepted

- **WHEN** a task is created with `target: "new-session"`
- **THEN** the store persists it (no target value is reserved)

#### Scenario: Worktree names a branch

- **WHEN** a task is created with `worktree: { branch: "feat/x", base: "main" }`
- **THEN** the store persists the branch and base for later worktree creation

#### Scenario: targetRef persisted for send-to-existing

- **WHEN** a task is created with `target: "send-to-existing"` and `targetRef: "%3"`
- **THEN** the store persists `targetRef` alongside the instance

#### Scenario: targetRef persisted for a new-session explicit name

- **WHEN** a task is created with `target: "new-session"` and `targetRef: "review"`
- **THEN** the store persists `targetRef` alongside the instance (the explicit session name the task-launch capability will use)

#### Scenario: Link fields absent at creation

- **WHEN** a task instance is created
- **THEN** its `paneId`, `sessionId`, and `nativeSessionId` are unset until the task is launched and correlated

#### Scenario: Background target accepted

- **WHEN** a task is created with `target: "background"`
- **THEN** the store persists it (a paneless, headless task)

#### Scenario: Passthrough command persisted

- **WHEN** a task is created with a `command` argv
- **THEN** the store persists the `command` alongside the instance

#### Scenario: invocationId recorded for background tasks

- **WHEN** a `background` task is dispatched to the invoke subsystem
- **THEN** the instance records the resulting `invocationId`

#### Scenario: nativeSessionId retained on a stopped task

- **WHEN** a correlated task transitions to `stopped`
- **THEN** its `nativeSessionId` remains set so the task can be resumed later
