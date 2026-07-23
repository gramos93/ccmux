# task-launch

## Purpose

Running a task into a tmux pane and correlating the resulting ccmux session back to it. Builds on `task-store` (the data model + persistence) and `task-api` (the daemon `/tasks` surface): `POST /tasks/{id}/run` launches the resolved agent by the task's `target`, records the created pane, sets status `running`, and links the session that binds that pane. The `ccmux task` CLI drives the whole lifecycle.

## Requirements

### Requirement: Run a task into a pane

The daemon SHALL run a task by its `target` via `POST /tasks/{id}/run`, launching the resolved agent with the task's prompt and setting status to `running`. For pane targets (`new-window`, `split`, `new-session`) the daemon SHALL verify the task's working directory exists before creating the pane, failing with a clear error when it does not (it may have been deleted between create and run). For `new-window` and `split` it SHALL create a tmux pane, capture its `#{pane_id}`, and launch the agent **adaptively**: run the agent's interactive binary (`executable`, or `resumeCommand` when resuming a session), and once the agent signals readiness (its `readyPattern`, with a timeout fallback) deliver the prompt by submitting it into the agent's composer (a bracketed paste followed by a separate Enter — the proven `sendPromptToPane` mechanism) — NOT via a hardcoded prompt flag and NOT a batched `send-keys <text> Enter` (which leaves the text unsubmitted). For `new-session` it SHALL launch into a dedicated tmux session named after the project (a tmux-sanitized basename), created detached (`tmux new-session -d`) and cd'd to the working directory, capturing its `#{pane_id}` and launching the agent adaptively exactly as for `new-window`; when a session of that name already exists it SHALL open a new window in that session instead of creating a duplicate. When the task carries a raw `command`, that argv SHALL be launched verbatim instead (see the passthrough requirement). For `send-to-existing` it SHALL send the prompt into the pane identified by `targetRef`, which is REQUIRED for that target. Running a task that does not exist SHALL yield `404`.

#### Scenario: Run a new-window task adaptively

- **WHEN** `POST /tasks/{id}/run` is called for a `new-window` task
- **THEN** a pane is created, the agent's interactive binary is launched, the prompt is delivered after the agent is ready, the task's `paneId` is recorded, its status becomes `running`, and a `task_updated` event is broadcast

#### Scenario: Run a split task

- **WHEN** `POST /tasks/{id}/run` is called for a `split` task
- **THEN** a split pane is created and the task is launched into it adaptively with its `paneId` recorded

#### Scenario: Run a new-session task creates a project session

- **WHEN** `POST /tasks/{id}/run` is called for a `new-session` task and no tmux session of the project's name exists
- **THEN** a detached tmux session named after the project is created and cd'd to the working directory, the agent is launched into it adaptively, the task's `paneId` is recorded, its status becomes `running`, and a `task_updated` event is broadcast

#### Scenario: new-session attaches to an existing same-named session

- **WHEN** `POST /tasks/{id}/run` is called for a `new-session` task and a tmux session of the project's name already exists
- **THEN** a new window is opened in that existing session (no duplicate session) and the task is launched into it adaptively with its `paneId` recorded

#### Scenario: Prompt delivered without a hardcoded flag

- **WHEN** a non-Claude agent task is run in a pane
- **THEN** the launch uses the agent's own `executable`/`resumeCommand` and ready-then-send, not `<binary> --prompt <text>`

#### Scenario: send-to-existing requires targetRef

- **WHEN** `POST /tasks/{id}/run` is called for a `send-to-existing` task with no `targetRef`
- **THEN** the response is `400` and the task is not launched

#### Scenario: send-to-existing sends to the referenced pane

- **WHEN** `POST /tasks/{id}/run` is called for a `send-to-existing` task with a valid `targetRef`
- **THEN** the prompt is sent into that pane and the task status becomes `running`

#### Scenario: Run errors on a missing working directory

- **WHEN** a pane task is run but its working directory no longer exists
- **THEN** the run fails with a clear error and no pane is created

#### Scenario: Run a missing task

- **WHEN** `POST /tasks/{id}/run` is called for an unknown id
- **THEN** the response is `404`

### Requirement: Correlate the session by pane id

After a task is launched into a created pane, the daemon SHALL correlate the resulting ccmux session back to the task by matching the session's tmux pane against the task's recorded `paneId`, writing the session's id onto the task and broadcasting `task_updated`. It SHALL also capture the session's `nativeSessionId` (the agent's conversation id) onto the task, refreshing it on later session updates when it becomes available or changes (it may be unset at first bind and arrive on a subsequent update). Correlation MUST tolerate the pane binding after launch (the session may appear or bind its pane on a later update). Correlation SHALL be driven off the same session-event path as invocation back-fill and MUST NOT re-read the whole store on every session event. Once a task is correlated the daemon SHALL retain a `sessionId → taskId` link so subsequent updates and teardown can find the task without a store scan.

#### Scenario: Session binding to the task's pane links it

- **WHEN** a ccmux session binds to a pane whose id matches a launched task's `paneId`
- **THEN** the task's `sessionId` is set to that session and a `task_updated` event is broadcast

#### Scenario: Native conversation id captured and refreshed

- **WHEN** the linked session's `nativeSessionId` is present at bind, or becomes available on a later update
- **THEN** the task's `nativeSessionId` is set/updated to match and a `task_updated` event is broadcast

#### Scenario: Late pane binding still correlates

- **WHEN** a launched task's session appears first without a pane and binds the matching pane on a later update
- **THEN** the task is correlated when the pane binds

#### Scenario: Unrelated pane does not correlate

- **WHEN** a session binds a pane that matches no launched task
- **THEN** no task is modified

### Requirement: Task teardown on session removal

When a ccmux session that is linked to a task is removed, the daemon SHALL transition that task from `running` to `stopped`, retaining its `nativeSessionId` (so it can be resumed later), and broadcast `task_updated`. The lookup SHALL use the `sessionId → taskId` link (no store scan). A session removal that matches no linked task SHALL be a no-op. A task not in `running` SHALL NOT be forced to `stopped` by a removal.

#### Scenario: Linked session removed stops the task

- **WHEN** the session correlated to a `running` task is removed
- **THEN** the task transitions to `stopped`, keeps its `nativeSessionId`, and a `task_updated` event is broadcast

#### Scenario: Unrelated session removal is a no-op

- **WHEN** a removed session is not linked to any task
- **THEN** no task is modified

#### Scenario: Non-running task is not overridden

- **WHEN** a session removal maps to a task that is already `done` (or otherwise not `running`)
- **THEN** the task status is left unchanged

### Requirement: Background task execution via the invoke subsystem

When a task's `target` is `background`, `POST /tasks/{id}/run` SHALL execute it headlessly through the invoke subsystem rather than a pane: the daemon builds an invoke request from the task (agent, prompt, cwd) and calls the invocation manager, which selects the agent's invoker from its `invokeMode`. The task SHALL record the resulting `invocationId`, remain `running` while it executes, and transition to `done` or `failed` when the invocation resolves. A background run of an agent that has no `invokeMode` (and is not Claude) SHALL fail with a clear error.

#### Scenario: Background task runs headlessly

- **WHEN** `POST /tasks/{id}/run` is called for a `background` task whose agent supports invoke
- **THEN** the daemon starts an invocation, the task records its `invocationId` and stays `running`, and no pane is created

#### Scenario: Background task completes

- **WHEN** a background task's invocation resolves successfully
- **THEN** the task status becomes `done`; on failure it becomes `failed`

#### Scenario: Background run of a non-invokable agent errors

- **WHEN** a `background` task names an agent with no `invokeMode` (and not Claude)
- **THEN** the run fails with a clear error and the task is not left falsely `running`

### Requirement: Passthrough launch command

A task MAY carry a raw `command` argv that the launcher runs verbatim, bypassing the agent adapter entirely. The CLI SHALL let a user supply it as the tail after `--` on `ccmux task create`. When `command` is present it takes precedence over adapter-built launch for pane targets.

#### Scenario: Passthrough command launched verbatim

- **WHEN** a pane task carries a `command` argv
- **THEN** the launcher runs that argv in the pane instead of an adapter-built command

#### Scenario: CLI passthrough tail

- **WHEN** `ccmux task create -d . <agent> -- <raw args>` is invoked
- **THEN** the created task carries the raw args as its `command`

### Requirement: Resume a stopped task

The daemon SHALL resume a `stopped` task via `POST /tasks/{id}/resume`, relaunching the agent against its retained conversation and setting status back to `running`. A `new-session` task SHALL resume back into its project session — the same create-or-attach behavior as a fresh `new-session` run (create the detached, project-named session when absent; open a new window in it when present) — so its placement is preserved across the stop/resume cycle. Every other target SHALL resume into a fresh `new-window` pane. It SHALL build the agent's resume command — claude uses `<binary> --resume <nativeSessionId>`; any agent with a `resumeCommand` uses that template with `{id}` replaced by `nativeSessionId`. The request MAY include an optional follow-up prompt: when present, the daemon SHALL submit it once the resumed agent is ready (the same ready-then-send used for a fresh run); when absent, no prompt is submitted and the conversation is simply re-attached. The resulting session SHALL re-correlate onto the task (new `paneId`/`sessionId`, `nativeSessionId` preserved).

Resume SHALL be gated: the task MUST exist (else `404`), MUST be `stopped`, MUST have a `nativeSessionId`, and its agent MUST be resumable (claude, or an agent with a `resumeCommand`). A failing precondition SHALL yield `400` and launch nothing.

#### Scenario: Resume a stopped task (re-attach only)

- **WHEN** `POST /tasks/{id}/resume` is called with no follow-up prompt for a `stopped` task whose agent is resumable and which has a `nativeSessionId`
- **THEN** the agent is relaunched with its resume command in a new pane, no prompt is submitted, the task re-correlates (new `paneId`/`sessionId`, same `nativeSessionId`), its status becomes `running`, and `task_updated` is broadcast

#### Scenario: Resume a new-session task back into its project session

- **WHEN** `POST /tasks/{id}/resume` is called for a `stopped` `new-session` task
- **THEN** the resume command is launched into the project's session (created detached if absent, or a new window in it if present), rather than a `new-window` in the current session

#### Scenario: Resume with a follow-up prompt

- **WHEN** `POST /tasks/{id}/resume` is called with a follow-up prompt
- **THEN** after the resumed agent is ready the prompt is submitted into it, and the task returns to `running`

#### Scenario: Resume rejects a non-stopped task

- **WHEN** `POST /tasks/{id}/resume` is called for a task that is not `stopped`
- **THEN** the response is `400` and nothing is launched

#### Scenario: Resume rejects a non-resumable agent

- **WHEN** a `stopped` task's agent has no `resumeCommand` and is not claude
- **THEN** the response is `400` with a clear error and nothing is launched

#### Scenario: Resume a missing task

- **WHEN** `POST /tasks/{id}/resume` is called for an unknown id
- **THEN** the response is `404`

### Requirement: Task CLI

The tool SHALL provide a `ccmux task` command group to drive tasks against the daemon: `list`, `create` (with an optional flag to run immediately), `run <ref>`, `resume <ref>`, and `rm <ref>`. Each subcommand SHALL ensure the daemon is running and communicate over the existing `/tasks` HTTP endpoints, mirroring `ccmux spawn`/`invoke`.

`create` SHALL default the working directory to the current directory, overridable with `-d/--dir`, and SHALL fail before contacting the daemon when the resolved directory does not exist. It SHALL NOT force default values for `agent` or `target`: an unset flag is sent as absent so the daemon's default cascade (config `defaults` → per-project → template → input, then built-in `target`) applies.

`run`, `resume`, and `rm` SHALL accept a task reference that is either a full id or a unique id prefix, resolving the prefix CLI-side against the task list: a prefix matching exactly one task resolves to its full id; an ambiguous prefix SHALL error and list the candidates; no match SHALL error. The daemon endpoints continue to take full ids. `resume` calls `POST /tasks/{id}/resume` and SHALL accept an optional `--prompt <text>` follow-up passed in the request body. `list` SHALL accept a `--stopped` flag that filters output to resumable (`stopped`) tasks.

#### Scenario: Create defaults the dir to PWD

- **WHEN** `ccmux task create` is invoked with no `-d/--dir`
- **THEN** the task is created for the current working directory

#### Scenario: Create honors -d/--dir

- **WHEN** `ccmux task create -d <path>` is invoked
- **THEN** the task is created for `<path>`

#### Scenario: Create rejects a nonexistent dir

- **WHEN** `ccmux task create -d <path>` names a directory that does not exist
- **THEN** the CLI errors and no task is created

#### Scenario: Unset agent falls through to config default

- **WHEN** `ccmux task create` is invoked without `--agent` and a config `defaults.agent` is set
- **THEN** the CLI sends no agent and the created task uses the configured default agent

#### Scenario: Create and run from the CLI

- **WHEN** `ccmux task create --agent <a> --prompt <p> --run` is invoked
- **THEN** the task is created via the daemon and immediately run, and its id is reported

#### Scenario: Run by unique id prefix

- **WHEN** `ccmux task run <prefix>` is invoked and exactly one task's id starts with `<prefix>`
- **THEN** that task is run

#### Scenario: Resume by the CLI

- **WHEN** `ccmux task resume <ref>` is invoked for a `stopped` task
- **THEN** the CLI resolves the ref and calls the daemon's resume endpoint

#### Scenario: Resume with a follow-up prompt from the CLI

- **WHEN** `ccmux task resume <ref> --prompt <text>` is invoked
- **THEN** the follow-up prompt is sent in the resume request body

#### Scenario: List only stopped tasks

- **WHEN** `ccmux task list --stopped` is invoked
- **THEN** only tasks with status `stopped` are printed

#### Scenario: Ambiguous prefix errors

- **WHEN** `ccmux task run <prefix>` matches more than one task
- **THEN** the CLI errors and lists the matching candidates without running anything

#### Scenario: List tasks from the CLI

- **WHEN** `ccmux task list` is invoked
- **THEN** the current tasks are printed, including a short id

#### Scenario: Remove a task from the CLI

- **WHEN** `ccmux task rm <ref>` is invoked with a full id or unique prefix
- **THEN** the resolved task is deleted via the daemon
