## ADDED Requirements

### Requirement: Resume a stopped task

The daemon SHALL resume a `stopped` task via `POST /tasks/{id}/resume`, relaunching the agent against its retained conversation into a fresh `new-window` pane and setting status back to `running`. It SHALL build the agent's resume command — claude uses `<binary> --resume <nativeSessionId>`; any agent with a `resumeCommand` uses that template with `{id}` replaced by `nativeSessionId` — and SHALL NOT submit a new prompt (the conversation is re-attached). The resulting session SHALL re-correlate onto the task (new `paneId`/`sessionId`, `nativeSessionId` preserved).

Resume SHALL be gated: the task MUST exist (else `404`), MUST be `stopped`, MUST have a `nativeSessionId`, and its agent MUST be resumable (claude, or an agent with a `resumeCommand`). A failing precondition SHALL yield `400` and launch nothing.

#### Scenario: Resume a stopped task

- **WHEN** `POST /tasks/{id}/resume` is called for a `stopped` task whose agent is resumable and which has a `nativeSessionId`
- **THEN** the agent is relaunched with its resume command in a new pane, no prompt is submitted, the task re-correlates (new `paneId`/`sessionId`, same `nativeSessionId`), its status becomes `running`, and `task_updated` is broadcast

#### Scenario: Resume rejects a non-stopped task

- **WHEN** `POST /tasks/{id}/resume` is called for a task that is not `stopped`
- **THEN** the response is `400` and nothing is launched

#### Scenario: Resume rejects a non-resumable agent

- **WHEN** a `stopped` task's agent has no `resumeCommand` and is not claude
- **THEN** the response is `400` with a clear error and nothing is launched

#### Scenario: Resume a missing task

- **WHEN** `POST /tasks/{id}/resume` is called for an unknown id
- **THEN** the response is `404`

## MODIFIED Requirements

### Requirement: Task CLI

The tool SHALL provide a `ccmux task` command group to drive tasks against the daemon: `list`, `create` (with an optional flag to run immediately), `run <ref>`, `resume <ref>`, and `rm <ref>`. Each subcommand SHALL ensure the daemon is running and communicate over the existing `/tasks` HTTP endpoints, mirroring `ccmux spawn`/`invoke`.

`create` SHALL default the working directory to the current directory, overridable with `-d/--dir`, and SHALL fail before contacting the daemon when the resolved directory does not exist. It SHALL NOT force default values for `agent` or `target`: an unset flag is sent as absent so the daemon's default cascade (config `defaults` → per-project → template → input, then built-in `target`) applies.

`run`, `resume`, and `rm` SHALL accept a task reference that is either a full id or a unique id prefix, resolving the prefix CLI-side against the task list: a prefix matching exactly one task resolves to its full id; an ambiguous prefix SHALL error and list the candidates; no match SHALL error. The daemon endpoints continue to take full ids. `resume` calls `POST /tasks/{id}/resume`. `list` SHALL accept a `--stopped` flag that filters output to resumable (`stopped`) tasks.

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
