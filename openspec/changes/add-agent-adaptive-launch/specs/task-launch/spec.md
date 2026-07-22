## MODIFIED Requirements

### Requirement: Run a task into a pane

The daemon SHALL run a task by its `target` via `POST /tasks/{id}/run`, launching the resolved agent with the task's prompt and setting status to `running`. For `new-window` and `split` it SHALL create a tmux pane, capture its `#{pane_id}`, and launch the agent **adaptively**: run the agent's interactive binary (`executable`, or `resumeCommand` when resuming a session), and deliver the prompt via `send-keys` once the agent signals readiness (its `readyPattern`, with a timeout fallback) — NOT via a hardcoded prompt flag. When the task carries a raw `command`, that argv SHALL be launched verbatim instead (see the passthrough requirement). For `send-to-existing` it SHALL send the prompt into the pane identified by `targetRef`, which is REQUIRED for that target. The `new-session` target SHALL be rejected. Running a task that does not exist SHALL yield `404`.

#### Scenario: Run a new-window task adaptively

- **WHEN** `POST /tasks/{id}/run` is called for a `new-window` task
- **THEN** a pane is created, the agent's interactive binary is launched, the prompt is delivered after the agent is ready, the task's `paneId` is recorded, its status becomes `running`, and a `task_updated` event is broadcast

#### Scenario: Run a split task

- **WHEN** `POST /tasks/{id}/run` is called for a `split` task
- **THEN** a split pane is created and the task is launched into it adaptively with its `paneId` recorded

#### Scenario: Prompt delivered without a hardcoded flag

- **WHEN** a non-Claude agent task is run in a pane
- **THEN** the launch uses the agent's own `executable`/`resumeCommand` and ready-then-send, not `<binary> --prompt <text>`

#### Scenario: send-to-existing requires targetRef

- **WHEN** `POST /tasks/{id}/run` is called for a `send-to-existing` task with no `targetRef`
- **THEN** the response is `400` and the task is not launched

#### Scenario: send-to-existing sends to the referenced pane

- **WHEN** `POST /tasks/{id}/run` is called for a `send-to-existing` task with a valid `targetRef`
- **THEN** the prompt is sent into that pane and the task status becomes `running`

#### Scenario: Run rejects new-session

- **WHEN** `POST /tasks/{id}/run` is called for a task whose target is `new-session`
- **THEN** the response is `400` and nothing is launched

#### Scenario: Run a missing task

- **WHEN** `POST /tasks/{id}/run` is called for an unknown id
- **THEN** the response is `404`

## ADDED Requirements

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
