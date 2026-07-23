## 1. Accept new-session in the data model

- [x] 1.1 In `src/lib/task.ts`: add `"new-session"` to the `TaskTarget` union and to `VALID_TASK_TARGETS`
- [x] 1.2 Remove the reserved-`new-session` rejection in `validateNewTask` (it now validates like any known target)
- [x] 1.3 Update `task.ts` doc comments that call `new-session` reserved/unsupported
- [x] 1.4 Test (`src/lib/task.test.ts`): a `new-session` task validates and round-trips; unknown targets still rejected

## 2. Launcher: session-name derivation + create/attach

- [x] 2.1 Add a `tmuxSessionName(project)` helper (basename, replace `.`/`:` with `-`, fall back to a safe default when empty) with unit tests
- [x] 2.2 Generalize `runInPane` in `src/daemon/task-launcher.ts` so its first argument is the tmux **create argv** (array) rather than the `"new-window" | "split-window"` literal; update the `new-window`/`split` call sites to pass their argvs; keep the send/ready/prompt tail unchanged
- [x] 2.3 Add the `new-session` branch: verify cwd exists, then `tmux has-session -t <name>` → if present build a `new-window -t <name> -c <cwd> -P -F '#{pane_id}'` argv, else a `new-session -d -s <name> -c <cwd> -P -F '#{pane_id}'` argv; run it through the generalized helper
- [x] 2.4 Remove the launcher's `new-session`-rejection fall-through
- [x] 2.5 Resume: a `new-session` task resumes via the shared create-or-attach argv (its project session), not `new-window`; every other target keeps resuming into `new-window`
- [x] 2.6 Tests (`src/daemon/task-launcher.test.ts`): new-session with no existing session issues `new-session -d`; with an existing session issues `new-window -t`; pane id captured and prompt delivered both ways; resume of a new-session task uses the create-or-attach path (not a bare new-window); resume of a new-window task still opens a new-window; cwd-missing still errors (fake `runTmux`, no real tmux)

## 3. Wire target into TUI + CLI

- [x] 3.1 Add `"new-session"` to `TARGET_CYCLE` in `src/tui/utils/task-create.ts` (target-ref stays hidden/optional for it via the existing `targetNeedsRef`)
- [x] 3.2 Update `--target` help text in `src/commands/task.ts` to list `new-session`
- [x] 3.3 Tests: `cycleOptionsFor("target")` includes `new-session`; `createFormValid` is satisfied for a `new-session` task with a prompt and no target-ref; `buildCreateBody` sends `target: "new-session"` without a targetRef

## 4. Verify

- [x] 4.1 `bun run typecheck` + `bun test` green
- [x] 4.2 Live-verify per AGENTS.md: detached tmux, `ccmux picker` → `c`, pick a project with NO live session, set target `new-session`, create+run; confirm a new tmux session named after the project is created (`tmux ls`), the agent launches cd'd to the project, and the task correlates/appears; then run a second `new-session` task for the same project and confirm it opens a window in the existing session (no duplicate)
