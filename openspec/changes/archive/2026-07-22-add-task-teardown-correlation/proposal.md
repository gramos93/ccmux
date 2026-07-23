## Why

Correlation is one-directional today: a task links to its ccmux session when the session *binds* the launched pane, but nothing updates the task when that session/pane goes away — so a closed interactive task sits at `running` forever, and the viewer (which drops the agent once it's gone) and the task list disagree. This change closes the loop: it captures the agent's **durable conversation id** (`nativeSessionId`) so a task can later be resumed, and transitions a task to a new `stopped` state when its agent/pane closes. This is phase 1 of the task lifecycle work — it banks the resume key and the teardown transition; the resume *action* and the task-view rendering are later phases.

## What Changes

- **Capture the durable conversation id.** During correlation the daemon reads `Session.nativeSessionId` (the agent's own convo id — what `claude --resume <id>` / `codex resume <id>` take) and stores it on the task, refreshing it on later updates (claude writes its id only after the first turn, so it arrives after the pane binds). `paneId`/`sessionId` remain per-launch pointers; `nativeSessionId` is the durable anchor that survives a future resume.
- **`stopped` task status.** Add `stopped` = the task's agent/pane closed but `nativeSessionId` is retained → resumable. Terminal for now; phase 2 makes it resumable.
- **Teardown transition.** When a session linked to a task is removed, the daemon transitions that task `running → stopped`. Driven off the existing session-event path via a `sessionId → taskId` reverse index (mirror of the bind-time `pendingCorrelation` map), so no store scan on the hot path.
- **Status axes stay separate.** Persisted task status remains the lifecycle (`pending → running → stopped | done | failed`). The linked session's live activity (`working`/`waiting`/`idle`) is *borrowed for display* by a read-time join on `sessionId` while a task is `running` — not persisted onto the task. `failed` remains the background-invoke terminal (interactive tasks never set it; expected).

Non-goals (later phases): the `ccmux task resume` action + "stopped tasks" list (phase 2); the task-view rendering and the live-activity display join (phase 3). This change only lands the data (`nativeSessionId`) and the `running → stopped` transition that unblock both.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `task-store`: `TaskStatus` gains `stopped`; `TaskInstance` gains `nativeSessionId` (durable resume key).
- `task-launch`: correlation also captures/refreshes `nativeSessionId`; a new teardown behavior transitions a linked task to `stopped` on session removal.

## Impact

- **Modified code:** `src/lib/task.ts` (`TaskStatus += "stopped"`, `TaskInstance.nativeSessionId`), `src/lib/task-store.ts` (`patchTask` allows `nativeSessionId`), `src/daemon/task-manager.ts` (correlation captures `nativeSessionId`; `sessionId → taskId` index; `onSessionRemoved`), `src/daemon/server.ts` (`backfillTaskLink` passes `nativeSessionId`; call `taskManager.onSessionRemoved` on the `session_removed` path).
- **Reused (unchanged):** `Session.nativeSessionId` (already derived), the existing correlation call site, the `session_removed` event.
- **Protocol:** reuses `task_updated`; new optional `nativeSessionId` field + `stopped` status (old task files load unchanged). No route change.
- **Dependencies:** none.
