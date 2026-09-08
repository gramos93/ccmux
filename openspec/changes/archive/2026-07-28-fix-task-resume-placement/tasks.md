## 1. Daemon: resume into the project session

- [x] 1.1 `src/daemon/task-launcher.ts`: add a `honorTargetRef` param to `runNewSession` (default `true`); when `false`, always resolve via `resolveProjectSession(project)` (ignore `targetRef`).
- [x] 1.2 Resume dispatch: route non-`new-session` targets through `runNewSession(launchCommand, opts.prompt, /*honorTargetRef*/ false)` (project-derived session) instead of `runInPane(paneCreateArgv("new-window"), …)`; keep `new-session` on `runNewSession(…, true)`.
- [x] 1.3 Tests (`task-launcher.test.ts`): resuming a `new-window`/`split`/`send-to-existing` task creates/attaches the project-named session (has-session probe + `new-session -d -s <name>` or `new-window -t <name>`), NOT a bare `new-window` in the current session; a `split`/`send-to-existing` `targetRef` pane id is not used as the session name; `new-session` resume still honors its explicit `targetRef` name.

## 2. Board: liveness-aware done revive

- [x] 2.1 `src/tui/utils/task-create.ts` `resolveTaskActivation(task, liveSession?)`: add the optional live-session arg; `done` arm → `jump` when `liveSession?.tmuxPane` is set, else `resume` when `nativeSessionId`, else `run`. Other arms unchanged.
- [x] 2.2 `src/tui/App.tsx`: pass `getSessionById(task.sessionId ?? "")` into `resolveTaskActivation` from both `activateSelectedTask` (enter) and `runOrResumeSelectedTask` (`r`). `enter` acts on run/resume/jump; `r` continues to ignore `jump` (no-op for a live `done`/`running` row).
- [x] 2.3 Tests (`task-create.test.ts`): done + live session (tmuxPane) → `{kind:"jump"}`; done + no live session + nativeSessionId → `{kind:"resume"}`; done + neither → `{kind:"run"}`; pending/stopped/running/failed unchanged (thread the live-session arg where relevant).

## 3. Verify

- [x] 3.1 `bun run typecheck` and full `bun test` green.
- [x] 3.2 Live verification in an **isolated** daemon+state (separate `CCMUX_STATE_HOME` + port, or a throwaway project) so the shared board / real tasks are never touched: (a) create a `new-window` task, run it, close its pane so it stops, resume it → lands in a project-named tmux session (check `tmux ls`), not the current one; (b) mark a running task `done`, then activate it while its pane is still open → jumps to the existing pane (no duplicate); close the pane, then activate the `done` task → resumes into the project session. Tear down all throwaway tmux sessions/tasks by explicit id afterward.