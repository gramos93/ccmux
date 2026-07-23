## Context

Correlation is one-directional (`add-task-spawn`): `TaskManager.correlateSession(paneId, sessionId)` is called from the server's `backfillTaskLink(session)` on every visible session event, links a launched pane to a task via a `pendingCorrelation` (paneId → taskId) map drained on first bind, and writes `sessionId`. There is no reverse: nothing reacts to a linked session going away, so a closed interactive task stays `running`.

The durable identity of a task's conversation is **`Session.nativeSessionId`** — the agent's own convo id (`claude --resume <id>`, `codex resume <id>`, …). ccmux already derives it; the Claude invoker returns it specifically because the ccmux `session.id` (a UUID) is useless for `--resume`. `paneId`/`sessionId` are per-launch and get swapped on a resume; `nativeSessionId` persists. So resume (phase 2) needs `nativeSessionId` on the task — captured here.

## Goals / Non-Goals

**Goals:** capture + refresh `nativeSessionId` at correlation; a `stopped` status; a `running → stopped` transition when a linked session is removed; a `sessionId → taskId` reverse index so both stay off the hot-path store scan.

**Non-Goals:** the `ccmux task resume` action + "stopped tasks" list (phase 2); the task-view rendering and the live-activity display join (phase 3). `stopped` is terminal for now.

## Decisions

**D1 — Two status axes; `running` borrows live activity at the view layer only.** Persisted task status stays the lifecycle (`pending → running → stopped | done | failed`). The linked session's live activity (`working`/`waiting`/`idle`) is surfaced by a *read-time join* on `sessionId` when a task is `running` — never written onto the task. This keeps a resumable-tasks list (`status === "stopped"`) meaningful and avoids churning the task file on every agent tick. `failed` stays background-only (interactive never reaches it — expected, not dead: it's Test-2's terminal). The join itself lands with the task view (phase 3); this change only guarantees the data (`sessionId`, lifecycle status) that enables it.

**D2 — `nativeSessionId` captured at correlation, refreshed on updates.** Extend the correlation to read `session.nativeSessionId`. It is frequently unset at first bind (claude writes its id after turn 1), so correlation must be able to update it on a *later* session event — not only at the initial pane bind. Mechanism: keep the existing `pendingCorrelation` (paneId → taskId) for the first bind, and once bound also record `linkedBySession` (sessionId → taskId); on any subsequent event for a linked session, refresh `nativeSessionId` if it changed (emit `task_updated` only on change, to avoid event spam).

**D3 — Teardown via the `session_removed` path + reverse index.** Add `TaskManager.onSessionRemoved(sessionId)`: look up `linkedBySession`, and if the task is `running`, patch `stopped` (retaining `nativeSessionId`) and drop the index entry. The server calls it from `sessionEventToSSE`'s `removed` branch (where it already emits `session_removed`). Only the true `removed` event triggers teardown — a transient "pane lost but session alive" (the demote-to-removed-on-`updated` case) is out of scope; tie to session death, not pane flux.
- *Alternative — scan the store for a task with `sessionId` on each removal:* rejected; N-file read on an event path. The bounded reverse index matches the `pendingCorrelation` precedent.

**D4 — Guard the transition.** Only `running → stopped`. A removal mapping to a `done`/`failed` task leaves it unchanged (a user who marked a task done, then closed the window, keeps `done`).

**D5 — Correlation call shape.** `backfillTaskLink(session)` passes `session.tmuxPane`, `session.id`, and `session.nativeSessionId` into a single `correlateSession(...)` that handles both first-bind (via pane) and refresh (via the sessionId index). Keeps one call site in the server.

## Risks / Trade-offs

- **`nativeSessionId` never arrives for some agents** (gemini has no resumable id). → The task still stops correctly; it's simply not resumable (phase 2 gates the resume action on `resumeCommand`/`invokeMode.resumeArgs`). No harm here.
- **Reverse index lost on daemon restart** (in-memory). → A task `running` at restart whose session later dies won't auto-stop. Acceptable at POC; a boot reconcile (re-derive links from `running` tasks with a `sessionId` against live sessions) is the escape hatch, deferred.
- **Event spam if `nativeSessionId` refresh emits on every update.** → Emit `task_updated` only when the value actually changes.
- **Pane-lost-but-alive vs truly-removed ambiguity.** → Tie teardown to `session_removed` only (D3); don't stop on transient pane flux.

## Migration Plan

Additive: new optional `nativeSessionId` and new `stopped` status; old task files load unchanged. Reuses `task_updated` and the existing `session_removed` path — no route/protocol change. Rollback = revert; persisted `nativeSessionId`/`stopped` are ignored by older code.

## Open Questions

- Should a `stopped` task auto-clear after some TTL, or persist until the user resumes/removes it? Leaning persist (the whole point is a durable resumable list); revisit if `~/.ccmux/tasks` accumulates.
