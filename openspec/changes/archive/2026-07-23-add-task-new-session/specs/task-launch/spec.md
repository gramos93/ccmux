## MODIFIED Requirements

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
