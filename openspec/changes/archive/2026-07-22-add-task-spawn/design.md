## Context

The daemon has two independent tmux-launch paths with opposite correlation strategies:

- **`/spawn`** (`handleSpawn`, `server.ts`) — creates a pane with `tmux new-window|split-window -c <cwd> -P -F '#{pane_id}'`, sends the agent command via `send-keys`, returns the pane id, and then drops it. No session correlation.
- **`/invoke`** — launches Claude in a *detached* tmux session named `ccmux-invoke-<id>`; the daemon reads that name off the pane at enrich time (`originInvocationIdFromSessionName`) and back-fills the link (`backfillInvocationLink` → `invocationManager.linkSession`), idempotently, tolerating late pane binding.

For tasks, the `/invoke` name-tag trick does not apply: `new-window`/`split` panes live in the **user's own** tmux session, so the pane's `sessionName` is the user's, not a ccmux tag. The usable correlation key is the **pane id captured at launch** matched against `session.tmuxPane` (the field lookup already used by `resolveSession`). Task launch is otherwise greenfield: `TaskManager` is CRUD-only, the `worktree` field is inert, and there is no `ccmux task` CLI.

## Goals / Non-Goals

**Goals:**
- `POST /tasks/{id}/run` + `TaskManager.run` launching `new-window`/`split`/`send-to-existing`, recording `paneId`, status → `running`.
- Session correlation by captured pane id, mirroring `backfillInvocationLink`, off the hot session-event path without per-event disk reads.
- `TaskInstance.paneId`/`sessionId` + a store `patchTask` to persist them.
- A minimal `ccmux task` CLI (list/create/run/rm) for human use and E2E testing.
- Tests: launcher (injected spawn), manager run + correlation, HTTP run route, store patch.

**Non-Goals:**
- Worktree creation (`git worktree add`) — entirely greenfield; the `worktree` field stays inert.
- Auto-completing task status from session/agent state (status stays `running` until set via `POST /tasks/{id}/status`).
- TUI board rendering, keymap mirror, `new-session` target.

## Decisions

**D1 — Correlate by captured pane id, not by tmux session name.** `new-window`/`split` panes are in the user's session, so the `ccmux-invoke-<id>` name trick can't work. Record the task's `paneId` at launch and match `session.tmuxPane === paneId` when a session binds. This reuses the exact field lookup in `resolveSession` (`s.tmuxPane === id`) and `hook-adapter`.
- *Alternative — launch every task in a detached `ccmux-task-<id>` session (full `/invoke` mirror):* rejected for `new-window`/`split`, which are explicitly interactive/in-session; a detached session defeats the point (the user wants the pane in their layout). The pane-id key works for all created-pane targets uniformly.

**D2 — Correlation runs off `sessionEventToSSE` via an in-memory pane→task index.** Add `backfillTaskLink(session)` called from `sessionEventToSSE` on every visible created/updated event (exactly where `backfillInvocationLink` is called). It calls `taskManager.correlateSession(session.tmuxPane, session.id)`. `TaskManager` holds `pendingCorrelation: Map<paneId, taskId>`, populated by `run()` and drained on match — so the hot path is a `Map.get`, never a store scan. On match: `patchTask(taskId, { sessionId })`, delete the map entry, emit `updated`. Idempotent and late-binding-tolerant (the entry lives until a pane matches).
- *Alternative — scan the store on each session event:* rejected; that's an N-file read on a hot path. The bounded in-memory index (only launched-but-uncorrelated tasks) is the same shape as `InvocationManager`'s live maps.

**D3 — Launcher is a separate, injectable module (`task-launcher.ts`).** A pure `buildTaskCommand(task, agentBinary)` (agent binary + single-quote-escaped `--prompt`, reusing the `handleSpawn` idiom) plus a `launchTask(task, deps)` that runs tmux. `deps` = `{ getAgentByType, spawn, prefs }`, so tests inject a fake spawn and assert the tmux args without touching real tmux. `TaskManager.run` takes the launcher as an injected dep (default = the real one) — the same testability seam `InvocationManager` uses for its registry. `new TaskManager()` with no args keeps working (default launcher); `index.ts` constructs it with the real agent lookup + `Bun.spawn`.
- *Alternative — inline tmux in `TaskManager` like `handleSpawn` does:* rejected; couples the manager to tmux and makes `run` untestable without a live server.

**D4 — Targets.** `new-window`/`split` → create pane (`-P -F '#{pane_id}'`), `send-keys` the command, record `paneId`, register pending correlation. `send-to-existing` → require `targetRef`, `send-keys` the prompt into it, and correlate immediately (the session owning `targetRef` is already known via `tmuxPane === targetRef`) — no pending entry. `new-session` → `400`. This rounds out the useful "send prompt to a running agent" flow cheaply while keeping pane creation and correlation coherent.

**D5 — Data model + store patch.** `TaskInstance` gains optional `paneId`/`sessionId` (set post-launch, so not part of `TaskSpec`). The store gains `patchTask(id, patch)` — a single-file read-modify-write that merges partial fields and refreshes `updatedAt`, returning the instance or `undefined`. `updateTaskStatus` is re-expressed as `patchTask(id, { status })` to avoid two near-identical writers.

**D6 — Status lifecycle this slice.** `run` sets `pending → running`. Correlation does not change status (it only links `sessionId`). Completion (`running → done/failed`) remains a manual `POST /tasks/{id}/status` / `ccmux task` concern; deriving it from session/agent state is a later slice.

## Risks / Trade-offs

- **A pane id can be reused by tmux after a pane closes**, so a stale `pendingCorrelation` entry could mis-link a later unrelated session. → Entries are drained on first match and only exist between launch and correlation (seconds); a task whose session never binds keeps a harmless stale entry until daemon restart. Acceptable at POC scale; a TTL sweep (as `InvocationManager` uses) is the escape hatch if it bites.
- **`run` shells the prompt via `send-keys`** — same injection surface `handleSpawn` already has; reuse its single-quote escaping rather than inventing new handling.
- **Daemon restart loses `pendingCorrelation`** (in-memory), so a task launched-but-not-yet-correlated before a restart won't auto-link. → `sessionId` that already persisted survives; only in-flight correlation is lost. Rebuilding the index from `running` tasks with a `paneId` but no `sessionId` on boot is a cheap future addition, out of scope now.
- **`send-to-existing` correlation assumes a session already owns `targetRef`.** → If none does, the task simply stays uncorrelated (prompt still sent); no error, matching the fire-and-forth nature of sending to a user-owned pane.

## Migration Plan

Additive. New route + CLI; reuses `task_updated`. `TaskInstance` gains two optional fields — old task files load unchanged, and `patchTask` supersedes `updateTaskStatus`'s internals without changing its signature. No protocol version bump. Rollback = revert; persisted `paneId`/`sessionId` on any files are simply ignored by the older code.

## Open Questions

- Should `run` be idempotent (re-running a `running` task) or reject a second run? Leaning: allow re-run (re-send prompt / re-spawn) but that risks orphan panes — deferred; for now `run` always launches. Revisit if double-run becomes a real UX path.
