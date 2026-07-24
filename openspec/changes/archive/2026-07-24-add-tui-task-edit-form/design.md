## Context

The create flow is a clean pure-logic + modal pair: `task-create.ts` defines `CreateFormState`, `CreateField`, `buildInitialForm`, `buildCreateBody`, `visibleCreateFieldsFor`; `TaskCreateModal.tsx` renders it; `store.ts` holds `createModalOpen`/`createForm`/`createOptions` + open/close/setField actions; `App.tsx` `openCreateModal()` seeds the form and `submitCreate()` POSTs `/tasks` then optionally runs. The board's `deleteSelectedTask()` fires `DELETE /tasks/{id}` immediately. Slice A added `POST /tasks/{id}/edit` (pending-only, 409 otherwise) and `TaskSpec.name` with a derived default. Slice B added `selectedTask()`. There is a session-oriented `confirmMode`/`ConfirmModal`, but it is shaped around sessions, not tasks.

## Goals / Non-Goals

**Goals:**
- A `name` field in the modal (optional; daemon derives when blank).
- Reuse the one modal for create, edit (pending only), and clone.
- A delete confirmation on the board.
- No daemon/API change.

**Non-Goals:**
- Editing non-`pending` tasks (the endpoint 409s; the board simply won't offer `e`).
- A general confirm framework — a minimal task-scoped confirm suffices.
- Contextual footer / filter (excluded earlier).

## Decisions

### D1: Modal mode via `editingTaskId`
Add `editingTaskId: string | null` to the store. `null` → create/clone (POST `/tasks`); non-null → edit (POST `/tasks/{id}/edit`). `openCreateModal`/`openCloneModal` leave it null; `openEditModal(form, options, id)` sets it. `closeCreateModal` resets it. **Rationale:** one boolean-ish discriminator drives submit routing, title, and run-now visibility without duplicating the modal. **Alternative:** a separate edit modal component — rejected (duplicates all the field/picker logic).

### D2: `name` is the leading form field
Add `name` to `CreateFormState` and to `CreateField`, placed first in `visibleCreateFieldsFor` (it is the task's identity). It is a plain text input like `prompt`. `buildInitialForm` seeds `name: ""`. `buildCreateBody` includes `name` only when non-blank (so the daemon still derives a default). **Rationale:** name-first matches the board rows (slice B).

### D3: Edit submit = `buildEditBody` → the edit endpoint
A `buildEditBody(form)` returns the editable subset (`name`, `prompt`, `agent`, `project`, `target`, `targetRef` when applicable). `submitCreate` branches on `editingTaskId`: null → POST `/tasks` (unchanged, run-now honored); set → POST `/tasks/{id}/edit`, close on success, surface a toast on 400/409 (e.g. the task stopped being `pending`). The row updates via the existing `task_updated` broadcast — no optimistic mutation. **Rationale:** mirrors the create path; the endpoint already enforces validity and the pending gate.

### D4: Pre-fill from a task (edit and clone share it)
A `formFromTask(task, options)` builds a `CreateFormState` from an existing instance (name, prompt, agent, project, target, targetRef; run-now defaulted off). Edit opens it with `editingTaskId = task.id`; clone opens it with `editingTaskId = null` (a fresh create). **Rationale:** one pure builder feeds both; clone is just "edit that submits as create."

### D5: Edit is offered only for `pending`; run-now hidden in edit
The board `e` key opens edit only when `selectedTask()?.status === "pending"`, else a toast ("Only a pending task can be edited"). In edit mode the modal hides the `runNow` field (editing never launches) and titles itself "Edit task". **Rationale:** matches the endpoint's pending gate; avoids a launch affordance that doesn't apply.

### D6: Delete confirmation reuses the shared `ConfirmationDialog`
`x` calls `showConfirmDialog(taskId, "delete-task")` — the same `confirmMode` path sessions use for kill/restart. A new `"delete-task"` `ConfirmAction` gives the dialog a "Delete Task?" title and shows the task's display name (passed via `groupLabel`); `confirmDialogAction` gains a `delete-task` branch that `DELETE`s the task. The shared `confirmMode` key handler already routes `y`/Enter → confirm and `n`/Esc → cancel in every view. **Rationale:** one confirmation UI and key contract across the app — no bespoke overlay or extra store state. **(Revised from the original plan of a task-scoped overlay after review: the `ConfirmationDialog` is generic enough — title-by-action + subtitle + Y/N — that a `delete-task` action reuses it cleanly.)**

### D7: Keybinds
Board: `e` edit (pending only), `C` (Shift+C) clone, `x` delete-confirm. The create modal already intercepts keys when open; the delete-confirm intercepts in the task-view branch while `confirmDeleteTaskId` is set. `c` (global create) is unchanged.

## Risks / Trade-offs

- **Edit races the pending gate** (task runs between opening the form and submitting) → the endpoint 409s; `submitCreate` shows a toast and the modal stays open so the edit isn't lost. Acceptable.
- **Clone of a running/linked task** copies only spec fields (no `sessionId`/`paneId`/`nativeSessionId`) → correct; a clone is a fresh pending task.
- **Two text fields (name, prompt)** slightly lengthen the form → name is short and leads; no layout risk at normal widths (verified in slice B).
- **Render correctness** isn't covered by unit tests → verify create/edit/clone/delete-confirm in a detached tmux session before completion (AGENTS.md).

## Migration Plan

Additive TUI wiring over slice A's endpoint. No persisted state, config, protocol, or daemon change. Rollback = revert the `name` field, the mode/confirm store fields, and the App keybinds/submit branch.

## Open Questions

- None blocking. (Editing a `stopped` task's prompt before resume remains a future extension, gated by the endpoint, not this UI.)
