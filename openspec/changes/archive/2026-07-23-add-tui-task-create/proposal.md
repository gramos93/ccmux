## Why

The task subsystem's launch powers (`create`, `run`) live only in the `ccmux task` CLI. The TUI board can list, resume, jump, and delete — but a user who lives in the board must drop to a shell to create or start a task. This phase closes that gap: create and start tasks without leaving the board, sourcing agents/templates/projects/defaults from local config so the daemon stays thin.

## What Changes

- **Create modal** — a `c` keybind on the task board opens a single overlay form: agent, project, target, target-ref (a live-session picker, only for `split`/`send-to-existing`), template, prompt, background toggle, and run-now toggle. Fields are pre-filled from the same `resolveTask` default cascade the daemon uses. Submitting POSTs `/tasks` (with `run` following when run-now is set) — the daemon's resolver stays authoritative.
- **Run a pending task** — `activateSelectedTask` (Enter) and `r` gain the `pending` case: `pending` → run, `stopped` → resume, `running` → jump. One enter-semantics rule across every status.
- **Local config sourcing** — the form reads agents (built-in registry + config `agents`), templates (`prefs.templates`), projects (config `projects` ∪ distinct live-session cwds), and defaults locally via `getPreferences()`. No new daemon endpoint; create/run use the existing `/tasks` routes.
- **Footer/help** — the task-view footer advertises `c create` and the pending-run behavior.

Out of scope (deferred): resume-with-prompt (`R`), and the `-- <argv>` passthrough command (stays CLI-only — an escape hatch, not a form field).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-board`: adds a create action (modal form that resolves a spec locally and POSTs `/tasks`, optionally running it) and extends the row-activate behavior so a `pending` task is started (run) rather than ignored.

## Impact

- **TUI**: new `TaskCreateModal` component + a text-input primitive (or reuse of `SearchInput`), `src/tui/App.tsx` (bind `c`, extend `activateSelectedTask`/`r`, render the modal), `src/tui/store.ts` (create-modal open/close + field state), `src/tui/components/Footer.tsx` + `HelpOverlay.tsx` (advertise the new keys).
- **Config read path**: TUI reads `getPreferences()` and the built-in agent registry (`src/lib/agents.ts`) to populate the form; reuses `resolveTask` from `src/lib/task.ts` for pre-fill.
- **Daemon**: none — existing `POST /tasks` and `POST /tasks/{id}/run` unchanged.
- **No breaking changes**: additive keybinds and an overlay; the board's existing behavior is unchanged for non-`pending` rows.
