## Why

Slice A added a task `name` and a `POST /tasks/{id}/edit` endpoint, but the TUI has no way to reach either: the create modal has no name field, there is no edit action, and `x` deletes a task instantly with no confirmation. This final slice of the UX overhaul closes that gap — you can name a task, fix a `pending` task's fields in place, duplicate an existing task, and delete with a guard — all from the board, reusing the create modal machinery.

## What Changes

- **Name field.** The create modal gains a `name` text field (leading the form). It is optional — left blank, the daemon derives one from the prompt (slice A).
- **Edit a pending task.** A board keybind (`e`) opens the same modal pre-filled from the selected task and, on submit, calls `POST /tasks/{id}/edit` instead of `POST /tasks`. Editing is offered only for `pending` tasks; the run-now toggle is hidden in edit mode (editing never launches).
- **Clone a task.** A board keybind opens the create modal pre-filled from the selected task's fields (name, prompt, agent, project, target, target-ref) as a **new** task — "new like this".
- **Delete confirmation.** `x` no longer deletes immediately; it opens a small confirmation naming the task, and only `y`/Enter deletes (`n`/Esc cancels).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-board`: the creation modal gains a `name` field and is generalized to also **edit** a pending task (via the edit endpoint) and **clone** an existing task; the board's delete action requires confirmation.

## Impact

- Code: `src/tui/utils/task-create.ts` (add `name` to the form + field list; `buildEditBody`; pre-fill-from-task helper), `src/tui/components/TaskCreateModal.tsx` (name field + mode-aware title/run-now), `src/tui/store.ts` (modal mode / `editingTaskId`, open-edit/open-clone, delete-confirm state), `src/tui/App.tsx` (submit routes to create vs edit; `e`/clone/delete-confirm keybinds + a small confirm overlay). Component + store tests; render verification per AGENTS.md.
- No daemon/API/SSE change (the edit endpoint and `name` shipped in slice A). Depends on slices A and B.
