## 1. Launcher

- [x] 1.1 Factor the tmux name sanitizer out of `tmuxSessionName` into `sanitizeTmuxName(raw)` (replace `.`/`:` with `-`, trim); `tmuxSessionName` keeps its `basename()` + `task` fallback and calls it.
- [x] 1.2 In `runNewSession` (`task-launcher.ts`), select the session name: when `task.targetRef` sanitizes to a non-empty name, use it as an explicit name — `exists = has-session -t =name`, no `resolveProjectSession`; otherwise fall back to the existing project-derived `resolveProjectSession`.
- [x] 1.3 Keep the shared create-or-attach + `@ccmux_project` stamp-on-fresh-create (never on attach) for both the explicit and derived paths; confirm the `opts.resume` branch inherits explicit naming via the persisted `targetRef`.

## 2. CLI

- [x] 2.1 Update `--target-ref` help in `src/commands/task.ts` to note it names the session for `new-session` (pane for `split`/`send-to-existing`).

## 3. Tests

- [x] 3.1 `task-launcher.test.ts`: `new-session` + `targetRef` (name not existing) → creates a detached session of that exact name and stamps `@ccmux_project`; project-derived name is not used.
- [x] 3.2 `new-session` + `targetRef` naming a pre-existing session (any/foreign owner) → opens `new-window` in it, no disambiguation, no re-stamp.
- [x] 3.3 Explicit name is NOT disambiguated even when a different-project session of that name exists (contrast with the derived-name disambiguation test).
- [x] 3.4 Empty/all-illegal `targetRef` (e.g. `"  "`, `"."`) falls back to the project-derived resolution.
- [x] 3.5 Resume of a `new-session` task with a `targetRef` resolves to the same explicit name.
- [x] 3.6 `sanitizeTmuxName` unit: `.`/`:` → `-`, trimmed; and `tmuxSessionName` still returns the basename/`task` fallback.

## 4. Verify

- [x] 4.1 `bun run typecheck` and `bun test src/daemon/task-launcher.test.ts` pass; full `bun test` green.
- [x] 4.2 End-to-end against live tmux: create+run a `new-session` task with `--target-ref review` for two different projects → both land in one session named `review` (distinct windows, correct cwd per window); a task with no `--target-ref` still uses the project-derived name.
