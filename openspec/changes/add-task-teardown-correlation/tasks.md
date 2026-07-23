## 1. Model (`src/lib/task.ts` + store)

- [x] 1.1 Add `"stopped"` to `TaskStatus` and `VALID_TASK_STATUSES`
- [x] 1.2 Add optional `nativeSessionId?: string` to `TaskInstance`
- [x] 1.3 Extend `patchTask`'s allowed keys with `nativeSessionId` (store)

## 2. Correlation captures nativeSessionId (`src/daemon/task-manager.ts`)

- [x] 2.1 Change `correlateSession` to accept the session's `nativeSessionId` alongside `paneId`/`sessionId` (e.g. `correlateSession(paneId, sessionId, nativeSessionId?)`)
- [x] 2.2 On first bind (pane in `pendingCorrelation`): set `sessionId` (+ `nativeSessionId` if present), record `linkedBySession` (sessionId → taskId), drain the pending entry, emit `updated`
- [x] 2.3 On a subsequent event for an already-linked session: refresh `nativeSessionId` when it changed; emit `updated` only on change (no spam)

## 3. Teardown on session removal (`src/daemon/task-manager.ts` + `server.ts`)

- [ ] 3.1 Add `onSessionRemoved(sessionId)`: look up `linkedBySession`; if the task is `running`, `patchTask(id, { status: "stopped" })` (retain `nativeSessionId`), drop the index entry, emit `updated`; no-op otherwise
- [ ] 3.2 `backfillTaskLink(session)` passes `session.nativeSessionId` into `correlateSession`
- [ ] 3.3 Call `taskManager.onSessionRemoved(sessionId)` from `sessionEventToSSE`'s `removed` branch (true session death only, not transient pane loss)

## 4. Tests

- [ ] 4.1 Manager: `correlateSession` captures `nativeSessionId` at bind; refreshes it on a later call when it changed (emits once); no emit when unchanged
- [ ] 4.2 Manager: `onSessionRemoved` transitions a linked `running` task → `stopped` keeping `nativeSessionId`; unrelated sessionId is a no-op; a linked `done` task is left unchanged
- [ ] 4.3 Server: a `session_removed` event for a linked task stops it (drive `internals` with a linked task + removed event); an unrelated removal changes nothing
- [ ] 4.4 Store: `patchTask` round-trips `nativeSessionId`; `stopped` validates as a status

## 5. Verification

- [ ] 5.1 `bun run typecheck` passes
- [ ] 5.2 `bun test` passes
- [ ] 5.3 Live smoke (isolated daemon, real claude): create+run an interactive task; `ccmux task list` shows `running` with a `sessionId`, then `nativeSessionId` populates after the first turn; close the pane/agent → the task flips to `stopped` and retains `nativeSessionId`
- [ ] 5.4 Confirm no renderer/resume/TUI-board code added (phase 1 is data + transition only)
