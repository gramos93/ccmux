## Context

The middle region (`App.tsx:1482-1543`) is a `flexDirection="row"` box. The session branch renders `SessionList` + a `<Show when={!sidebar && showPreview}>` that picks `Preview` (a single session's live pane capture) or `GroupPreview` (a no-capture roll-up). The task branch renders only `<TaskList>` — no preview. `Preview` takes `{ session, width, focused, refreshKey, searchQuery, onScrollboxRef }` and captures via `capturePane()`. `GroupPreview` uses the same right-pane chrome (`width%`, left border, header) but no capture. `getSessionById(id)` (App.tsx:918) joins a task's `sessionId` to a live `EnrichedSession`. The store already has `showPreview`, `previewWidth`, `previewFocused`, a `previewRefreshKey` signal, `selectedTaskId`, and `taskFlatItems`/`selectedTaskFlatIndex` — but no `selectedTask()` instance memo. `TaskRow` leads with `id.slice(0,8)`. Slice A added `taskDisplayName(task)`.

## Goals / Non-Goals

**Goals:**
- Board rows lead with the task's display name; the pane on the right reflects the selected task.
- Reuse `Preview` verbatim for running-linked tasks; a new `TaskDetail` for everything else.
- Reuse the session view's preview state and keybinds — no new toggle model, no new config.

**Non-Goals:**
- A contextual/action footer, board filter/search, or a board-specific preview-width control (excluded from this slice).
- The create/edit form, clone, delete-confirm (slice C).
- Any daemon/API/SSE change.

## Decisions

### D1: Reuse `Preview` for a running, session-linked task
When the selected task is `running` and `getSessionById(task.sessionId)` resolves, render the existing `Preview` with that session — identical to the session view (live capture, focus, scroll, cross-server guard all for free). **Rationale:** the running task *is* a live pane; the session view already renders that perfectly. **Alternative:** a task-specific pane viewer — rejected (duplicates `Preview`).

### D2: New `TaskDetail` pane for paneless / non-running tasks
For pending/stopped/done/failed (or running-but-unlinked) tasks, render a new `TaskDetail` mirroring `GroupPreview`'s chrome (`width={previewWidth}%`, left border, header, `useTerminalDimensions`-based separator). It shows: display name (header), status (colored via `taskStatusColor`), agent, project, target and — for `new-session` — the resolved/explicit session name (`targetRef`) or the derived project session name, the full **scrollable** prompt, worktree intent, created/updated, linked `sessionId`, and for `failed` a short error/hint line. No tmux capture. **Rationale:** a task with no pane still has rich detail worth previewing; `GroupPreview` is the established no-capture template.

### D3: `selectedTask()` memo + default selection
Add a store memo `selectedTask()` = the instance whose id is `selectedTaskId`, falling back to the first task in `taskFlatItems` order (so the pane is never blank when tasks exist). Ensure entering the board (or tasks arriving) leaves `selectedTaskId` pointing at a real row; `moveTaskSelection` already maintains it thereafter. The task-view layout passes `selectedTask()` to the pane; `Preview` re-captures on its `session` prop change (existing effect), and `TaskDetail` is pure-reactive. **Alternative:** drive the pane off `selectedTaskFlatIndex` — rejected; a resolved instance is cleaner and matches `selectedSession()`.

### D4: Reuse preview state + extend the keybinds to the task view
The board pane is gated by the same `!sidebar && showPreview` and sized by `previewWidth`; focus/scroll uses `previewFocused`. The existing `p` → `togglePreview` and the preview focus/scroll keys (currently only in the session-view key branch) are added to the task-view branch. **Rationale:** one preview model across both views; nothing new to learn or configure. **Trade-off:** `showPreview` is shared, so toggling it in one view affects the other — acceptable and arguably expected.

### D5: Row layout — name first, id demoted
`TaskRow` becomes: `taskDisplayName` (in `theme.text`, given the flexible width) → colored status → agent → kind → project → borrowed live activity (running). The short id moves to a trailing dim (`theme.overlay`) token for disambiguation rather than leading. **Rationale:** the name is the identity; the id is a fallback detail.

## Risks / Trade-offs

- **A running task whose linked session is cross-server or gone** → `Preview` already renders its `CROSS_SERVER`/`CAPTURE_FAILED` sentinels; a running-but-unlinked task falls to `TaskDetail` (D2), so there is always something to show.
- **Long prompt in `TaskDetail`** → rendered in a focus-scrollable `scrollbox` (reusing `previewFocused`), so it never overflows the pane.
- **Shared `showPreview` across views** (D4) → intentional; documented.
- **Render correctness isn't covered by unit tests** → per AGENTS.md, verify in a detached tmux session (board with a running task → live pane; with a pending task → detail card) before completion.

## Migration Plan

Purely additive TUI wiring; no persisted state, config, or protocol change. Rollback = revert the task-view layout branch, `TaskDetail`, the `TaskRow` reorder, and the `selectedTask()` memo.

## Open Questions

- None blocking. (A board-specific preview width / a contextual footer are deliberately out of this slice.)
