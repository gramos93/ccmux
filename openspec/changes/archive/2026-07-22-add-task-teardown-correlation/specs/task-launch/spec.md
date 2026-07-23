## MODIFIED Requirements

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

## ADDED Requirements

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
