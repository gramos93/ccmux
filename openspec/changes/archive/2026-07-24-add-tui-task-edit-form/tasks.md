## 1. Form logic (`src/tui/utils/task-create.ts`)

- [x] 1.1 Add `name: string` to `CreateFormState` and `"name"` to `CreateField`; place `name` first in `visibleCreateFieldsFor`. Seed `name: ""` in `buildInitialForm`.
- [x] 1.2 `buildCreateBody`: include `name` only when non-blank (so the daemon derives otherwise).
- [x] 1.3 Add `buildEditBody(form)` → editable subset (`name`, `prompt`, `agent`, `project`, `target`, `targetRef` when applicable).
- [x] 1.4 Add `formFromTask(task, options)` → a `CreateFormState` pre-filled from an instance (name/prompt/agent/project/target/targetRef; `runNow: false`).
- [x] 1.5 Unit tests for `buildCreateBody` (name included/omitted), `buildEditBody`, `formFromTask`.

## 2. Modal (`src/tui/components/TaskCreateModal.tsx`)

- [x] 2.1 Add the `name` field to `FIELD_LABEL` and render it as a text input (like prompt).
- [x] 2.2 Mode-aware: accept an `editing` prop — title "Edit task" vs "New task", and hide the run-now field when editing (drive off `visibleFields`, which omits `runNow` in edit mode).
- [x] 2.3 Update/extend modal tests for the name field + edit title / hidden run-now.

## 3. Store (`src/tui/store.ts`)

- [x] 3.1 Add `editingTaskId: string | null` (create/clone = null; edit = id) and `confirmDeleteTaskId: string | null`. Reset both in `closeCreateModal` / a `clearDeleteConfirm`.
- [x] 3.2 Actions: `openEditModal(form, options, id)`, `openCloneModal(form, options)` (both reuse the create-modal open path; edit sets `editingTaskId`), `requestDeleteTask(id)`, `clearDeleteConfirm()`.
- [x] 3.3 `visibleCreateFields`: omit `runNow` when `editingTaskId` is set.
- [x] 3.4 Store tests: edit/clone open state; runNow hidden in edit; delete-confirm set/clear.

## 4. App wiring (`src/tui/App.tsx`)

- [x] 4.1 `submitCreate`: branch on `editingTaskId` — null → POST `/tasks` (unchanged); set → POST `/tasks/{id}/edit` with `buildEditBody`; on 400/409 show a toast and keep the modal open; on success close (row updates via broadcast).
- [x] 4.2 Board keybinds: `e` → open edit for `selectedTask()` when `pending` (else toast); `C` (Shift+C) → open clone from `selectedTask()`; `x` → `showConfirmDialog(id, "delete-task")`. (Fixed the global `c` handler to ignore shift so Shift+C reaches clone.)
- [x] 4.3 Delete confirmation reuses the shared `ConfirmationDialog` via a new `delete-task` `ConfirmAction` (title + task-name subtitle) and a `confirmDialogAction` branch; no bespoke overlay. Footer: add `C clone`/`e edit` to the task view and `t tasks` to the session view.
- [x] 4.4 `openEditModal`/`openCloneModal` App helpers that build options + `formFromTask` and dispatch the store actions.

## 5. Verify

- [x] 5.1 `bun run typecheck` and full `bun test` green (incl. new form/modal/store tests).
- [x] 5.2 Render + behavior verification in a detached tmux session (per AGENTS.md): create a task with an explicit name → row shows it; `e` on a pending task → edit modal (no run-now, "Edit task" title) → change name → row updates; `C` → clone opens prefilled → submit creates a second task; `x` → confirmation → `n` cancels (task stays), `x` again → `y` deletes (row disappears). Clean up any created tasks afterward.
