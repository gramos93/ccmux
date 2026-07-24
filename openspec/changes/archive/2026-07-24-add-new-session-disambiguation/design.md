## Context

`launchTask` (`src/daemon/task-launcher.ts`) resolves a `new-session` task's session via `newSessionCreateArgv()`:

```
const name = tmuxSessionName(task.project);           // basename, sanitized
const exists = has-session -t =name === code 0;
head = exists ? ["new-window","-t",name] : ["new-session","-d","-s",name];
```

`tmuxSessionName` returns `basename(project)` with `.`/`:` → `-`. The `exists` check keys off the **name only**, so any session that happens to share the basename — a different project's ccmux session, or a session the user made by hand — is attached to. The same helper is reused by the resume branch, so a fix there propagates to resume automatically.

A tmux session has a name but no intrinsic notion of "the project it was created for." We need a durable, per-session label that survives across daemon restarts and is readable back cheaply. tmux **user options** (`@name`, set via `set-option -t <sess> @ccmux_project <path>`, read via `show-option -v -t <sess> @ccmux_project`) are exactly this: session-scoped key/value that ccmux owns and tmux persists for the session's lifetime.

## Goals / Non-Goals

**Goals:**
- A `new-session` task joins an existing session **only** when that session was created by ccmux for the **same project**.
- A collision with a different (or unknown-owner) session produces a distinct, human-readable, deterministic session name — same project → same name on every run and on resume.
- No new endpoint, config key, dependency, or data-model field.

**Non-Goals:**
- Reconstructing ownership of pre-existing sessions created before this change (they are unstamped → treated as different-owner → disambiguated).
- Renaming or migrating already-running sessions.
- Cross-host / non-tmux placement.

## Decisions

### D1: Stamp ccmux-created sessions with `@ccmux_project`
When the launcher creates a fresh detached session for a `new-session` task, it immediately sets the tmux user option `@ccmux_project` to the task's absolute project path. **Rationale:** gives collision checks an authoritative owner signal without any external state (no sidecar file, no daemon-memory map that dies on restart). **Alternatives considered:** (a) compare the existing session's `#{pane_current_path}` — rejected: panes cd elsewhere, so cwd is not a reliable project identity; (b) a daemon-side `sessionName → project` map — rejected: lost on restart and races with sessions created by other daemon instances.

### D2: Collision resolution = same-project-attach, else disambiguate
Resolving the target session becomes:

1. `name = tmuxSessionName(project)`.
2. If `has-session -t =name` fails → no collision; create fresh `name` (and stamp it, per D1).
3. If it exists, read `@ccmux_project`:
   - equals `task.project` → **attach** (open a `new-window` in it) — the intended one-session-per-project reuse.
   - differs, empty, or unreadable → this name is taken by someone else → go to the **disambiguated** name (D3) and repeat the same create-or-attach test against it.

An unstamped existing session (empty `@ccmux_project`) is treated as different-owner, so ccmux never hijacks a hand-made session — a deliberate behavior improvement over today.

### D3: Deterministic disambiguated name = `<base>-<pathhash>`
The disambiguated name appends a short, stable suffix derived from the **full** project path: `<sanitized-base>-<hash>` where `<hash>` is the first 6 hex chars of a fast non-cryptographic string hash (FNV-1a / djb2) of the absolute path. **Rationale:** deterministic (same project → same suffix every run and on resume, so placement is preserved across the stop/resume cycle — the property `add-task-new-session` established), path-derived (different repos → different suffix), and short/readable in `tmux ls`. **Alternatives considered:** (a) a numeric suffix `-2`/`-3` — rejected: non-deterministic (depends on creation order), and a resume can't recompute which number it got; (b) a parent-dir segment `<parent>-<base>` — more readable but still collides two levels up and needs its own fallback; the hash is fully general and only used on the collision branch, so the common case stays clean. The disambiguated session is stamped with `@ccmux_project` too, and the resolution in D2 is re-run against it so an (astronomically unlikely) hash collision with a *different* project would disambiguate again rather than mis-attach.

### D4: Keep the shared create-or-attach path
Resolution returns `{ name, exists }`; the launcher builds the same `new-window -t name` vs `new-session -d -s name` argv as today and feeds it through the existing `runInPane`. The only additions are the pre-create `show-option` probe and the post-create `set-option` stamp (fire-and-forget; a failed stamp only means a future run may disambiguate, never a crash). Because the resume branch already calls the same resolver, resume inherits the fix with no extra code.

## Risks / Trade-offs

- **Behavior change: a task that previously joined an unrelated same-named session now gets its own.** → Intended and safer; called out in the proposal. The old behavior only "worked" by accident (correct cwd, wrong container).
- **Sessions created before this change are unstamped, so an in-flight same-basename task disambiguates instead of attaching.** → Acceptable one-time effect; stamps accrue as sessions are recreated. No corruption, only a possible extra session.
- **`show-option`/`set-option` add two tmux calls on the `new-session` path.** → Negligible (one probe, one stamp per launch); other targets are untouched.
- **Non-cryptographic hash collision across two different projects sharing a basename.** → Vanishingly rare with 6 hex chars over the small set of same-basename repos a user has; D2's re-check on the disambiguated name prevents an actual mis-attach even then.

## Migration Plan

Purely additive at runtime: the resolver gains an ownership check and a disambiguation branch; no data migration, no endpoint/protocol/config change. Existing running sessions are untouched. Rollback is reverting the `task-launcher.ts` resolver changes.

## Open Questions

- None blocking. (Possible future polish: a `ccmux` surface to list/rename disambiguated sessions — out of scope here.)
