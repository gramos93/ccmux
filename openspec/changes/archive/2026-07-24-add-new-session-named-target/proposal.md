## Why

The `new-session` target always names its tmux session after the project (a sanitized basename, now path-disambiguated). There is no way to place a task into a session the user names explicitly — e.g. a long-lived `work` or `review` session they already keep, or a purpose-named container shared across projects. `add-task-new-session` listed "attaching to an arbitrary named session (only the project-derived name)" as out of scope; this closes that gap. The plumbing is already present — `targetRef` is persisted for every task and the CLI's `--target-ref` flag passes it through — it is simply ignored by `new-session`.

## What Changes

- A `new-session` task MAY carry a `targetRef`; when set, the launcher uses it (tmux-sanitized) as the **explicit session name** instead of the project-derived name. When absent, behavior is unchanged (project-derived name + ownership disambiguation).
- An explicit name is taken at face value: the launcher creates-or-attaches to exactly that session (`has-session` → new window, else detached create) and does **NOT** apply the same-project ownership/disambiguation check — naming a session is an explicit request to use it, even if it is another project's or a hand-made session.
- A freshly created explicit session is stamped with `@ccmux_project` (as project-named ones are); attaching to a pre-existing session never stamps it.
- The explicit name is stable across runs and resume (it is persisted on the task instance), so resume returns to the same named session.
- CLI: `--target-ref` already flows through; only its help text is clarified to note it names the session for `new-session`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-store`: `targetRef` semantics extend to `new-session` (an optional explicit session name), where today the spec says `new-session` does not use it.
- `task-launch`: the `new-session` launch honors an explicit `targetRef` session name (create-or-attach, no disambiguation) in preference to the project-derived name.

## Impact

- Code: `src/daemon/task-launcher.ts` (`runNewSession` name resolution + a name-sanitizer); tests in `task-launcher.test.ts`. `src/commands/task.ts` help-text only.
- No data-model field, endpoint, SSE, or config change (`targetRef` is already modeled and persisted).
- **Out of scope (follow-up):** the TUI create form still strips `targetRef` for `new-session` (`task-board`); exposing an optional session-name field there is deferred, exactly as `new-session`'s own TUI create support followed its daemon/CLI landing.
