## Why

A task's `new-window` target opens a window in whatever tmux session is current, cd'd to the project — the agent runs in the right directory but lands in an unrelated session. There is no way to give a project its own tmux session from ccmux. `new-session` was reserved for exactly this but never implemented. Landing it makes "launch this project in its own session" a first-class placement, and it's the robust choice when a project has no existing pane to split or send into.

## What Changes

- **Enable the `new-session` target** — stop rejecting it in the task data model / validation; add it to the valid targets. **BREAKING** (spec-level only): the previously-reserved `new-session` value is now accepted; no runtime break since it was rejected before.
- **Launcher: create a dedicated session** — on run, `tmux new-session -d -s <name> -c <cwd>`, then launch the agent + deliver the prompt into its pane exactly like `new-window` (adaptive ready-then-send). The session name derives from the project (basename, tmux-sanitized).
- **Attach-on-collision** — if a session with that name already exists, do NOT duplicate: open a new window inside the existing session (the `send-to-existing`-style path), cd'd to the project. One session per project.
- **Correlation unchanged** — a `new-session` launch produces a pane like any other; the existing pane-id correlation and teardown apply as-is (the created pane is captured and linked, the daemon binder picks up the new session, it appears everywhere).
- **Create modal + CLI** — `new-session` joins the Target cycle (`new-window · split · send-to-existing · background · new-session`) and needs **no** target-ref; the CLI `--target` accepts it.

Out of scope: worktree-per-session, renaming/attaching to an arbitrary named session (only the project-derived name), and multi-window layout within the new session.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-store`: the `Task` data model's `target` enum gains `new-session` (no longer reserved/rejected).
- `task-launch`: the run path gains a `new-session` branch — create a project-named detached session and launch into it, attaching to an existing same-named session instead of duplicating.
- `task-board`: the create modal's Target selector includes `new-session` as a placement (no target-ref).

## Impact

- **Data/validation**: `src/lib/task.ts` — `TaskTarget` union + `VALID_TASK_TARGETS` add `new-session`; `validateNewTask` drops the reserved-target rejection.
- **Daemon launcher**: `src/daemon/task-launcher.ts` — a `new-session` branch (session-name derivation + `tmux new-session -d -s -c`, existing-session detection → new-window fallback), reusing the shared launch/prompt-delivery helper.
- **TUI**: `src/tui/utils/task-create.ts` — add `new-session` to `TARGET_CYCLE` (and it's automatically not a target-ref target).
- **CLI**: `src/commands/task.ts` — `--target` help text.
- **No new endpoint, no SSE/protocol change**; correlation, teardown, and resume paths are untouched (they already key off the launched pane).
