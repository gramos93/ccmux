## 1. Worktree provider module

- [x] 1.1 Create `src/lib/worktree.ts` with an injectable command runner (mirroring `git.ts`/`task-launcher.ts`): `resolveBareRepo(cwd)` runs `git rev-parse --git-common-dir`, resolves to absolute, and confirms `git config --get core.bare` is `true`; returns the bare root or `null`
- [x] 1.2 Add `resolveWorktree(bareRoot, { branch, base })` returning `{ path, branch, created }`: list via `git worktree list --porcelain`, reuse a branch-matching worktree, else `wtm create <branch> --from <base> --no-shell` at `bareRoot` producing `<bare>/<branch>`
- [x] 1.3 Implement branch defaulting (`slug(taskDisplayName)`, collision → short task-id suffix) and base defaulting (`git symbolic-ref refs/remotes/origin/HEAD`, fallback `main`→`master`)
- [x] 1.4 Define the error contract as distinct, typed outcomes: non-bare/non-wtm repo → actionable "not wtm-managed; run `wtm-init`" (the run-should-stay-pending signal); missing `wtm` binary → "install wtm"; do NOT auto-init/adopt
- [x] 1.5 Write `src/lib/worktree.test.ts` with a faked runner: bare-root discovery from root and from a worktree, create vs reuse, branch/base defaulting + collision suffix, non-bare error, missing-wtm error

## 2. Task model & store

- [x] 2.1 Add optional `worktreePath` and `branch` correlation fields to `TaskInstance` in `src/lib/task.ts` (post-launch, not creation input)
- [x] 2.2 Add `worktreePath`/`branch` to the store's patchable field set in `src/lib/task-store.ts` (keep them out of creation-time editable input) and cover persistence in `task-store.test.ts`

## 3. Launcher wiring

- [x] 3.1 In `src/daemon/task-launcher.ts`, compute `effectiveCwd = task.worktree ? (await resolveWorktree(...)).path : task.project` (via injected worktree resolver) and thread it into every `-c` argument and the pre-launch existence check; the resolver runs BEFORE pane creation so a non-wtm block short-circuits with nothing created
- [x] 3.2 For `new-session`, keep `resolveProjectSession` keyed on `task.project` but open the new window with `-c effectiveCwd -n <branch>` (one project session, one branch-named window per worktree)
- [x] 3.3 Return the resolved `worktreePath`/`branch` from the launch result so the manager can persist them; make the worktree resolver injectable for tests
- [x] 3.4 Resume path: pass the persisted `worktreePath` through the idempotent resolver so resume re-enters the same worktree
- [x] 3.5 Extend `task-launcher.test.ts`: worktree swaps cwd for each target, non-worktree task makes no worktree/wtm calls, new-session opens a branch-named window in the project session, non-bare repo short-circuits before any pane is created

## 4. Manager persistence & the block-and-stay-pending gate

- [x] 4.1 In `src/daemon/task-manager.ts`, persist `worktreePath`/`branch` from the launch result on `run` and `resume` (patch alongside `paneId`/status) and cover it in `task-manager.test.ts`
- [x] 4.2 On `run`/`resume`, detect the non-wtm block outcome BEFORE writing `status: running`, so the task's status is left unchanged (`pending` stays `pending`, never `failed`); surface the actionable error to the caller
- [x] 4.3 Map the block outcome in `src/daemon/server.ts` to a distinct HTTP status (409) with the actionable message (separate from the 400 malformed-request/missing-dir cases); cover in `server.test.ts`
- [x] 4.4 Assert in `task-manager.test.ts` that a blocked worktree run leaves the task `pending` and emits no `running`/`failed` transition, and that re-running after the repo becomes wtm-managed succeeds

## 5. Project grouping fix

- [x] 5.1 In `src/daemon/project-derivation.ts`, broaden `resolveWorktreeProject` to strip `…/worktrees/<name>` with or without a preceding `.git/` segment (bare vs standard), keeping the standard-layout result byte-identical and still rejecting submodule `.git/modules/<name>` gitdirs
- [x] 5.2 Add bare-layout grouping cases to `project-derivation.test.ts` (bare worktree groups under the bare repo basename; standard worktree unchanged)

## 6. CLI & TUI surface

- [x] 6.1 Add `--worktree`, `--branch <name>`, `--base <ref>` flags to `ccmux task create` in `src/commands/task.ts` (`--worktree` alone → `true`; `--branch`/`--base` → object form; unset → absent) and cover in `task.test.ts`
- [x] 6.2 Update `src/tui/components/TaskDetail.tsx` to show the resolved `worktreePath`/`branch` after launch (intent-only before launch) and cover in its test
- [x] 6.3 Surface the non-wtm block in the CLI/TUI: `ccmux task run` prints the actionable "run `wtm-init`" message and reports the task still pending; the task board reflects the still-pending status (no failed state)

## 7. Verification

- [x] 7.1 `bun run typecheck` and `bun test` green
- [x] 7.2 End-to-end in a detached tmux session: create a worktree task in a wtm-managed bare repo, run it, confirm the agent launches in `<bare>/<branch>` as a branch-named window in the project session; verify a worktree task in a non-bare repo is blocked (actionable `wtm-init` message, task stays `pending`, nothing created), then `wtm-init` the repo and confirm the same task now runs
- [x] 7.3 Confirm in the picker/TUI that two worktrees of one repo group under a single project (grouping fix) — capture pane output
