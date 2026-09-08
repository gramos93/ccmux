## ADDED Requirements

### Requirement: wtm-only worktree provider

The system SHALL provision task worktrees exclusively through `wtm`, the bare-repo worktree manager. It SHALL NOT fall back to native `git worktree` creation. Worktree provisioning SHALL be encapsulated in a single module (`src/lib/worktree.ts`) exposing a `resolveBareRepo(cwd)` discovery helper and a `resolveWorktree(bareRoot, { branch, base })` provisioner, with the external command runner injectable so the module is testable without a live `wtm`/`git`.

The wtm root — the directory `wtm` commands run from and under which worktrees live (`<root>/<branch>`) — SHALL be located from any working directory (the root, or any existing worktree within it) by running `git rev-parse --git-common-dir`, resolving it to an absolute path, and confirming `core.bare` is `true` there. In wtm's layout the common git dir is a `.git` subdirectory of the root (`<root>/.git`), so when the resolved common dir is named `.git` the root is its parent; a truly-bare common dir (not named `.git`) is its own root. A directory that is not `core.bare` (an ordinary repo) resolves to `null` (→ the non-wtm block).

#### Scenario: Locate the wtm root from the root directory

- **WHEN** `resolveBareRepo` is called with a wtm-managed repository's root path
- **THEN** it returns that root's absolute path (the parent of `<root>/.git`)

#### Scenario: Locate the wtm root from within a worktree

- **WHEN** `resolveBareRepo` is called with the path of an existing worktree of a wtm-managed repo
- **THEN** it resolves the shared common git dir (`<root>/.git`) and returns the same root (`<root>`), not the `.git` directory

#### Scenario: An ordinary (non-bare) repo resolves to null

- **WHEN** `resolveBareRepo` is called inside an ordinary non-bare git repository
- **THEN** it returns `null` so the run is blocked as non-wtm

### Requirement: Provision or reuse a worktree at task run

When a task carries worktree intent (`worktree` is `true` or an object), the daemon SHALL resolve a worktree for it at run/resume time (lazily — never at task creation), and launch the agent with that worktree path as its working directory. Resolution SHALL be idempotent: before creating anything, the daemon SHALL consult `git worktree list --porcelain` and reuse an existing worktree whose branch matches the resolved branch, rather than erroring or creating a duplicate. When no matching worktree exists, the daemon SHALL create one via `wtm create <branch> --from <base> --no-shell` run with its cwd set to the bare repository root, producing the worktree at `<bare>/<branch>`. Resolution SHALL return the absolute worktree path and the resolved branch name.

#### Scenario: Create a new worktree on first run

- **WHEN** a worktree task is run and no worktree for its resolved branch exists yet
- **THEN** `wtm create <branch> --from <base> --no-shell` is run at the bare root and the agent launches with the new `<bare>/<branch>` directory as its working directory

#### Scenario: Reuse an existing worktree

- **WHEN** a worktree task is run and a worktree whose branch matches the resolved branch already exists
- **THEN** no new worktree is created and the agent launches in the existing worktree's path

#### Scenario: Provisioning is lazy

- **WHEN** a worktree task is created but not yet run
- **THEN** no worktree is created on disk

### Requirement: Branch and base defaulting

The system SHALL derive the worktree branch and base when the intent does not specify them. The branch SHALL default to a slug of the task's display name; when that slug collides with an existing branch/worktree, a short task-id suffix SHALL be appended to make it unique. The base SHALL default to the repository's default branch, detected via `git symbolic-ref refs/remotes/origin/HEAD` and falling back to `main` then `master`. An explicit `worktree.branch` and/or `worktree.base` SHALL override the respective default.

#### Scenario: Branch derived from the task name

- **WHEN** a worktree task with no explicit branch and name "Add dry-run flag" is run
- **THEN** the resolved branch is a slug such as `add-dry-run-flag`

#### Scenario: Branch collision appends a task-id suffix

- **WHEN** the derived branch slug already exists as a branch or worktree
- **THEN** a short task-id suffix is appended so the resolved branch is unique

#### Scenario: Explicit branch and base override the defaults

- **WHEN** a worktree task specifies `{ branch: "feature-x", base: "develop" }`
- **THEN** the worktree is created as `feature-x` from `develop`, ignoring the derived defaults

#### Scenario: Base defaults to the repo default branch

- **WHEN** a worktree task with no explicit base is run
- **THEN** the base is the branch reported by `origin/HEAD` (falling back to `main`, then `master`)

### Requirement: Non-wtm repository blocks the run and keeps the task pending

When a task carries worktree intent but its repository is not wtm-managed (no bare repository can be confirmed via `git rev-parse --git-common-dir` + `core.bare`), the daemon SHALL refuse the run with a clear, actionable error stating the repo is not wtm-managed and that the dev must run `wtm init` first. The refused run SHALL create nothing (no worktree, no pane, no agent launch) and SHALL NOT transition the task's status: a `pending` task stays `pending` (not `failed`), so the identical task runs successfully once the dev has adopted the repo. The daemon SHALL NOT adopt/init the repository itself. A task without worktree intent SHALL be unaffected and launch in the repo root as before.

#### Scenario: Worktree task in a non-bare repo is blocked and stays pending

- **WHEN** a `pending` worktree task is run in a repository that is not wtm-managed (not bare)
- **THEN** the run is refused with an actionable "not wtm-managed; run `wtm init`" error, nothing is created or launched, and the task's status remains `pending`

#### Scenario: The same task runs after the dev adopts the repo

- **WHEN** a worktree task that was previously blocked is run again after the dev has run `wtm init` on its repo
- **THEN** the worktree is provisioned and the agent launches, with no change to the task other than the successful run

#### Scenario: ccmux never adopts the repo

- **WHEN** a worktree task is run in a non-wtm repo
- **THEN** the repository's on-disk layout is left untouched (ccmux does not run `wtm init`)

#### Scenario: Non-worktree task is unaffected

- **WHEN** a task with no worktree intent is run in any repository
- **THEN** it launches in the repo root exactly as before, with no wtm involvement

### Requirement: Worktrees are never auto-removed

The daemon SHALL NOT remove a worktree as part of any task lifecycle transition (done, failed, delete, or session teardown). Worktree cleanup is left to the user (e.g. `wtm cleanup`).

#### Scenario: Deleting a worktree task leaves the worktree on disk

- **WHEN** a task that provisioned a worktree is marked done or deleted
- **THEN** the worktree directory and branch remain on disk untouched

### Requirement: Worktrees group under their repository

The daemon's project derivation SHALL group all worktrees of a repository under the repository name, resolving a worktree gitdir of the form `…/worktrees/<name>` whether or not a `.git/` segment precedes it. This covers both the wtm layout (bare repo at `<root>/.git`, worktrees at `<root>/<branch>`, so gitdir `<root>/.git/worktrees/<name>`) and a defensively-handled truly-bare layout (gitdir `<root>/worktrees/<name>`, no `.git/`). In both cases the derived project SHALL be the repository root's basename, not the worktree directory's name.

Note: the wtm layout already resolves correctly under the pre-existing `/.git/worktrees/` handling; broadening the marker is a defensive generalization that additionally covers a no-`.git` bare layout, not a fix for an observed fragmentation of wtm worktrees.

#### Scenario: Standard / wtm worktree groups under the repo root

- **WHEN** project derivation runs for a worktree whose gitdir is `<root>/.git/worktrees/<name>`
- **THEN** the derived project is the repository root's basename

#### Scenario: Truly-bare worktree (no `.git/` segment) groups under the bare repo

- **WHEN** project derivation runs for a worktree whose gitdir is `<root>/worktrees/<name>` (no `.git/` segment)
- **THEN** the derived project is the bare repository root's basename, not the worktree directory's name
