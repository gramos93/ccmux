## MODIFIED Requirements

### Requirement: Task data model

The system SHALL define a `Task` type with a single schema serving two lifecycles: a persistent **template** and an ephemeral **instance**. A `Task` MUST carry the fields `project`, `target`, `agent`, `prompt`, and `status`, and MAY carry `worktree`, `targetRef`, and `command`. A slash-command, when present, SHALL be part of the `prompt` string, not a separate field. Instances additionally carry a unique `id`, creation/update timestamps, and MAY carry the correlation link fields `paneId` (the tmux pane the task was launched into) and `sessionId` (the ccmux session correlated to it). The link fields are absent at creation and set post-launch.

The `target` field SHALL be one of `new-window`, `split`, `send-to-existing`, or `background`. `background` denotes a headless run (no pane) executed via the invoke subsystem. The value `new-session` is reserved and MUST NOT be accepted.

The optional `targetRef` field SHALL identify the tmux pane or session that a `split` or `send-to-existing` target acts on. The data model persists the field; spawn behavior enforcing it is defined by the task-launch capability, where `send-to-existing` requires it.

The optional `command` field SHALL be a raw argv (`string[]`) that, when present, is launched verbatim instead of a command built from the agent adapter. It is the passthrough escape hatch; the data model only persists it.

The `worktree` field SHALL be either a boolean or an object `{ branch?: string; base?: string }`. Absent or `false` means no worktree; `true` means a worktree with defaulted naming; the object form names the branch and/or base for the worktree created by a later capability. Actual worktree creation is out of scope for the data model.

The `status` field of an instance SHALL be one of `pending`, `running`, `done`, or `failed`.

#### Scenario: Valid instance accepted

- **WHEN** a task instance is created with `project`, `target: "new-window"`, `agent`, `prompt`, and `status: "pending"`
- **THEN** the store persists it and assigns a unique `id` and creation timestamp

#### Scenario: Reserved target rejected

- **WHEN** a task is created with `target: "new-session"`
- **THEN** creation is rejected with an error and nothing is persisted

#### Scenario: Background target accepted

- **WHEN** a task is created with `target: "background"`
- **THEN** the store persists it (a paneless, headless task)

#### Scenario: Passthrough command persisted

- **WHEN** a task is created with a `command` argv
- **THEN** the store persists the `command` alongside the instance
