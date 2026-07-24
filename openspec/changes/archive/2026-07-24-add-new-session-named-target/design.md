## Context

`runNewSession` in `src/daemon/task-launcher.ts` resolves a `new-session` task's session via `resolveProjectSession(deps, task.project)` — always a project-derived name (sanitized basename, path-disambiguated on cross-project collision), then create-or-attach and a `@ccmux_project` stamp on fresh create. `targetRef` is already part of `TaskSpec`, persisted unconditionally by the store, and passed through by the CLI (`--target-ref`); it is consumed only by `send-to-existing` (a pane id) and `split`. For `new-session` it is currently dead data.

The goal is to let `targetRef`, when present on a `new-session` task, act as an explicit session name that overrides the derived one.

## Goals / Non-Goals

**Goals:**
- `new-session` + `targetRef` → launch into a session named exactly `targetRef` (sanitized), create-or-attach.
- Explicit name bypasses the project-ownership/disambiguation logic — the user is naming a specific container on purpose.
- Deterministic and resume-stable (the name is the persisted `targetRef`).
- No new field, endpoint, config, or data migration.

**Non-Goals:**
- Exposing the explicit name in the TUI create form (deferred; the form keeps stripping `targetRef` for `new-session`).
- Changing project-derived behavior when `targetRef` is absent.
- Cross-session move/rename of an already-running task.

## Decisions

### D1: `targetRef` is the explicit session name for `new-session`
When a `new-session` task has a non-empty `targetRef`, the launcher uses it as the session name; otherwise it falls back to `resolveProjectSession`. **Rationale:** reuses the already-modeled, already-persisted, already-CLI-wired field — the field's doc already reads "the tmux pane **or session** a target acts on." **Alternative considered:** a distinct `named-session` target — rejected: it would duplicate the entire `new-session` launch/resume path for a pure naming difference, and multiply the target enum.

### D2: Explicit name is NOT disambiguated
For an explicit name the launcher does a plain create-or-attach: `has-session -t =name` → open a `new-window` in it; else `new-session -d -s name`. It does **not** read `@ccmux_project` or fall to a hashed name. **Rationale:** naming `review` means "use the session called `review`," even if another project or the user created it — that is the whole point of the feature, and it is the pre-disambiguation semantics the derived path deliberately moved away from. Ownership disambiguation exists to stop *accidental* basename collisions; an explicit name is not accidental. **Trade-off:** two projects that both name their session `review` share it — intended, and symmetric with how the user would use a hand-made shared session.

### D3: Stamp on fresh create, never on attach
A fresh explicit session is stamped `@ccmux_project = task.project` (same as the derived path) so ccmux recognizes it later; attaching to a pre-existing session leaves it untouched (never clobber a session we did not just create). **Rationale:** consistency with the derived path and the binder's expectations; harmless because the derived-name disambiguation keys off the project basename, not arbitrary names, so a stamped explicit session never perturbs project-derived resolution.

### D4: Sanitize, with fallback to the derived name
The explicit name is sanitized with the same rule tmux forbids (`.`/`:` → `-`, trimmed). If the result is empty (e.g. `targetRef` was whitespace or all-illegal), the launcher falls back to the project-derived resolution rather than failing — a lenient, no-surprise default. **Implementation:** factor the char-replace out of `tmuxSessionName` into a small `sanitizeTmuxName(raw)` used by both (the basename path keeps its own `basename()` + `task` fallback).

### D5: Shared by run and resume
The name-selection lives inside `runNewSession`, which both the fresh-run and `opts.resume` branches already call. Because `targetRef` persists on the instance, resume recomputes the same explicit name with no extra code — the resume-stability property carries over for free.

## Risks / Trade-offs

- **Attaching to a foreign/hand-made session by name** → intended (D2); the launched window is still `-c task.project`, so the agent runs in the right directory even when the session container is shared.
- **A `targetRef` that looks like a pane id (`%3`) on a `new-session` task** → treated as a session name `%3` (sanitized keeps `%`; tmux allows it). Mild footgun, but `new-session` has no pane-id meaning; documenting that `targetRef` is a *name* for this target is sufficient. No cross-target validation is added (consistent with ccmux's minimal validation stance).
- **Two calls racing to create the same explicit name** → the same tolerated race as the derived path (second `new-session -d -s name` would fail); out of scope to harden here.

## Migration Plan

Purely additive: a field that `new-session` ignored is now honored. No data migration (existing `new-session` tasks have no `targetRef` and keep project-derived naming), no endpoint/protocol/config change. Rollback is reverting the `runNewSession` name-selection branch.

## Open Questions

- None blocking. (TUI create-form exposure is a named follow-up, not an open question.)
