## Why

Tasks can be created, listed, and mutated, but nothing runs them — the launch/track plane can track, not launch. This change makes a task actually execute: spawn a tmux window/split (or send to an existing pane), launch the agent with the task's prompt, and correlate the resulting ccmux session back to the task so the board can show where a task landed and jump to it. It is the launch half of the plane, mirroring the daemon's proven `/invoke` correlation pattern but adapted to in-session panes.

## What Changes

- Add `POST /tasks/{id}/run` and a `TaskManager.run(id)` that launches a task by its `target`:
  - `new-window` / `split` — create a pane via tmux (`-P -F '#{pane_id}'`, reusing the `/spawn` idiom), send the resolved agent command + prompt into it, capture the pane id, set status `running`.
  - `send-to-existing` — send the prompt into the pane named by `targetRef` (required for this target); correlate to the session already owning that pane.
  - `new-session` stays reserved → `400`.
- **Session correlation by captured pane id.** `/spawn` today captures `#{pane_id}` but drops it, and the `/invoke` name-tagged-session trick can't apply to a pane living in the user's own tmux session. So the task records its `paneId` at launch, and when a ccmux session binds to that pane (`session.tmuxPane === paneId`), the daemon back-fills the task's `sessionId` — mirroring `backfillInvocationLink`, tolerant of the pane binding late. A small in-memory pane→task index keeps the hot session-event path off disk.
- **BREAKING (data model, additive):** `TaskInstance` gains optional `paneId` and `sessionId` correlation fields, set post-creation. The store gains a field-patch operation to write them (and refresh `updatedAt`).
- Add a minimal `ccmux task` CLI (`list`, `create [--run]`, `run <id>`, `rm <id>`) modeled on `ccmux spawn`/`invoke`, so tasks are drivable by a human and end-to-end testable.
- Broadcast `task_updated` on run and on correlation (existing SSE type; no new event).

Non-goals (later slices): worktree creation (`git worktree add` — entirely greenfield; the `worktree` field stays inert intent), auto-completion of task status from session/agent state, the TUI board view, and the keymap mirror.

## Capabilities

### New Capabilities
- `task-launch`: Running a task into a tmux pane by target, capturing the pane id, correlating the resulting session back to the task by pane id, and the `ccmux task` CLI that drives it.

### Modified Capabilities
- `task-store`: `TaskInstance` gains optional `paneId`/`sessionId` link fields (data model), and the store gains a field-patch operation to set post-creation fields (instance persistence).

## Impact

- **New code:** `src/daemon/task-launcher.ts` (pure command build + injectable tmux spawn), `TaskManager.run` + pane→task correlation index (`src/daemon/task-manager.ts`), `POST /tasks/{id}/run` handler + `backfillTaskLink` in `src/daemon/server.ts`, `src/commands/task.ts` CLI (+ registration in `src/index.ts`).
- **Modified code:** `src/lib/task.ts` (`TaskInstance.paneId`/`sessionId`), `src/lib/task-store.ts` (`patchTask`), `src/daemon/server.ts` (`sessionEventToSSE` calls `backfillTaskLink`; run route).
- **Consumes (unchanged):** the `/spawn` tmux idiom, `resolveTask`/`validateNewTask`, `getPreferences`, agent lookup, `session.tmuxPane`.
- **Protocol:** additive route; reuses `task_updated` SSE. No new event type. Task files gain two optional fields (old files load unchanged).
- **Dependencies:** none added.
