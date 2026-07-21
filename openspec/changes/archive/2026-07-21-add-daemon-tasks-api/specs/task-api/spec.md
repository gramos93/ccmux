## ADDED Requirements

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

On `POST /tasks` the daemon SHALL resolve the concrete task by folding, per-field with later layers winning, global `defaults` → per-project override (`projects[project]`) → named `template` (when the request names one) → request input, using the daemon's loaded preferences. The resolved task SHALL then be validated (rejecting the reserved `new-session` target) before persistence. A validation failure SHALL yield `400` and persist nothing.

#### Scenario: Template and defaults applied server-side

- **WHEN** a client sends `POST /tasks` naming a `template` and providing partial input, with global defaults configured
- **THEN** the created task reflects the cascade (input over template over project over defaults) and is persisted

#### Scenario: Reserved target rejected over HTTP

- **WHEN** a client sends `POST /tasks` that resolves to `target: "new-session"`
- **THEN** the response is `400` and nothing is persisted

#### Scenario: Unknown status rejected

- **WHEN** a client sends `POST /tasks/{id}/status` with a status not in the allowed set
- **THEN** the response is `400` and the task's status is unchanged

#### Scenario: Update missing task

- **WHEN** a client sends `POST /tasks/{id}/status` for an unknown id
- **THEN** the response is `404`

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
