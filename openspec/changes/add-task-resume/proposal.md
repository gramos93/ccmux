## Why

Phase 1 banked the durable resume key (`nativeSessionId`) and made closed interactive tasks go `stopped`. But nothing consumes it yet — a `stopped` task is a dead end. This change makes `stopped` tasks **resumable**: relaunch the agent against its retained conversation id into a fresh pane, re-correlate, and flip back to `running`. It turns the task list into a real "pick up where you left off" surface.

## What Changes

- Add `POST /tasks/{id}/resume` and `TaskManager.resume(id, prompt?)`: for a `stopped` task with a `nativeSessionId` whose agent supports resume, launch the agent's **resume command** into a fresh `new-window` pane (re-attaching the existing conversation), re-correlate the resulting session, and set status back to `running`. `nativeSessionId` is preserved; a new `paneId`/`sessionId` bind on correlation.
- **Optional follow-up prompt on resume.** If a prompt is supplied, after the resumed agent signals ready it is submitted (reusing `run`'s ready-then-send + `sendPromptToPane`) — i.e. "resume and continue with X". With no prompt, resume just re-attaches and the user drives.
- **Resume command per agent** (mirrors `buildClaudeLaunchCommand`): claude → `<binary> --resume <nativeSessionId>`; any agent with a `resumeCommand` → that template with `{id}` → `nativeSessionId`. Agents that are neither (no `resumeCommand`, not claude) are **not resumable** → the resume fails with a clear error.
- **Gating:** resume requires the task to be `stopped`, to have a `nativeSessionId`, and the agent to be resumable; otherwise `400`. A missing task → `404`.
- **Launcher gains a resume mode:** `launchTask(task, deps, { resume: true, prompt? })` builds the resume command; when a follow-up `prompt` is given it ready-waits and submits it, otherwise it skips prompt delivery. Pane creation, cwd validation, and correlation are reused unchanged.
- **CLI:** `ccmux task resume <ref> [--prompt <text>]` (id or unique prefix; optional follow-up), and `ccmux task list --stopped` to surface the resumable set.

Non-goals: a `new-session`/new-tmux-window-vs-split choice for the resumed pane (always `new-window`), and the TUI task board (phase 3).

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `task-launch`: adds a resume behavior (`POST /tasks/{id}/resume`, launcher resume mode, agent resumability gating) and extends the `ccmux task` CLI with `resume` + a `--stopped` list filter.

## Impact

- **Modified code:** `src/daemon/task-launcher.ts` (resume-command build + `{ resume }` option, skip prompt), `src/daemon/task-manager.ts` (`resume(id)` + resumability check; injected launch takes an opts arg), `src/daemon/index.ts` (pass opts through the launch bridge), `src/daemon/server.ts` (`POST /tasks/{id}/resume` route + handler), `src/commands/task.ts` (`resume` subcommand, `list --stopped`).
- **Reused (unchanged):** `nativeSessionId`/`stopped` (phase 1), the `pendingCorrelation` re-correlation path, `Session`/agent `resumeCommand`, the cwd validation.
- **Protocol:** additive route; reuses `task_updated`. No model change. No renderer/board.
- **Dependencies:** none.
