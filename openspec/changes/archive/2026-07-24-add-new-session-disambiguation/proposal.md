## Why

The `new-session` task target names its tmux session after the project's path **basename** only (`tmuxSessionName` in `task-launcher.ts`). Two different repos that share a basename (`~/work/api` and `~/oss/api`) both resolve to the session `api`, so the second task's window is attached to the **first project's** session. The agent still runs in the correct cwd, but the session container — the handle the task board groups by and the user reads in `tmux ls` — is wrong. A same-named session created by the user by hand is likewise silently hijacked. The merged `add-task-new-session` change documented this as a deferred refinement ("disambiguate by path").

## What Changes

- On a session-name collision, the launcher SHALL verify the existing session actually belongs to the **same project** before attaching to it; only a same-project match reuses the session (the intended one-session-per-project behavior). This uses a tmux user option (`@ccmux_project`) stamped on sessions ccmux creates.
- When the existing session belongs to a **different** project (or is unstamped — e.g. created manually by the user), the launcher SHALL derive a **deterministic disambiguated name** (the basename plus a short stable suffix derived from the full project path) rather than joining the wrong session.
- The disambiguated name is stable across runs and resume, so a second run or a resume of the same project lands back in the same session.
- Sessions ccmux creates for a `new-session` task SHALL be stamped with `@ccmux_project = <project path>` at creation so future collision checks can resolve ownership.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-launch`: the `new-session` collision rule changes from "same name → attach" to "same name **and** same project → attach; otherwise disambiguate by path."

## Impact

- Code: `src/daemon/task-launcher.ts` (`tmuxSessionName`, `newSessionCreateArgv`, and the `new-session` + resume launch branches); tests in `src/daemon/task-launcher.test.ts`.
- Behavior change (intended): a task no longer joins an unrelated same-named session — including a user's hand-made session. No API, SSE, config, or data-model change; purely additive at the launcher level. Rollback is reverting the launcher branch.
