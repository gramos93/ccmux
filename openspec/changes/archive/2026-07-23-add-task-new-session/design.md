## Context

The task launcher (`src/daemon/task-launcher.ts`) has a shared `runInPane(tmuxCmd, launchCommand, promptToSend)` helper that creates a pane with `tmux new-window|split-window -c <cwd> -P -F '#{pane_id}'`, sends the launch command, ready-waits, and delivers the prompt (bracketed paste + delayed Enter). `new-window` and `split` both route through it; `send-to-existing` sends into an existing `targetRef` pane; `background` goes headless via the invoke subsystem. `new-session` is currently rejected at three layers: the `TaskTarget` type, `validateNewTask`, and the launcher's fall-through error.

The daemon already uses `tmux new-session` in the background Claude invoker, so detached-session creation is proven. A `new-session` launch produces an ordinary pane, so the existing pane-id correlation, teardown, and resume paths apply without change — the daemon's binder picks up the new session and it appears everywhere.

## Goals / Non-Goals

**Goals:**
- Accept `new-session` as a target end-to-end (type, validation, launcher, CLI, create modal).
- On run, create a detached tmux session named after the project, cd'd to it, and launch the agent + prompt like `new-window`.
- Attach to an existing same-named session (new window inside it) instead of duplicating.
- Keep correlation/teardown/resume working with no changes to those paths.

**Non-Goals:**
- Worktree-per-session, arbitrary user-named sessions (only the project-derived name), multi-window layouts.
- Changing how `resume` places a task (it keeps opening a `new-window`; see Open Questions).
- Any new HTTP endpoint or SSE change.

## Decisions

### D1: Session name = tmux-sanitized project basename
The new session is named `basename(project)`, with characters tmux forbids in session names (`.` and `:`) replaced by `-`. **Rationale:** the project basename is the recognizable handle (matches how the board groups by project). **Alternative:** the full path — rejected (tmux names can't contain `:` and a long path is unreadable in `tmux ls`). Collisions between two different repos that share a basename fall to D2's attach behavior; acceptable and rare.

### D2: Attach-on-collision (has-session → new-window fallback)
Before creating, check `tmux has-session -t <name>` (exit 0 = exists). If it exists, open a **new window** in that session (`tmux new-window -t <name> -c <cwd> -P -F '#{pane_id}'`) rather than creating a duplicate; otherwise create it detached (`tmux new-session -d -s <name> -c <cwd> -P -F '#{pane_id}'`). Either way a `#{pane_id}` is captured and the rest of the launch (send command, ready-wait, deliver prompt) is identical. **Rationale:** one session per project is the intuitive model — a second task for the same project joins its session. **Alternatives:** suffix the name (`-2`, proliferates sessions) or fail (forces manual cleanup) — both rejected in the earlier design discussion.

### D3: Generalize the shared launch helper over the create step
Extend `runInPane` so its first argument is the tmux **create argv** (the `new-session`/`new-window`/`split-window` command + flags) rather than a fixed `"new-window" | "split-window"` literal, keeping the send/ready/prompt tail unchanged. `new-window`/`split` build their existing argvs; `new-session` builds the has-session-gated argv. **Rationale:** one launch/prompt-delivery path, no duplication of the fragile ready-then-send logic. **Alternative:** a parallel `runInSession` copy — rejected (duplicates the load-bearing prompt-delivery code).

### D4: Correlation/teardown unchanged; resume honors the target
The captured pane id flows through the existing `paneId` → `sessionId` correlation and `sessionId → taskId` teardown exactly as `new-window` does today — no edits there. A working-directory existence check (as pane targets already do) guards session creation. **Resume** does change: a `stopped` `new-session` task resumes back into its project session (the same create-or-attach path as a fresh run), not a `new-window` in the current session; all other targets keep resuming into a `new-window`. Run and resume share one `new-session` create-argv builder so the create/attach logic lives in one place.

## Risks / Trade-offs

- **Basename collision across repos** (`~/a/api` and `~/b/api`) → the second attaches to the first's session. Mitigation: the new window is still cd'd to the correct project dir, so the agent runs in the right place; only the session container is shared. Documented; a future refinement could disambiguate by path.
- **Illegal session-name chars** → sanitize `.`/`:` to `-` before use; an empty/edge name falls back to a safe default (e.g. `task`).
- **Client stealing** → create with `-d` (detached) so launching never yanks the user's current client to the new session.
- **Resume divergence** → resuming a stopped `new-session` task currently opens a `new-window` in the current session, not a fresh project session (see Open Questions).

## Migration Plan

Purely additive at runtime: a target value that was rejected is now accepted. No data migration (existing tasks keep their targets), no endpoint/protocol change, no config change. Rollback is reverting the launcher branch + the validation/type edit.

## Open Questions

- Resolved: `resume` of a `new-session` task re-creates/attaches the project session (same collision handling as a fresh run), rather than opening a `new-window`. Placement is preserved across the stop/resume cycle.
