## Why

Resuming a task whose original pane/window/tmux-session was closed opens it in **whatever tmux session is currently attached** (`tmux new-window` with no target), instead of a session tied to the task's project. `new-session` tasks already fall back to a project-named session on resume; every other target does not — so a resumed `new-window`/`split`/`send-to-existing` task pollutes an unrelated current session. This is jarring and non-deterministic.

A related flaw surfaced from the new **mark-done** action: `done` is user-controlled, so a `done` task's pane may still be **open**. Reviving it currently always `resume`s, which spawns a **second** agent on the same conversation (a duplicate) rather than returning to the pane that is already there.

## What Changes

- **Resume lands in the project-named session.** When resuming any non-`new-session` task, the daemon SHALL place the resumed agent into the project-named session (create-or-attach on the project-derived name), not the current tmux session — matching `new-session`'s existing resume fallback. `new-session` continues to honor its explicit `targetRef` session name; other targets use the project-derived name (their `targetRef`, when present, is a pane id, not a session name, and is ignored for placement).
- **Revive is liveness-aware.** Activating/reviving a `done` task whose linked session is still **live** SHALL **jump** to that pane (no new pane, no duplicate); only when the pane is gone SHALL it resume (into the project session) or run. This makes `done` revival mirror how a `running` task is activated.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-launch`: the resume endpoint places non-`new-session` tasks into the project-named session (create-or-attach) rather than a `new-window` in the current session.
- `task-board`: reviving a `done` task jumps to its still-live pane when present, and only resumes/runs when the pane is gone (activation is liveness-aware).

## Impact

- Code: `src/daemon/task-launcher.ts` (resume dispatch routes non-`new-session` targets through the project-session create-or-attach; a `honorTargetRef` flag on `runNewSession`), `src/tui/utils/task-create.ts` (`resolveTaskActivation` takes the live linked session and jumps for a live `done` task), `src/tui/App.tsx` (pass the joined session into activation). Tests alongside.
- No endpoint, schema, or protocol change. Resume is only invoked when a task is `stopped` or `done`; the TUI's liveness gate ensures resume runs only when the pane is actually gone, so the daemon's project-session placement is always the correct target. (A direct CLI `ccmux task resume` on a `done` task whose pane is still live could still duplicate — a minor, documented edge; the board is the primary surface.)
