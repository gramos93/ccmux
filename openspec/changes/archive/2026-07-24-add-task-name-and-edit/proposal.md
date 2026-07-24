## Why

Tasks are identified only by an opaque `id` (rows show `id.slice(0,8)`), and once created a task's fields are frozen — the API offers create, status-update, run, resume, and delete, but no way to fix a typo'd prompt or wrong agent on a `pending` task without deleting and recreating. This is the foundation slice of the task-board UX overhaul: it adds a human-readable **name** and a **field-edit** capability at the data + API layers, so the later TUI slices (board layout/preview, create/edit form) have something to render and call. It also reconciles a stale spec: `task-api` still says a `new-session` create resolves to `400`, but `new-session` shipped and is a valid target.

## What Changes

- **Task name.** `TaskSpec` gains an optional `name` (human-readable label). It is foldable through the create cascade (defaults → project → template → input) like other fields. When the resolved name is empty, the store SHALL derive a friendly default from the prompt (first line, trimmed and length-capped; falling back to the command or a generic label), so a task is never surfaced by raw id.
- **Edit a task's fields.** A new daemon endpoint updates the editable spec fields (`name`, `prompt`, `agent`, `project`, `target`, `targetRef`, `worktree`, `command`) of a task, re-validating the merged result, bumping `updatedAt`, and broadcasting `task_updated`. Editing is allowed only while a task is `pending` (it has not launched); other statuses are rejected with a conflict.
- **Spec/comment reconciliation.** Remove the obsolete "reserved `new-session` target rejected over HTTP" requirement/scenario and the matching stale doc comment; `new-session` is a valid create target.
- No SSE protocol change — `task_updated` already carries the full instance.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-store`: `TaskSpec` gains `name`; the store derives a default name at creation and supports editing a `pending` task's spec fields (re-validating).
- `task-api`: a new task-edit HTTP endpoint + its lifecycle-manager method; the create cascade folds `name`; the stale `new-session`-rejection requirement is removed.

## Impact

- Code: `src/lib/task.ts` (`TaskSpec.name`, `validateNewTask`/default-name derivation, editable-field validation), `src/lib/task-store.ts` (name default + a spec-field edit path; fix the stale `new-session` doc comment), `src/daemon/task-manager.ts` (edit method), `src/daemon/server.ts` (edit route). Tests alongside each.
- No data migration (existing tasks have no `name`; they render a derived name at read time or on first edit — see design). No config or SSE-protocol change.
- Unblocks the TUI slices B (board layout + preview) and C (create/edit form).
