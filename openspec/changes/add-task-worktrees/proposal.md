## Why

Tasks already carry a `worktree` intent field (`true | { branch, base }`), but nothing acts on it — the field dead-ends and every task launches in the repo root. Teams that isolate each unit of agent work on its own branch/worktree (via [wtm](https://github.com/user/wtm), a bare-repo worktree manager) have to create and enter the worktree by hand before running a task. This change makes the intent real: a worktree task provisions (or reuses) a wtm worktree and launches the agent inside it, so one task == one branch == one isolated working copy, end to end.

## What Changes

- **Provision worktrees at task run (lazy).** When a task's `worktree` intent is set, `run`/`resume` resolve a wtm worktree and launch the agent in it. `pending` tasks stay pure intent — nothing hits disk until the task actually runs.
- **wtm-only provider.** Worktrees are created via `wtm create <branch> --from <base> --no-shell` (cwd = the wtm root, path = `<root>/<branch>`). In wtm's layout the bare repo lives at `<root>/.git` with worktrees at `<root>/<branch>`, so the root is located from any cwd via `git rev-parse --git-common-dir` (→ `<root>/.git`) + a `core.bare` check, then stripping the trailing `.git` to get `<root>` (a truly-bare common dir is its own root). No fallback to native `git worktree`.
- **Non-wtm repo blocks the run, keeps the task pending.** A worktree task whose repo is not wtm-managed is **refused at run time** with a clear, actionable message ("repo is not wtm-managed; run `wtm-init` first"). The run creates nothing and does **not** transition the task — it stays `pending` (not `failed`), so once the dev adopts the repo the same task runs. ccmux does **not** adopt/init the repo itself: `wtm init` restructures the repo layout in place (moves the working tree into `<bare>/<branch>`, requires a clean tree, disrupts other open panes), so that invasive step stays in the dev's hands (via their `wtm-init` script) rather than ccmux automation, for now.
- **Idempotent reuse.** Resolution consults `git worktree list --porcelain` first, so re-running or resuming a task lands in the same worktree instead of erroring or duplicating.
- **Branch/base defaults.** Branch defaults to a slug of the task name (collision → append a short task id); base defaults to the repo default branch (`git symbolic-ref origin/HEAD`, fallback `main`/`master`). Both overridable via the intent object.
- **Session model: one session per project, one window per worktree.** The tmux session stays keyed on the project (repo/bare root, stamped `@ccmux_project`); each worktree task opens a new window in that session, named after its branch and rooted at the worktree path. Worktrees of one repo never fragment into separate sessions.
- **Persist the resolution.** The launched `TaskInstance` records the resolved `worktreePath` and `branch`, so `resume` re-enters the exact same worktree.
- **Cleanup: never automatic.** Worktrees are never removed by ccmux on task done/delete (defer to `wtm cleanup`).
- **Generalize worktree grouping (defensive).** `project-derivation.ts` strips `/.git/worktrees/<name>`, which already groups wtm worktrees correctly (their gitdir is `<root>/.git/worktrees/<name>`). Broaden the marker to strip `…/worktrees/<name>` with or without a preceding `.git/`, so a truly-bare layout (`<root>/worktrees/<name>`, no `.git/`) also groups under the repo. Byte-identical for the standard/wtm layout; no observed wtm fragmentation is being fixed — this is forward-compatible robustness.
- **Surface.** Add `--worktree` / `--branch` / `--base` flags to the task CLI; `TaskDetail` shows the resolved worktree path/branch after launch. `defaults.worktree` and per-project overrides already flow through `resolveTask`.

## Capabilities

### New Capabilities
- `task-worktree`: wtm-backed worktree provisioning for tasks — bare-root discovery, idempotent create/reuse, branch/base defaulting, the non-wtm-repo block-and-stay-pending contract, and the bare-layout project-grouping fix.

### Modified Capabilities
- `task-launch`: `Run a task into a pane` and `Resume a stopped task` swap the launch cwd to the resolved worktree (orthogonal to target) and use the one-session-per-project / one-window-per-worktree model; the `Task CLI` gains `--worktree`/`--branch`/`--base`.
- `task-store`: the task data model gains resolved `worktreePath` and `branch` correlation fields, set post-launch (absent at creation), persisted like `paneId`.
- `task-board`: the task board preview pane (`TaskDetail`) shows the resolved worktree path/branch once a task has launched.

## Impact

- **New code:** `src/lib/worktree.ts` (provider seam: `resolveBareRepo`, `resolveWorktree`; injectable runner for tests).
- **Modified code:** `src/daemon/task-launcher.ts` (effective cwd + window-per-worktree), `src/daemon/task-manager.ts` (persist resolved fields), `src/lib/task.ts` + `src/lib/task-store.ts` (`TaskInstance` fields), `src/daemon/project-derivation.ts` (grouping marker), `src/commands/task.ts` (CLI flags), `src/tui/components/TaskDetail.tsx` (render resolved path/branch).
- **External dependency:** the `wtm` binary must be on PATH for worktree tasks; the feature is inert for tasks without worktree intent.
- **No breaking changes:** worktree intent is opt-in; existing non-worktree tasks are unaffected.
