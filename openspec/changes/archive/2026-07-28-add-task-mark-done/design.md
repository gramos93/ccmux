## Context

`TaskStatus` already includes `done` (`src/lib/task.ts`), and `POST /tasks/{id}/status` accepts any valid status, so setting `done` needs no new endpoint or data-model change. Today `done` is only reached by `finishBackground` for a completed headless invoke. The board's `resolveTaskActivation` (`src/tui/utils/task-create.ts`) returns `none` for `done`, so enter/`r` do nothing on it; `runOrResumeSelectedTask` (`App.tsx`) routes only `run`/`resume`. The daemon's `resume()` (`task-manager.ts`) hard-rejects anything but `stopped`; `run()` is **not** status-gated (it launches by `target`). Status grouping already renders a `done` group, and `taskStatusColor` already colors `done` green. Teardown-correlation only forces `running → stopped`, so a manually-`done` task is never auto-changed by a session removal.

## Goals / Non-Goals

**Goals:**
- A deliberate mark-done action that keeps the task on the board (distinct from delete).
- `done` tasks remain revivable — resume (re-attach) or run (relaunch).
- Reuse existing endpoints; no schema/protocol change.

**Non-Goals:**
- A separate "reopen" action — reviving *is* resume/run (it moves the task back to `running`).
- Tearing down a running task's pane when marking it done (that's what delete is for).
- A confirmation dialog (mark-done is non-destructive).
- Auto-marking tasks done from any heuristic (this is a user action; background completion already sets `done` on its own).

## Decisions

### D1: Mark-done = `POST /tasks/{id}/status` with `done`, no teardown
A new board keybind fires the existing status endpoint with `done`. The task stays; the `task_updated` broadcast relabels it into the `done` group. **Rationale:** the endpoint and status value already exist; marking done is purely a status transition. **Alternative:** a dedicated `/tasks/{id}/done` endpoint — rejected (nothing to add over the generic status update). Applies to a task in any status (you may finish a `running` one); it relabels only and never kills a pane — use delete for teardown.

### D2: `done` is revivable, mirroring `stopped`
`resolveTaskActivation` gains a `done` arm: **resume** when the task has a `nativeSessionId` (an interactive task whose conversation can re-attach), else **run** (e.g. a headless or never-attached task relaunches fresh). The explicit run/resume action follows the same rule. Reviving transitions the task back to `running` via the existing run/resume paths. **Rationale:** matches the user's "resumed/running if needed" and reuses `stopped`'s exact machinery; `run()` is already status-agnostic so relaunching a `done` task needs no daemon change. **Alternative:** always resume `done` — rejected: a headless/no-`nativeSessionId` done task isn't resumable, so it must fall back to run.

### D3: Widen resume gating to `stopped | done`
`task-manager.resume()` changes its precondition from `status === "stopped"` to `status === "stopped" || status === "done"`; the other gates are unchanged (MUST exist, MUST have a `nativeSessionId`, agent MUST be resumable). A `done` background task with no `nativeSessionId` still fails the `nativeSessionId` gate with `400` — correct, because D2 routes such a task to `run`, not `resume`. **Rationale:** the only reason `done` couldn't resume was this gate; the retained-conversation mechanics are identical to `stopped`.

### D4: No new key mode; a plain `d` in the task branch
Bind mark-done to `d` in the task-view key branch (unused there today; `ctrl-d` is the preview half-page scroll and stays). No confirmation. Add `d done` to the task-view footer. **Rationale:** consistent with the board's other single-key, no-confirm actions (`r`, `e`, `b`); delete keeps its confirm because it's destructive, mark-done doesn't need one.

## Risks / Trade-offs

- **Marking a `running` task done leaves its pane alive** → intended (done ≠ kill). If that session later closes, teardown transitions it to `stopped` (running-only rule), which is still revivable — consistent. Document that delete is the teardown path.
- **Reviving a `done` task that isn't resumable** (no `nativeSessionId`, non-resumable agent) → D2 routes it to `run`, which relaunches fresh; acceptable and matches `pending`.
- **`done` no longer reads as strictly terminal** → it never was in the store (only prose framed `failed` as terminal); `done` is a completion marker, and grouping/coloring already handle it.

## Migration Plan

Additive: a new board action + a widened resume precondition. No endpoint, schema, config, or data migration. Existing `done` (background-completed) tasks simply become revivable too. Rollback = revert the resume gate, the activation arm, and the keybind/action.

## Open Questions

- None blocking. (A future "archive/hide done" filter on the board could keep the done group collapsed by default — out of scope here.)
