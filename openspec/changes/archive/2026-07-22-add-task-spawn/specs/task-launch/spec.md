## ADDED Requirements

### Requirement: Run a task into a pane

The daemon SHALL run a task by its `target` via `POST /tasks/{id}/run`, launching the resolved agent with the task's prompt and setting status to `running`. For `new-window` and `split` it SHALL create a tmux pane, capture its `#{pane_id}`, and send the agent command into it. For `send-to-existing` it SHALL send the prompt into the pane identified by `targetRef`, which is REQUIRED for that target. The `new-session` target SHALL be rejected. Running a task that does not exist SHALL yield `404`.

#### Scenario: Run a new-window task

- **WHEN** `POST /tasks/{id}/run` is called for a `new-window` task
- **THEN** a pane is created, the agent command is sent into it, the task's `paneId` is recorded, its status becomes `running`, and a `task_updated` event is broadcast

#### Scenario: Run a split task

- **WHEN** `POST /tasks/{id}/run` is called for a `split` task
- **THEN** a split pane is created and the task is launched into it with its `paneId` recorded

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

### Requirement: Correlate the session by pane id

After a task is launched into a created pane, the daemon SHALL correlate the resulting ccmux session back to the task by matching the session's tmux pane against the task's recorded `paneId`, writing the session's id onto the task and broadcasting `task_updated`. Correlation MUST tolerate the pane binding after launch (the session may appear or bind its pane on a later update). Correlation SHALL be driven off the same session-event path as invocation back-fill and MUST NOT re-read the whole store on every session event.

#### Scenario: Session binding to the task's pane links it

- **WHEN** a ccmux session binds to a pane whose id matches a launched task's `paneId`
- **THEN** the task's `sessionId` is set to that session and a `task_updated` event is broadcast

#### Scenario: Late pane binding still correlates

- **WHEN** a launched task's session appears first without a pane and binds the matching pane on a later update
- **THEN** the task is correlated when the pane binds

#### Scenario: Unrelated pane does not correlate

- **WHEN** a session binds a pane that matches no launched task
- **THEN** no task is modified

### Requirement: Task CLI

The tool SHALL provide a `ccmux task` command group to drive tasks against the daemon: `list`, `create` (with an optional flag to run immediately), `run <id>`, and `rm <id>`. Each subcommand SHALL ensure the daemon is running and communicate over the existing `/tasks` HTTP endpoints, mirroring `ccmux spawn`/`invoke`.

#### Scenario: Create and run from the CLI

- **WHEN** `ccmux task create <project> --agent <a> --prompt <p> --run` is invoked
- **THEN** the task is created via the daemon and immediately run, and its id is reported

#### Scenario: List tasks from the CLI

- **WHEN** `ccmux task list` is invoked
- **THEN** the current tasks are printed

#### Scenario: Remove a task from the CLI

- **WHEN** `ccmux task rm <id>` is invoked
- **THEN** the task is deleted via the daemon
