## MODIFIED Requirements

### Requirement: Run a task into a pane

The daemon SHALL run a task by its `target` via `POST /tasks/{id}/run`, launching the resolved agent with the task's prompt and setting status to `running`. For pane targets (`new-window`, `split`, `new-session`) the daemon SHALL verify the task's working directory exists before creating the pane, failing with a clear error when it does not (it may have been deleted between create and run). For `new-window` and `split` it SHALL create a tmux pane, capture its `#{pane_id}`, and launch the agent **adaptively**: run the agent's interactive binary (`executable`, or `resumeCommand` when resuming a session), and once the agent signals readiness (its `readyPattern`, with a timeout fallback) deliver the prompt by submitting it into the agent's composer (a bracketed paste followed by a separate Enter — the proven `sendPromptToPane` mechanism) — NOT via a hardcoded prompt flag and NOT a batched `send-keys <text> Enter` (which leaves the text unsubmitted). For `new-session` it SHALL launch into a dedicated tmux session named after the project (a tmux-sanitized basename), created detached (`tmux new-session -d`) and cd'd to the working directory, capturing its `#{pane_id}` and launching the agent adaptively exactly as for `new-window`; the daemon SHALL stamp each session it creates for a `new-session` task with the tmux user option `@ccmux_project` set to the task's project path. When a session of the project's name already exists the daemon SHALL reuse it (open a new window in it) ONLY when that session's `@ccmux_project` equals the task's project; when the existing session belongs to a different project or has no `@ccmux_project` stamp, the daemon SHALL instead resolve a deterministic disambiguated session name (the sanitized basename plus a short stable suffix derived from the full project path) and apply the same create-or-attach rule to that name, so a task never joins a session that belongs to another project. The disambiguated name SHALL be stable across runs and resume for a given project. When the task carries a raw `command`, that argv SHALL be launched verbatim instead (see the passthrough requirement). For `send-to-existing` it SHALL send the prompt into the pane identified by `targetRef`, which is REQUIRED for that target. Running a task that does not exist SHALL yield `404`.

#### Scenario: Run a new-window task adaptively

- **WHEN** `POST /tasks/{id}/run` is called for a `new-window` task
- **THEN** a pane is created, the agent's interactive binary is launched, the prompt is delivered after the agent is ready, the task's `paneId` is recorded, its status becomes `running`, and a `task_updated` event is broadcast

#### Scenario: Run a split task

- **WHEN** `POST /tasks/{id}/run` is called for a `split` task
- **THEN** a split pane is created and the task is launched into it adaptively with its `paneId` recorded

#### Scenario: Run a new-session task creates a project session

- **WHEN** `POST /tasks/{id}/run` is called for a `new-session` task and no tmux session of the project's name exists
- **THEN** a detached tmux session named after the project is created and cd'd to the working directory, its `@ccmux_project` user option is set to the task's project path, the agent is launched into it adaptively, the task's `paneId` is recorded, its status becomes `running`, and a `task_updated` event is broadcast

#### Scenario: new-session reuses a same-named session owned by the same project

- **WHEN** `POST /tasks/{id}/run` is called for a `new-session` task and a tmux session of the project's name already exists whose `@ccmux_project` equals the task's project
- **THEN** a new window is opened in that existing session (no duplicate session) and the task is launched into it adaptively with its `paneId` recorded

#### Scenario: new-session disambiguates when the name belongs to a different project

- **WHEN** `POST /tasks/{id}/run` is called for a `new-session` task and a tmux session of the project's name already exists whose `@ccmux_project` does not match the task's project (a different project, or an unstamped session created outside ccmux)
- **THEN** the task is launched into a session under a deterministic disambiguated name derived from the full project path (created or reused per the same ownership rule and stamped with `@ccmux_project`), never into the unrelated same-named session

#### Scenario: Disambiguated name is stable across resume

- **WHEN** a `new-session` task that was placed under a disambiguated name is stopped and later resumed
- **THEN** resolving the session name for the same project yields the same disambiguated name, so the resume re-creates or attaches to that same project session

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
