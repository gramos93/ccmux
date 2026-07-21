## 1. Task data model (`src/lib/task.ts`)

- [ ] 1.1 Define `TaskTarget` (`"new-window" | "split" | "send-to-existing"`) and `TaskStatus` (`"pending" | "running" | "done" | "failed"`) union types
- [ ] 1.2 Define shared `TaskSpec` field set: `project`, `target`, `agent`, `prompt`, optional `targetRef: string` (pane/session id for `split`/`send-to-existing`), optional `worktree: boolean | { branch?: string; base?: string }` (a slash-command, if any, lives inside `prompt` — no separate field)
- [ ] 1.3 Define `TaskTemplate = Partial<TaskSpec>` and `TaskInstance = TaskSpec & { id; createdAt; updatedAt; status }`
- [ ] 1.4 Add a `validateNewTask` helper that rejects the reserved `new-session` target and unknown `status` values

## 2. State home resolution (`src/lib/config.ts`)

- [ ] 2.1 Add `getStateHomePath()` reading `$CCMUX_STATE_HOME` at call time, defaulting to `~/.ccmux` (mirror the `getCcmuxDirPath()` pattern; do not reuse `$CCMUX_HOME`)
- [ ] 2.2 Export a `TASKS_DIR` path helper resolving to `<stateHome>/tasks/`, and a `taskFilePath(id)` helper resolving to `<stateHome>/tasks/<id>.json`
- [ ] 2.3 Confirm no existing config-dir constants (`STATE_FILE`, `PREFS_FILE`, `MARKERS_DIR`) are moved or renamed

## 3. Config-side task surface (`src/lib/preferences.ts`)

- [ ] 3.1 Import `TaskSpec` from `task.ts`; define `TaskDefaults = Partial<TaskSpec>` and `ProjectConfig` (per-project `Partial<TaskSpec>` overrides)
- [ ] 3.2 Extend `Preferences` with optional `templates?: Record<string, TaskTemplate>`, `projects?: Record<string, ProjectConfig>`, `defaults?: TaskDefaults`
- [ ] 3.3 Verify existing preference loading tolerates absence of all three new keys (no breakage)

## 4. Default cascade resolver

- [ ] 4.1 Implement pure `resolveTask(prefs, { project, template?, input })` folding `defaults → projects[project] → templates[template] → input`, later-wins per field, no I/O
- [ ] 4.2 Apply built-in fallbacks (`target: "new-window"`, `status: "pending"`) only for fields still unset after the fold
- [ ] 4.3 Reject when the resolved/created target is `new-session`

## 5. Task instance store (`src/lib/task-store.ts`)

- [ ] 5.0 Add an injectable clock: module-level `now: () => string` default `() => new Date().toISOString()`, plus a `setClock`/`__setNowForTests` override so timestamp tests are deterministic (design D7)
- [ ] 5.1 Implement `listTasks()` via `readdir(TASKS_DIR)` + reading each `<id>.json`, each read try/catch'd so a missing/malformed file is skipped; absent dir → empty list (model on `getUIState`'s degrade-to-empty)
- [ ] 5.2 Implement `getTask(id)` reading `taskFilePath(id)`, returning the instance or undefined
- [ ] 5.3 Implement `createTask(spec)` assigning `id` + `createdAt`/`updatedAt`, writing `taskFilePath(id)` via lazy `mkdirSync(TASKS_DIR, {recursive:true})` + `Bun.write` (model on `setUIState`)
- [ ] 5.4 Implement `updateTaskStatus(id, status)` read-modify-writing the single `<id>.json`, refreshing `updatedAt`
- [ ] 5.5 Implement `deleteTask(id)` via `unlink(taskFilePath(id))`

## 6. Tests

- [ ] 6.1 Store tests: create→list, get-by-id, update-status refreshes `updatedAt` to an exact injected-clock value, delete (`unlink`) removes, absent dir → empty, one malformed `<id>.json` skipped while valid ones list (use a temp `$CCMUX_STATE_HOME` + injected clock)
- [ ] 6.2 Cascade tests: creation-input wins, project override beats global default, template fills gaps, no-config succeeds with built-in defaults
- [ ] 6.3 Validation tests: `new-session` target rejected at create; config without task keys still loads
- [ ] 6.4 Field-shape tests: `worktree: { branch, base }` round-trips through create→get; `targetRef` persisted for a `send-to-existing` task
- [ ] 6.5 Isolation test: writing the task store leaves `~/.config/ccmux` files unchanged

## 7. Verification

- [ ] 7.1 `bun run typecheck` passes
- [ ] 7.2 `bun test` passes (new suites included)
- [ ] 7.3 Confirm no daemon/TUI/tmux files were touched (diff review against non-goals)
