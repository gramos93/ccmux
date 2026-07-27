## MODIFIED Requirements

### Requirement: Server-side cascade resolution on create

On `POST /tasks` the daemon SHALL resolve the concrete task by folding, per-field with later layers winning, global `defaults` → per-project override (`projects[project]`) → named `template` (when the request names one) → request input, using the daemon's loaded preferences. The `name` field folds through the same cascade. The resolved task SHALL then be validated before persistence; every target in the allowed set (including `new-session`) is accepted. When the resolved task carries no `name`, the daemon SHALL persist a derived default name (see the task-store capability). A validation failure SHALL yield `400` and persist nothing.

#### Scenario: Template and defaults applied server-side

- **WHEN** a client sends `POST /tasks` naming a `template` and providing partial input, with global defaults configured
- **THEN** the created task reflects the cascade (input over template over project over defaults) and is persisted

#### Scenario: new-session accepted over HTTP

- **WHEN** a client sends `POST /tasks` that resolves to `target: "new-session"`
- **THEN** the response is success and the task is persisted (no target value is reserved)

#### Scenario: Default name derived on create

- **WHEN** a client sends `POST /tasks` with a prompt but no `name`
- **THEN** the created task is persisted with a `name` derived from its prompt

#### Scenario: Unknown status rejected

- **WHEN** a client sends `POST /tasks/{id}/status` with a status not in the allowed set
- **THEN** the response is `400` and the task's status is unchanged

#### Scenario: Update missing task

- **WHEN** a client sends `POST /tasks/{id}/status` for an unknown id
- **THEN** the response is `404`

## ADDED Requirements

### Requirement: Edit a task's fields

The daemon SHALL expose `POST /tasks/{id}/edit` that applies an edit — a JSON partial of the editable spec fields (`name`, `prompt`, `agent`, `project`, `target`, `targetRef`, `worktree`, `command`) — to an existing task through the lifecycle manager. The manager SHALL permit an edit ONLY while the task's status is `pending`; editing a task in any other status SHALL yield `409` and change nothing. The edit SHALL merge onto the stored spec and re-validate it (per the task-store capability): a malformed request body or a merged spec that fails validation SHALL yield `400` and change nothing, and an unknown id SHALL yield `404`. On success the manager SHALL persist the change, bump `updatedAt`, and emit the `task_updated` lifecycle event (broadcast to SSE clients via the existing envelope). Fields outside the editable set (`id`, `status`, timestamps, correlation link fields) SHALL be ignored.

#### Scenario: Edit a pending task

- **WHEN** a client sends `POST /tasks/{id}/edit` for a `pending` task with `{ name: "fix login", prompt: "..." }`
- **THEN** the merged spec is re-validated and persisted, `updatedAt` is bumped, and a `task_updated` event is broadcast

#### Scenario: Edit rejected for a non-pending task

- **WHEN** a client sends `POST /tasks/{id}/edit` for a task whose status is `running`, `stopped`, `done`, or `failed`
- **THEN** the response is `409` and the task is unchanged

#### Scenario: Edit with an invalid merge

- **WHEN** a client sends `POST /tasks/{id}/edit` whose merged spec is invalid (e.g. an unknown `target`)
- **THEN** the response is `400` and the task is unchanged

#### Scenario: Edit a missing task

- **WHEN** a client sends `POST /tasks/{id}/edit` for an unknown id
- **THEN** the response is `404`

#### Scenario: Malformed edit body

- **WHEN** a client sends `POST /tasks/{id}/edit` with a body that is not valid JSON
- **THEN** the response is `400` and the task is unchanged
