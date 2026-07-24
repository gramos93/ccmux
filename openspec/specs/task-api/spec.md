# task-api

## Purpose

The daemon-facing task plane over the `task-store` data model: a `TaskManager` lifecycle wrapper that emits a discriminated change event per mutation, the `/tasks` HTTP CRUD endpoints (with server-side default-cascade resolution on create), and the `task_created` / `task_updated` / `task_removed` SSE events plus an `init`-frame task snapshot. The manager owns the lifecycle event; the HTTP server is dumb transport that maps it to the wire and broadcasts it — the same shape as the invocation plane.

## Requirements

### Requirement: Task lifecycle manager

The daemon SHALL provide a task manager over the task store that supports list, get, create, update-status, and delete, and SHALL emit a single discriminated lifecycle event after every successful mutation (created, updated, removed). The store remains the sole persistence layer; the manager adds the in-process event that the SSE layer consumes. A subscriber that throws MUST NOT corrupt the mutation or prevent persistence.

#### Scenario: Create emits a created event

- **WHEN** the manager creates a task
- **THEN** the task is persisted and a `created` lifecycle event carrying the new instance is emitted

#### Scenario: Update emits an updated event

- **WHEN** the manager updates an existing task's status
- **THEN** the persisted status changes and an `updated` lifecycle event carrying the updated instance is emitted

#### Scenario: Delete emits a removed event

- **WHEN** the manager deletes a task
- **THEN** the task is removed from persistence and a `removed` lifecycle event carrying the task id is emitted

#### Scenario: Throwing subscriber does not corrupt the mutation

- **WHEN** a lifecycle subscriber throws while handling an event
- **THEN** the mutation and its persistence still complete

### Requirement: Task HTTP endpoints

The daemon HTTP server SHALL expose task CRUD over its existing method set (`GET`, `POST`, `DELETE`). It SHALL provide `GET /tasks` (list), `GET /tasks/{id}` (get), `POST /tasks` (create), `POST /tasks/{id}/status` (update status), and `DELETE /tasks/{id}` (delete). Request bodies SHALL be JSON; a malformed body SHALL yield `400`. Responses SHALL follow the server's existing conventions (list returns `{ tasks }`; a missing resource on get/update returns `404`).

#### Scenario: List returns all tasks

- **WHEN** a client sends `GET /tasks`
- **THEN** the response is `200` with `{ tasks: [...] }` containing every persisted instance

#### Scenario: Get by id

- **WHEN** a client sends `GET /tasks/{id}` for an existing task
- **THEN** the response is `200` with the instance

#### Scenario: Get missing task

- **WHEN** a client sends `GET /tasks/{id}` for an unknown id
- **THEN** the response is `404`

#### Scenario: Malformed create body

- **WHEN** a client sends `POST /tasks` with a body that is not valid JSON
- **THEN** the response is `400` and nothing is persisted

#### Scenario: Delete is idempotent

- **WHEN** a client sends `DELETE /tasks/{id}` for a task that does not exist
- **THEN** the response indicates success and no error is raised

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

### Requirement: Task SSE events

The daemon SHALL broadcast `task_created`, `task_updated`, and `task_removed` events to connected SSE clients when the corresponding lifecycle events occur. Each event SHALL follow the existing envelope (`type` plus `timestamp` and flat top-level fields): create/update carry the task instance, remove carries the task id. The `init` frame sent on connect SHALL include a snapshot of current tasks so a reconnecting client reconciles without a separate request. Clients SHALL dispatch these events through the shared SSE dispatch used by all other event types.

#### Scenario: Create broadcasts task_created

- **WHEN** a task is created and an SSE client is connected
- **THEN** the client receives a `task_created` event carrying the new instance

#### Scenario: Status update broadcasts task_updated

- **WHEN** an existing task's status changes
- **THEN** connected clients receive a `task_updated` event carrying the updated instance

#### Scenario: Delete broadcasts task_removed

- **WHEN** a task is deleted
- **THEN** connected clients receive a `task_removed` event carrying the task id

#### Scenario: Init frame carries a task snapshot

- **WHEN** a client connects to the SSE stream
- **THEN** the initial event includes the current set of tasks

#### Scenario: Unknown event types are ignored

- **WHEN** a client receives an event whose type it does not recognize
- **THEN** the client ignores it without error
