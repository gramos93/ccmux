## MODIFIED Requirements

### Requirement: Resume a stopped task

The daemon SHALL resume a `stopped` or `done` task via `POST /tasks/{id}/resume`, relaunching the agent against its retained conversation and setting status back to `running`. Resume SHALL always place the relaunched agent into the task's **project-named session** (create-or-attach), never a `new-window` in the currently-attached tmux session — because the task's original pane/window is gone by the time it is resumed. A `new-session` task SHALL resume into its session honoring its explicit `targetRef` name when set, else the project-derived name; every other target SHALL resume into the project-derived session (the tmux-sanitized project basename, path-disambiguated — the same create-or-attach used by a fresh `new-session` run: create the detached, project-named session when absent, open a new window in it when present), ignoring any `targetRef` (which, for `split`/`send-to-existing`, is a pane id, not a session name). It SHALL build the agent's resume command — claude uses `<binary> --resume <nativeSessionId>`; any agent with a `resumeCommand` uses that template with `{id}` replaced by `nativeSessionId`. The request MAY include an optional follow-up prompt: when present, the daemon SHALL submit it once the resumed agent is ready (the same ready-then-send used for a fresh run); when absent, no prompt is submitted and the conversation is simply re-attached. The resulting session SHALL re-correlate onto the task (new `paneId`/`sessionId`, `nativeSessionId` preserved).

Resume SHALL be gated: the task MUST exist (else `404`), MUST be `stopped` or `done`, MUST have a `nativeSessionId`, and its agent MUST be resumable (claude, or an agent with a `resumeCommand`). A failing precondition SHALL yield `400` and launch nothing. (A `done` task with no `nativeSessionId` — e.g. a completed headless invoke — fails this gate; it is re-launched via run, not resume.)

#### Scenario: Resume a stopped task (re-attach only)

- **WHEN** `POST /tasks/{id}/resume` is called with no follow-up prompt for a `stopped` task whose agent is resumable and which has a `nativeSessionId`
- **THEN** the agent is relaunched with its resume command into the task's project-named session (create-or-attach), no prompt is submitted, the task re-correlates (new `paneId`/`sessionId`, same `nativeSessionId`), its status becomes `running`, and `task_updated` is broadcast

#### Scenario: Resume a done task

- **WHEN** `POST /tasks/{id}/resume` is called for a `done` task that has a `nativeSessionId` and a resumable agent
- **THEN** the agent is relaunched against its retained conversation into the project-named session, the task returns to `running`, and `task_updated` is broadcast

#### Scenario: Resume a non-new-session task lands in the project session

- **WHEN** `POST /tasks/{id}/resume` is called for a `stopped`/`done` task whose target is `new-window`, `split`, or `send-to-existing`
- **THEN** the resume is launched into the project-derived session (created detached if absent, or a new window in it if present) — not a `new-window` in the currently-attached session — and any `targetRef` is ignored for placement

#### Scenario: Resume a new-session task back into its project session

- **WHEN** `POST /tasks/{id}/resume` is called for a `stopped` `new-session` task
- **THEN** the resume command is launched into the project's session (created detached if absent, or a new window in it if present), honoring an explicit `targetRef` session name when set

#### Scenario: Resume with a follow-up prompt

- **WHEN** `POST /tasks/{id}/resume` is called with a follow-up prompt
- **THEN** after the resumed agent is ready the prompt is submitted into it, and the task returns to `running`

#### Scenario: Resume rejects a task that is neither stopped nor done

- **WHEN** `POST /tasks/{id}/resume` is called for a task whose status is `pending`, `running`, or `failed`
- **THEN** the response is `400` and nothing is launched

#### Scenario: Resume rejects a non-resumable agent

- **WHEN** a `stopped` task's agent has no `resumeCommand` and is not claude
- **THEN** the response is `400` with a clear error and nothing is launched

#### Scenario: Resume a missing task

- **WHEN** `POST /tasks/{id}/resume` is called for an unknown id
- **THEN** the response is `404`
