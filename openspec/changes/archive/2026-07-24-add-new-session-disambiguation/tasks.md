## 1. Session-name resolution

- [x] 1.1 Add a stable, path-derived hash helper in `task-launcher.ts` (fast non-crypto FNV-1a/djb2 over the absolute project path → first 6 hex chars). Deterministic, no `Date`/random.
- [x] 1.2 Add `disambiguatedSessionName(project)` = `` `${tmuxSessionName(project)}-${pathHash(project)}` `` (sanitized base + suffix). Keep `tmuxSessionName` unchanged as the primary name.
- [x] 1.3 Add a resolver `resolveProjectSession(deps, project)` returning `{ name, exists }`: for the candidate name, probe `has-session -t =name`; if it exists, read `@ccmux_project` via `show-option -gv`/`-v`; attach when it equals `project`, else fall through to the disambiguated name and repeat the same ownership test (one disambiguation step).

## 2. Launcher wiring

- [x] 2.1 Replace `newSessionCreateArgv` so it calls `resolveProjectSession`, then builds `new-window -t name` (exists) vs `new-session -d -s name` (fresh) as today; return the resolved name alongside the argv.
- [x] 2.2 After a fresh session is created (the `!exists` case), stamp it: `tmux set-option -t =name @ccmux_project <project>` (fire-and-forget; ignore non-zero exit). Do NOT stamp on the attach path.
- [x] 2.3 Confirm both the fresh-run `new-session` branch and the `opts.resume` branch flow through the updated resolver (they already share the helper) so resume placement stays stable.

## 3. Tests

- [x] 3.1 `task-launcher.test.ts`: same-project collision (fake `has-session` code 0 + `@ccmux_project` == project) → opens `new-window` in the same name, no disambiguation.
- [x] 3.2 Different-project collision (`@ccmux_project` != project) → resolves to `<base>-<hash>` and creates/attaches there, never the original name.
- [x] 3.3 Unstamped existing session (empty `@ccmux_project`) → disambiguates (does not hijack a hand-made session).
- [x] 3.4 No collision → creates fresh primary name and stamps `@ccmux_project`.
- [x] 3.5 Determinism: `disambiguatedSessionName(project)` returns the same value across calls; resume of a disambiguated task resolves to the same name.

## 4. Verify

- [x] 4.1 `bun run typecheck` and `bun test src/daemon/task-launcher.test.ts` pass.
- [x] 4.2 End-to-end in a detached tmux session: create two projects with the same basename in different parents, run a `new-session` task for each, and confirm via `tmux ls` they land in distinct sessions (primary + `-<hash>`), each stamped with the right `@ccmux_project`.
