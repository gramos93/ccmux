# task-store

## Purpose

The `Task` primitive and its persistence: a single `Task` schema with two lifecycles (persistent template, ephemeral instance), a state home (`~/.ccmux`) distinct from the config dir, a per-file instance store, and the default-cascade resolution that produces a concrete `Task` from global defaults, per-project overrides, templates, and creation-time input. This is the launch/track data foundation; spawn behavior, the daemon API, and TUI views build on it in later capabilities.

## Requirements

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

### Requirement: State home resolution

The system SHALL resolve a state home directory distinct from the config directory. It MUST use `$CCMUX_STATE_HOME` when set, otherwise default to `~/.ccmux`. The config directory (`$CCMUX_HOME` / `~/.config/ccmux`) MUST NOT be used for the task store, and existing config-dir files MUST NOT be moved into the state home.

#### Scenario: Default state home

- **WHEN** `$CCMUX_STATE_HOME` is unset
- **THEN** the task store resolves its path under `~/.ccmux`

#### Scenario: Override honored

- **WHEN** `$CCMUX_STATE_HOME` is set to a custom path
- **THEN** the task store reads and writes under that path

#### Scenario: Config dir untouched

- **WHEN** the task store is written for the first time
- **THEN** `~/.config/ccmux/state.json` and other config-dir files are left unchanged

### Requirement: Task instance persistence

The system SHALL provide a task-instance store persisted as JSON under the state home, supporting create, list, get-by-id, update-status, patch-fields, and delete. The store directory MUST be created lazily on first write. The patch-fields operation SHALL merge a partial set of instance fields (e.g. `paneId`, `sessionId`, `status`) into an existing instance and refresh `updatedAt`, returning the updated instance or nothing when it does not exist. A `done` task MAY be deleted; deletion MUST remove it from subsequent listings.

#### Scenario: Create then list

- **WHEN** a task instance is created and the store is listed
- **THEN** the created instance appears in the list with its assigned `id`

#### Scenario: Update status

- **WHEN** an existing instance's status is updated from `pending` to `running`
- **THEN** a subsequent get-by-id returns the instance with `status: "running"` and a refreshed update timestamp

#### Scenario: Patch link fields

- **WHEN** an existing instance is patched with a `paneId` and `sessionId`
- **THEN** a subsequent get-by-id returns those fields and a refreshed `updatedAt`, with all other fields preserved

#### Scenario: Patch a missing task

- **WHEN** a patch is applied to an unknown id
- **THEN** the store returns nothing and persists nothing

#### Scenario: Delete completed task

- **WHEN** a `done` instance is deleted
- **THEN** it no longer appears in listings and get-by-id returns nothing

#### Scenario: Absent store dir degrades to empty

- **WHEN** the tasks directory does not exist
- **THEN** listing returns an empty result and no error is thrown

#### Scenario: Malformed task file skipped

- **WHEN** the tasks directory contains one invalid-JSON file alongside valid task files
- **THEN** listing returns the valid instances and skips the malformed file without throwing

### Requirement: Config-side task surface

The system SHALL extend `Preferences` with `templates` (named `Task` presets), `projects` (per-project overrides), and `defaults` (global task defaults such as `worktree`, `agent`, `target`). These live in the config file (`~/.config/ccmux/ccmux.json`) and are optional; their absence MUST NOT break existing config loading.

#### Scenario: Config without task keys still loads

- **WHEN** an existing `ccmux.json` has none of `templates`, `projects`, or `defaults`
- **THEN** preferences load successfully with those fields undefined

#### Scenario: Named template retrievable

- **WHEN** a template named `review` is defined under `templates`
- **THEN** it can be looked up by name and used as a `Task` preset

### Requirement: Default cascade resolution

The system SHALL resolve a concrete `Task` from four ordered layers, later layers overriding earlier ones per-field: global `defaults` → per-project override (`projects[project]`) → named template → creation-time input. Fields absent at every layer remain unset. No per-project or template configuration SHALL be required to create a task (sensible defaults suffice for a POC).

#### Scenario: Creation input wins

- **WHEN** global `defaults.agent` is `claude` and creation input specifies `agent: "codex"`
- **THEN** the resolved task has `agent: "codex"`

#### Scenario: Project override beats global default

- **WHEN** global `defaults.worktree` is `false` and `projects["myrepo"].worktree` is `true`, and a task is created for `myrepo` with no explicit worktree
- **THEN** the resolved task has `worktree: true`

#### Scenario: Template fills gaps

- **WHEN** a template sets `target: "split"` and neither global/project defaults nor creation input specify `target`
- **THEN** the resolved task has `target: "split"`

#### Scenario: No config required

- **WHEN** no `templates`, `projects`, or `defaults` are configured and a task is created with only `project`, `agent`, and `prompt`
- **THEN** resolution succeeds using built-in defaults for the remaining fields

### Requirement: Worktree correlation fields

A task instance SHALL carry optional resolved worktree correlation fields set after a successful worktree launch (absent at creation, persisted like the other post-launch correlation fields): the resolved absolute `worktreePath` and the resolved `branch`. These fields SHALL be persisted through the store's editable/patchable field set so they survive reload and are available to resume and the TUI. They SHALL NOT be settable as creation input — only the `worktree` intent field is creation input; `worktreePath`/`branch` are derived at launch.

#### Scenario: Resolved worktree fields persist across reload

- **WHEN** a worktree task is launched and its resolved `worktreePath` and `branch` are recorded
- **THEN** re-reading the task from the store returns those values

#### Scenario: Worktree correlation fields absent before launch

- **WHEN** a worktree task is created but not yet run
- **THEN** its `worktreePath` and `branch` fields are absent
