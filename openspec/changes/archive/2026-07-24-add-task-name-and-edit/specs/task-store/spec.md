## MODIFIED Requirements

### Requirement: Task data model

The system SHALL define a `Task` type with a single schema serving two lifecycles: a persistent **template** and an ephemeral **instance**. A `Task` MUST carry the fields `project`, `target`, `agent`, `prompt`, and `status`, and MAY carry `name`, `worktree`, `targetRef`, and `command`. A slash-command, when present, SHALL be part of the `prompt` string, not a separate field. Instances additionally carry a unique `id`, creation/update timestamps, and MAY carry the correlation link fields `paneId` (the tmux pane the task was launched into), `sessionId` (the ccmux session correlated to it), and `nativeSessionId` (the agent's own conversation id, the durable anchor used to resume). `paneId`/`sessionId` are per-launch and replaced on each (re)launch; `nativeSessionId` persists across launches. The link fields are absent at creation and set post-launch/post-correlation.

The optional `name` field SHALL be a human-readable label for the task, foldable through the default cascade like any other field. It is display-only text with no charset restriction. When a task is created with no resolved `name`, the store SHALL persist a **derived default** computed from the task's content — the first non-empty line of the `prompt` (whitespace-collapsed and length-capped), falling back to the `command`'s head or a generic label when there is no prompt — so a task is never identified only by its `id`. A derivation helper SHALL also be available to compute a display name at read time for instances persisted before `name` existed (no rewrite-on-load).

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

#### Scenario: Name defaulted from the prompt

- **WHEN** a task is created with a `prompt` but no `name`
- **THEN** the store persists a `name` derived from the prompt's first non-empty line (whitespace-collapsed, length-capped)

#### Scenario: Explicit name preserved

- **WHEN** a task is created with an explicit `name`
- **THEN** the store persists that `name` unchanged (no derivation)

#### Scenario: Display name falls back for a legacy task

- **WHEN** a task instance persisted before `name` existed is read
- **THEN** a display name is derived from its content at read time (the stored record is not rewritten)

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

## ADDED Requirements

### Requirement: Edit a task's spec fields

The store SHALL support editing an existing task's spec fields by merging a caller-supplied partial (any of `name`, `prompt`, `agent`, `project`, `target`, `targetRef`, `worktree`, `command`) onto the stored instance and re-validating the merged spec with the same rules applied at creation, then bumping `updatedAt` and persisting. Non-spec fields (`id`, `status`, timestamps, and the correlation link fields) SHALL NOT be editable through this path. A merged spec that fails validation SHALL be rejected and persist nothing. The store edit itself SHALL NOT gate on lifecycle status (status-based restriction is the task-api capability's concern).

#### Scenario: Edit merges and re-validates

- **WHEN** a stored task is edited with `{ name: "fix login", agent: "codex" }`
- **THEN** the merged spec is re-validated, `updatedAt` is bumped, and the updated instance is persisted with the new `name` and `agent`

#### Scenario: Edit rejecting an invalid merge

- **WHEN** an edit would produce an invalid spec (e.g. an unknown `target`, or a blank `prompt` with no `command`)
- **THEN** the edit is rejected and the stored task is unchanged

#### Scenario: Edit ignores non-spec fields

- **WHEN** an edit body includes `status`, `id`, `paneId`, or a timestamp
- **THEN** those fields are ignored and only the editable spec fields are applied
