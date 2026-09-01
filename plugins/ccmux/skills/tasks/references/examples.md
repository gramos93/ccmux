# Worked examples: scaffolding and driving tasks

These flows assume `ccmux` is on PATH and the daemon is up (`ccmux daemon status`). Addressing
uses the short id `create` prints; substitute the real prefix each command reports. Agent
names are illustrative — use whatever the user's policy specifies.

## 1. Headless backlog task (invoke-backed, no pane)

Unattended work you only need to *complete*, not watch. Track it by status; if you need the
actual response text, use `ccmux invoke` instead (see the `dispatch` skill).

```bash
REPO=/path/to/repo

# Create + run a headless task in one step. (--bg needs an agent: pass --agent
# unless your config sets a default.)
ccmux task create --dir "$REPO" --agent claude --bg --run \
  --prompt "Scan for stale TODOs and write a short summary to NOTES.md."
# -> Created task 4f2a1c9b
#    Running task 4f2a1c9b (running)

# Poll its status (the row's status column is the source of truth):
ccmux task list | grep '^4f2a'
# 4f2a1c9b  running   claude  /path/to/repo
# ...later...
# 4f2a1c9b  done      claude  /path/to/repo

# Done or failed is the outcome. There is no `task result`; for the text, you'd have used invoke.
```

## 2. Live-pane task you can watch

An interactive placement: the task lands in a tmux window/session you can jump to.

```bash
REPO=/path/to/repo

ccmux task create --dir "$REPO" --agent codex --target new-window --run \
  --prompt "Implement the --dry-run flag end to end; add a test."
# -> Created task 87ddbb9b
#    Running task 87ddbb9b (running)

# Find its session link and jump in to watch/attach:
ccmux task list | grep '^87dd'
# 87ddbb9b  running   codex  /path/to/repo  → sess-xyz
ccmux switch sess-xyz          # or: ccmux picker
```

## 3. Follow-up into an already-running agent (`send-to-existing`)

Push another instruction into a pane that already runs an agent — either as a tracked task or
directly with `ccmux send`.

```bash
# As a tracked send-to-existing task (needs the target pane id):
ccmux task create --target send-to-existing --target-ref %3 \
  --prompt "Now run the linters and fix what they flag."

# Or lower-level, straight to the session's pane:
ccmux send sess-xyz "Now run the linters and fix what they flag."
```

## 4. Resume a stopped task with a follow-up

A task that stopped (its pane/agent closed) keeps its conversation id and is resumable.

```bash
# See what's resumable:
ccmux task list --stopped
# 87ddbb9b  stopped   codex  /path/to/repo

# Resume and continue the same conversation with a new instruction:
ccmux task resume 87dd --prompt "Also update the changelog and open a short PR description."
# -> Resumed task 87ddbb9b (running)
```

## 5. Scaffold a backlog now, run later

Create pending tasks without `--run`, then launch them when ready.

```bash
REPO=/path/to/repo
ccmux task create --dir "$REPO" --agent claude --prompt "Write migration notes for v2."
ccmux task create --dir "$REPO" --agent codex  --prompt "Add integration tests for the importer."
# Both are pending. Launch one when you want it:
ccmux task list                 # copy the prefix you want
ccmux task run <prefix>
```

## 6. Run a task on its own branch/worktree (wtm)

Isolate a task on its own branch. Worktree intent is orthogonal to `--target`; it only changes
the working directory. Requires a **wtm-managed** repo — ccmux never adopts one for you.

```bash
REPO=/path/to/wtm-repo

# Explicit branch + base; launches into a branch-named window in the project session.
ccmux task create --dir "$REPO" --agent claude --branch feat-x --base main --run \
  --prompt "Implement feature X on its own branch."
# -> Created task 9a1b…  /  Running task 9a1b… (running)
#    Agent launches in  <root>/feat-x  ;  worktree reused on resume, never auto-removed.

# Default branch (slug of the task name), default base (origin/HEAD):
ccmux task create --dir "$REPO" --agent codex --worktree --run \
  --prompt "Add a --dry-run flag."
```

If the repo is **not** wtm-managed, the run is refused and the task stays `pending`:

```bash
ccmux task create --dir /path/to/plain-repo --agent claude --worktree --run \
  --prompt "..."
# -> Created task 3c7d…
#    Failed to run task: /path/to/plain-repo is not a wtm-managed (bare) repository —
#    run `wtm init` there first, then run this task
ccmux task list | grep '^3c7d'
# 3c7d…  pending   claude  /path/to/plain-repo      <- still pending, not failed

# Don't silently adopt. PROPOSE it, confirm a clean tree, then (with the user's OK):
cd /path/to/plain-repo && git status --porcelain   # must be empty
wtm init .                                          # plain init; restructures the repo in place.
                                                    # Keep post_create as a setup stub — it must
                                                    # NOT launch an agent (ccmux owns the launch;
                                                    # wtm create always runs post_create).
# Now the SAME task runs:
ccmux task run 3c7d
```

## Cleaning up

```bash
ccmux task rm <prefix>          # delete a task by id or unique prefix
# Worktrees are NOT removed by ccmux — clean them up with wtm when done:
#   wtm cleanup            (in the wtm repo; deletes merged worktrees)
```
