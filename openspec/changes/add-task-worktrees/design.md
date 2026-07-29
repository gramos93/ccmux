## Context

Tasks already model a `worktree` intent (`true | { branch?, base? }`) that is persisted through the whole task pipeline but never acted on — the field's own doc comment says "actual worktree creation is out of scope … this only carries the intent." `src/lib/git.ts` has only `resolveRepoRoot`; there is no worktree code. Session-level worktree detection already works for both standard and bare layouts (`server.ts:isGitWorktree` checks `git rev-parse --git-dir` for `/worktrees/`), and **project grouping** (`project-derivation.ts`) — which strips the `/.git/worktrees/` marker — already groups wtm worktrees correctly (see the layout note below). It is broadened here only defensively, to also cover a hypothetical truly-bare layout.

The target worktree manager is `wtm`: a bare-repo tool. `wtm init` clones/adopts a repo into a wtm layout; verified empirically, that layout places the **bare repo at `<root>/.git`** with worktrees at `<root>/<branch>`, and each worktree's gitdir is `<root>/.git/worktrees/<name>` (it *does* contain `.git/`). `git -C <root> config core.bare` reports `true` (discovery reads `<root>/.git/config`), which is why `wtm` runs from `<root>`, not `<root>/.git`. `wtm create <name> --from <base>` runs `git worktree add -b <name> <root>/<name> origin/<base>`, runs a `post_create` hook, and (unless `--no-shell`) spawns a shell. `wtm` refuses to operate on non-wtm repos.

The task launcher (`task-launcher.ts`) currently launches every target with `-c task.project` (the repo root) and, for `new-session`, resolves a project-keyed session (create-or-attach) stamped with `@ccmux_project`.

## Goals / Non-Goals

**Goals:**
- Make the existing `worktree` intent real: provision (or reuse) a wtm worktree and launch the agent inside it.
- Keep provisioning lazy (at run/resume), idempotent, and confined to a single testable module.
- Preserve the one-session-per-project model; add one window per worktree.
- Fix worktree project grouping for bare layouts.
- Zero impact on tasks without worktree intent.

**Non-Goals:**
- Native `git worktree` support / any non-wtm provider. Deliberately excluded — wtm is the reason for the feature.
- Automatic worktree teardown/cleanup (defer to `wtm cleanup`).
- **Auto-adopting a non-wtm repo (`wtm init`/`wtm-init`).** Out of scope for this change — a worktree task in a non-wtm repo is blocked (task stays pending) and the dev self-inits. A future change may add opt-in auto-init behind the guard documented under Open Questions.
- Changing session enrichment's `isWorktree`/`gitBranch` derivation (already works for bare).

## Decisions

### D1: wtm-only provider
Shell out to `wtm create <branch> --from <base> --no-shell` rather than reimplementing `git worktree`. Rationale: wtm owns the bare-repo layout, `post_create` hooks, and `wtm cleanup`; duplicating that in ccmux would drift. The wtm root is discovered from any cwd via `git rev-parse --git-common-dir` → absolute → `git config --get core.bare` must be `true` there. Because wtm's common dir is `<root>/.git`, `resolveBareRepo` strips a trailing `.git` segment to return `<root>` (the dir `wtm create` must run from and under which worktrees are created); a truly-bare common dir (not named `.git`) is returned as-is. **This `.git`-strip is load-bearing** — returning `<root>/.git` would make `wtm create` place worktrees inside the git dir.
*Alternative considered:* hybrid auto-detect (wtm when bare, native `git worktree` otherwise). Rejected per product direction — the point of the feature is the wtm workflow, and a silent native fallback would produce worktrees in a layout wtm can't manage.

### D1b: Non-wtm repo blocks the run and keeps the task pending (no auto-init)
When the bare-root check fails, the daemon refuses the run with an actionable "not wtm-managed; run `wtm-init` first" error, creates nothing, and — critically — does **not** transition the task's status. The run is a precondition gate that returns before any status write, so a `pending` task stays `pending` and the identical task succeeds once the dev adopts the repo. Recommended HTTP mapping: a distinct 409 (precondition/"not yet runnable") so the TUI can render "blocked" distinctly from a malformed request; the load-bearing invariant is *status unchanged + actionable message*.
Rationale: `wtm init` adopt is invasive — `convertToBare` moves the working tree into `<bare>/<branch>`, refuses on a dirty tree, and disrupts any other pane/editor/shell already rooted in the repo. Putting that in ccmux's automatic run path would surprise the dev and could abort mid-flow. Keeping it a manual dev step (their `wtm-init` script, which also symlinks the canonical `post_create` hook) is the safe default for now.
*Alternatives considered:* (a) auto-init silently on run — rejected: invasive, non-consensual restructuring, fails on dirty trees. (b) fail the task (`failed`) — rejected: the task is fine, only the repo isn't ready; `pending` keeps it trivially re-runnable. (c) auto-init behind a flag/config with a clean-tree + no-other-live-sessions guard — deferred (see Non-Goals / Open Questions); the guard design is captured so a later change can add it safely.

### D2: Provider seam in `src/lib/worktree.ts` with an injected runner
Expose `resolveBareRepo(cwd)` and `resolveWorktree(bareRoot, { branch, base })`. Both take an injectable command runner (mirroring `task-launcher`'s `TmuxRunner` and `git.ts`'s `Bun.spawn` usage) so unit tests fake `git`/`wtm` without a live binary. `resolveWorktree` returns `{ path, branch, created }`.
*Alternative considered:* extend `git.ts`. Rejected — worktree logic is substantial and wtm-specific; a dedicated module keeps `git.ts` a thin primitive.

### D3: Idempotent resolution via `git worktree list --porcelain`
Before calling `wtm create`, list worktrees and reuse one whose branch matches the resolved branch (return its path, `created: false`). This makes re-run and resume safe and avoids `wtm create` erroring on an existing branch. Only when no match exists do we create.
*Alternative considered:* try `wtm create` and swallow the "already exists" error. Rejected — parsing wtm's error text is brittle; an explicit list is deterministic and also yields the existing path.

### D4: Branch/base defaulting
Branch: explicit `worktree.branch` → else `slug(taskDisplayName)` → on collision (branch/worktree already exists) append a short task-id suffix. Reuse the existing slug/derivation style from `deriveTaskName`. Base: explicit `worktree.base` → else default branch via `git symbolic-ref refs/remotes/origin/HEAD` (strip `refs/remotes/origin/`), falling back to `main` then `master`. Keeping this in `worktree.ts` (pure given the runner) keeps the launcher thin.

### D5: Worktree is an effective-cwd swap, orthogonal to target
In `launchTask`, compute `effectiveCwd = task.worktree ? resolved.path : task.project` once, and thread it into every `-c` argument and the pre-launch existence check. No target's control flow changes. For `new-session`, keep `resolveProjectSession` keyed on `task.project` (so `@ccmux_project` and grouping stay repo-level) but open the new window `-c effectiveCwd -n <branch>`. This delivers "one session per project, one window per worktree" with a minimal diff.
*Alternative considered:* a session per worktree. Rejected per product direction (chosen: one project session, window per worktree).

### D6: Persist resolved fields; resume reuses
After a successful worktree launch, `TaskManager` patches the instance with `worktreePath` and `branch` (new optional correlation fields on `TaskInstance`, in the store's editable/patch set). `resume` passes the persisted `worktreePath` through the idempotent resolver so it re-enters the same worktree. These fields are launch-derived, never creation input.

### D7: Generalize `project-derivation.ts` grouping (defensive)
Change `resolveWorktreeProject` to locate `${sep}worktrees${sep}<name>` and derive the repo root by stripping from `worktrees` (dropping an immediately-preceding `.git` segment when present). Standard/wtm layout → strips `/.git/worktrees/<name>` (**byte-identical to the prior result** — wtm worktrees already grouped correctly, verified `deriveProject(<root>/main) === basename(<root>)`); truly-bare layout → strips `/worktrees/<name>` to the bare dir basename. Guard against submodule `.git/modules/<name>` gitdirs as today (only the `worktrees` marker matches). This is forward-compatible robustness, not a fix for observed wtm fragmentation.

## Risks / Trade-offs

- **wtm binary missing / not on PATH** → the run fails; surface a clear error distinct from the non-bare error so the user knows to install wtm vs. `wtm init`.
- **`wtm create` spawns work via `post_create` hooks** (arbitrary user script) → we run with `--no-shell` and inherit wtm's own hook behavior; ccmux does not add or interpret hooks. Document that hook side effects are the user's.
- **Branch-slug collisions across unrelated tasks** → mitigated by the existence check + task-id suffix; two tasks explicitly naming the same branch intentionally share a worktree (idempotent reuse), which is the desired behavior.
- **`git rev-parse --git-common-dir` returns a relative path** → resolve against cwd before the `core.bare` check (same realpath discipline as `resolveRepoRoot`).
- **Grouping-marker change regressions** → covered by keeping the standard-layout result byte-identical and adding bare-layout cases to `project-derivation.test.ts`.
- **Non-worktree tasks must stay untouched** → the effective-cwd swap is gated entirely on `task.worktree` being set; add a test asserting no wtm/git worktree calls happen for a plain task.

## Migration Plan

Additive and opt-in — no data migration. Existing tasks have no `worktree` intent and are unaffected; existing persisted instances simply lack the new `worktreePath`/`branch` fields (both optional). Rollback is removing the feature; no on-disk task shape depends on it. Worktrees created on disk persist regardless (never auto-removed), so a rollback leaves user worktrees intact for `wtm` to manage.

## Open Questions

- Window naming collisions: if two worktree tasks resolve the same branch name in one session, tmux allows duplicate window names — acceptable, or should we suffix? (Leaning: allow; the branch is the same worktree by design.)
- Missing `wtm` binary (installed vs. not) vs. non-wtm repo (installed but repo not adopted) should be *distinct* errors so the dev knows whether to install wtm or run `wtm-init`.
- **Deferred: opt-in auto-init.** A later change could adopt a non-wtm repo automatically behind an explicit opt-in (`--wtm-init` flag or `worktree.autoInit` config), gated by a safety precheck: refuse unless the working tree is clean **and** ccmux sees no other live sessions/panes rooted in that repo (the adopt layout-move would disrupt them). It would shell the dev's `wtm-init` (hook-linking) rather than bare `wtm init`. Interactive TUI could confirm inline; headless runs would require the explicit opt-in. Captured here so the block-now behavior can graduate safely.
