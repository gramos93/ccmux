## Context

The TUI (`@opentui/solid`) holds a single `createStore<TUIState>` in `src/tui/store.ts`; `sessions` is an array mutated by actions (`addSession`/`updateSession`/`removeSession`, `findIndex` by id) and reconciled from the `init` snapshot via `reconcileInvocations`'s pattern. The `SSEClient` is built in `App.tsx onMount` (~:570) — it wires session/invocation callbacks but **omits the task callbacks**, and `onInit` takes `(sessions, activePaneId, invocations)` so `init.tasks` (already on the wire, `events.ts`) is dropped. `dispatchSSEEvent` (`sse.ts`) already routes `task_*` and `onInit` — the arms are just unfed.

There is **no `view` field** — only a `sidebar` boolean threaded from the CLI through `launchTUI → App → store` and read in ~a dozen places (`resolveLayout`, preview/footer gating, focus). Rows render via `SessionList → SessionItem` with `resolveLayout`; `agentColorFor` (`SessionItem.tsx`) and `StatusBadge`/`getStatusColor` are reusable. Daemon actions are fire-and-forget `fetch(getDaemonUrl()+path)`; `POST /tasks/{id}/resume` and `DELETE /tasks/{id}` already exist. A task's `sessionId` joins to a live session via the existing `getSessionById`.

## Goals / Non-Goals

**Goals:** a `tasks` store slice fed by SSE + init; a `view` toggle to a `TaskBoard`; task rows with status/agent/project + live-activity join for running tasks; resume + delete row actions; unit tests + a real detached-tmux render check.

**Non-Goals:** resume-with-prompt from the TUI (needs an input modal — CLI has it), task creation in the TUI, a full `sidebar → view` refactor, kanban columns.

## Decisions

**D1 — Additive `view` toggle, not a `sidebar → view` refactor.** Add `view: "sessions" | "tasks"` to `TUIState` (default `"sessions"`), toggled by `t`. The render branches the middle region on `store.state.view` — `<TaskBoard>` vs `<SessionList>`. The launch-time `sidebar` boolean is left exactly as-is (it still drives columns/preview/footer). Rationale: a full generalization touches ~12 `sidebar` sites for no user benefit here; the toggle is one field + one branch + one keybind, and composes with both picker and sidebar launch modes.
- *Alternative — generalize `sidebar` to `view` everywhere:* rejected as scope/ risk out of proportion to the feature.

**D2 — `tasks` slice mirrors `sessions`; SSE wired the same way.** `tasks: TaskInstance[]` in the store; `setTasks/addTask/updateTask/removeTask` by `id`; `reconcileTasks(snapshot)` copying `reconcileInvocations`. In `App.tsx` add the three task callbacks to the `SSEClient` literal, and extend `onInit` to accept a 4th `tasks?` arg (with `dispatchSSEEvent` passing `event.tasks`); `onInit` calls `reconcileTasks(tasks ?? [])`. Optional arg keeps an older daemon safe.

**D3 — `TaskBoard`/`TaskRow`, reusing session chrome.** `TaskRow` renders: short id (first 8), a **task-status** badge (new `pending→overlay, running→peach, stopped→yellow, done→green, failed→red` map — `TaskStatus` isn't `SessionStatus`, so `getStatusColor` can't be reused directly, but the shape is copied), agent via `agentColorFor`, the project basename, and for a `running` task the joined session's live activity via `<StatusBadge>` (from `getSessionById(task.sessionId)`; blank when unlinked). Flat list, `j/k` selection, mirroring `SessionItem` styling for visual consistency.
- *Live-activity is display-only (D of the phase-1 two-axes decision):* the borrowed `working/waiting/idle` is never written to the task; it's a read-time join at render.

**D4 — Row actions are fire-and-forget POSTs; the SSE echo updates the row.** `enter`/`r` on a `stopped` row → `POST /tasks/{id}/resume` (empty body = re-attach); `x` → `DELETE /tasks/{id}`. We don't optimistically mutate the store — the daemon's `task_updated`/`task_removed` broadcast flows back through the (now-wired) SSE path and updates the board, same as session actions. Keys are dispatched from a task-view guard in the `useKeyboard` handler so they don't collide with session nav.

**D5 — Verification includes a real render.** Per AGENTS.md, unit tests don't prove rendering. After the component/wiring work, launch the picker in a detached tmux session with a known viewport, toggle to the board, and `capture-pane` to confirm task rows render (status colors, agent, live activity) and the empty state reads sensibly.

## Risks / Trade-offs

- **`view` adds a mode the keyboard handler must guard.** → A single early `if (store.state.view === "tasks") { …; return; }` block (near the existing modal guards) keeps board keys isolated from session nav; `t` toggles back.
- **A running task whose `sessionId` isn't yet linked shows no activity.** → Blank activity cell until correlation lands (seconds); acceptable and self-heals via `task_updated`.
- **Reconnect races** (init snapshot vs a `task_*` that arrived first). → Same ordering guarantee sessions/invocations rely on: SSE events are processed in order and `reconcileTasks` replaces wholesale on `init`, so a post-init event applies after.
- **Renderer regressions are invisible to `bun test`.** → D5's detached-tmux capture is mandatory, not optional.

## Migration Plan

Additive: new store field/slice, new components, new keybind. No protocol/daemon change (the wire already carries everything). `sidebar` semantics unchanged. Rollback = revert; the daemon is unaffected.

## Revision (post-MVP feedback): grouped, session-viewer-like board

Live use of the flat MVP surfaced four gaps; this revision addresses them.

**D6 — Group headers, default group-by `status`, cyclable to `project`.** The board renders group headers like the session pane. Default groups by lifecycle `status` (so the `stopped` group *is* the resumable list); `b` cycles `status → project → none`. A new `taskGroupBy` store field + a task-grouping util (parallel to `utils/grouping.ts`, keyed on `TaskInstance`). Selection/`j`/`k` skip headers, mirroring the session flat-item model.

**D7 — Kind indicator per row.** Show whether a task is background (headless invoke) or an interactive pane, from `task.target` (`background` vs `new-window`/`split`/`send-to-existing`). A short badge in the row; `kind` is also a groupable dimension later if wanted.

**D8 — Parallel `TaskList`, not a generalized shared list.** Build `TaskList` (its own scrollbox + group headers + `TaskRow`) copying the `SessionList` patterns, rather than making the session pipeline item-agnostic. Chosen per user call: lower blast-radius on the proven session path, at the cost of some duplication. `TaskGroupHeader` may reuse `GroupHeader` where the shape fits.

**D9 — Fix the view-swap scroll bug directly.** Root cause: toggling to the board unmounts `SessionList` (it's the `<Show>` fallback); on remount its scrollbox starts zero-size and the scroll-into-view effect doesn't re-fire, so `j/k` moves selection but `scrollTo` clamps against a stale viewport — "stops before the end." Since a parallel `TaskList` keeps the `<Show>` swap, fix `SessionList` to re-measure on (re)mount: bump the `scrollboxLayout` signal when the scrollbox ref is assigned / first lays out, so the scroll effect re-runs with real dimensions. (Full-reuse would have sidestepped this by never unmounting; with the parallel choice it's a targeted fix.)

**D10 — `done` is background-only (confirmed).** Interactive tasks are `pending → running → stopped`; only invoke tasks reach `done`/`failed`. The board's status grouping reflects this. Whether interactive tasks should be markable `done` is left open (below).

## Open Questions

- Should `enter` on a *running* task jump to its live session (reusing the session activate/switch path)? Deferred.
- Should interactive tasks have a `done` terminal (user-marked), or stay `stopped`-until-`rm`? Currently `done` is bg-only (D10).
- Nested grouping ("status **then** project" as two levels) vs a single cyclable dimension: shipping single-level cyclable first (D6); nesting can follow.
