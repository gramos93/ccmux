## 1. Data model + name derivation (`src/lib/task.ts`)

- [x] 1.1 Add `name?: string` to `TaskSpec`; thread it through `validateNewTask` (preserved when present) and the `resolveTask` cascade (foldable field).
- [x] 1.2 Add a pure `deriveTaskName(spec)` (first non-empty prompt line, whitespace-collapsed, capped ~50 chars with ellipsis; else `command` head; else `"task"`) and a `taskDisplayName(task)` = `task.name ?? deriveTaskName(task)`.
- [x] 1.3 Unit tests: name preserved when explicit; derived from prompt when absent; command/`"task"` fallbacks; `taskDisplayName` fallback for a name-less instance.

## 2. Store edit path (`src/lib/task-store.ts`)

- [x] 2.1 On `createTask`, when the resolved `name` is empty, persist `deriveTaskName(...)`.
- [x] 2.2 Add `editTask(id, patch)`: pick the editable spec fields from `patch`, merge onto the stored instance, re-run `validateNewTask` on the merged spec, bump `updatedAt`, persist; return the updated instance (or a typed failure on invalid merge / missing id). Leave `patchTask` (link/status) untouched.
- [x] 2.3 Fix the stale doc comment (`task-store.ts:81`) that says creation rejects the reserved `new-session` target.
- [x] 2.4 Tests: edit merges + re-validates + bumps `updatedAt`; invalid merge rejected (task unchanged); non-spec fields ignored; missing id handled.

## 3. Manager + HTTP endpoint

- [x] 3.1 `src/daemon/task-manager.ts`: add `edit(id, patch)` — 404 if missing; `409`-signal if status !== `pending`; else delegate to `editTask`, emit the `updated` lifecycle event on success.
- [x] 3.2 `src/daemon/server.ts`: route `POST /tasks/{id}/edit` — parse JSON body (`400` on malformed), call `manager.edit`, map results to `200`/`400`/`404`/`409`; broadcast `task_updated` via the existing path.
- [x] 3.3 Tests: pending edit → 200 + event; non-pending → 409 (unchanged); invalid merge → 400; unknown id → 404; malformed body → 400.

## 4. Verify

- [x] 4.1 `bun run typecheck` and full `bun test` green.
- [x] 4.2 End-to-end against the running daemon: `POST /tasks` (no name) → GET shows a prompt-derived `name`; `POST /tasks/{id}/edit` on the pending task changes `name`/`agent` and emits `task_updated`; run the task, then an edit returns `409`; `POST /tasks` resolving to `new-session` succeeds (no 400).
