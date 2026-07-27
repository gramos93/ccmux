## Why

The task board is a full-width list whose rows lead with `id.slice(0,8)` and it has no detail/preview pane — the opposite of the session view, which pairs a list with a live preview on the right. Now that tasks carry a human-readable `name` (slice A), the board should read like the session view: name-first rows and a right-hand pane that shows a running task's live session **or** a static detail card for a task that has no pane. This is the visible half of the UX overhaul — the layout that makes the board usable at a glance.

## What Changes

- **Name-first rows.** `TaskRow` leads with `taskDisplayName(task)` (the `name`, or the derived fallback), demoting the short `id` to a dim secondary token. Status/agent/kind/project and the borrowed live activity for running tasks stay.
- **Preview on the right.** The task view gains a right-hand pane, gated by the existing `showPreview` state and sized by `previewWidth` (reused from the session view — no new toggle model):
  - a `running` task linked to a session → the existing `Preview` component, keyed off the joined session (live tmux capture), exactly as in the session view.
  - any other task (pending/stopped/done/failed, or running-but-unlinked) → a new **`TaskDetail`** pane (mirroring `GroupPreview`'s chrome) showing name, status, agent, project, target + resolved session name/`targetRef`, the full scrollable prompt, worktree intent, timestamps, linked session id, and a failure hint for `failed`.
- **Selection drives the pane.** A `selectedTask()` store memo resolves the selected instance (defaulting to the first task) so the preview reflects the highlighted row and re-captures on change.
- **Shared preview keys in the board.** The existing preview toggle (`p` → `togglePreview`) and preview-focus/scroll behavior work in the task view too, using the same `showPreview`/`previewWidth`/`previewFocused` state.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-board`: the board view renders name-first rows and a selection-driven preview pane (live `Preview` for running-linked tasks, a new `TaskDetail` card otherwise), reusing the session view's preview state and keybinds.

## Impact

- Code: `src/tui/components/TaskRow.tsx` (name-first), new `src/tui/components/TaskDetail.tsx`, `src/tui/App.tsx` (task-view layout split + preview keybinds), `src/tui/store.ts` (`selectedTask()` memo + default selection). Component tests via `testRender`; render verification per AGENTS.md.
- No daemon/API/SSE change (name already rides the task instance; `showPreview`/`previewWidth`/`previewFocused` already exist).
- Depends on slice A (`name`/`taskDisplayName`). Slice C (create/edit form) is independent of this.
