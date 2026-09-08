## Context

`launchTask` (`src/daemon/task-launcher.ts`) resume dispatch:

```ts
if (opts.resume) {
  const launchCommand = buildLaunchCommand(task, deps, { resume: true });
  if (task.target === "new-session") return runNewSession(launchCommand, opts.prompt);
  return runInPane(paneCreateArgv("new-window"), launchCommand, opts.prompt); // ← current session
}
```

`paneCreateArgv("new-window")` runs `tmux new-window` with no `-t <session>`, so it lands in the attached client's session. `runNewSession` already does the right thing for `new-session`: it resolves a session name (explicit `targetRef` name, else `resolveProjectSession(project)` — the tmux-sanitized project basename, path-disambiguated) and create-or-attaches it. `resolveTaskActivation` (`src/tui/utils/task-create.ts`) is pure over the task alone; for `done` it returns `resume` when a `nativeSessionId` is present, else `run` — with no check of whether the task's pane is still alive. The board (`App.tsx`) has `getSessionById(sessionId)` to join a task to its live `EnrichedSession`.

## Goals / Non-Goals

**Goals:**
- Resume places every target into the project-named session (create-or-attach), never the current session.
- Reviving a `done` task with a live pane jumps to it (no duplicate); a dead-pane `done`/`stopped` resumes into the project session, else runs.

**Non-Goals:**
- Changing fresh (non-resume) `new-window`/`split` launches — those correctly open in the current session.
- Guarding the CLI `ccmux task resume` against a live-pane `done` task (documented edge; the board gates it).
- Any endpoint/schema change.

## Decisions

### D1: Resume routes all targets through the project-session create-or-attach
The resume dispatch becomes: `new-session` → `runNewSession` honoring its explicit `targetRef` name; **every other target** → `runNewSession` using the **project-derived** name (ignoring `targetRef`). `runNewSession` gains a `honorTargetRef` flag (default `true`, preserving the fresh-run and `new-session`-resume behavior); the non-`new-session` resume passes `false`, so a `split`/`send-to-existing` task's pane-id `targetRef` is not mistaken for a session name. **Rationale:** one deterministic, project-associated placement for every resume; reuses the proven `runNewSession` create-or-attach (stamp `@ccmux_project`, disambiguation) instead of `new-window`-in-current-session. **Alternative:** teach `paneCreateArgv` to target a session — rejected; that's just re-deriving `runNewSession`.

### D2: `resolveTaskActivation` becomes liveness-aware for `done`
It gains an optional `liveSession` argument (the caller's `getSessionById(task.sessionId)`). New `done` arm: **jump** when `liveSession` has a `tmuxPane` (the pane is still open — go to it), else **resume** when the task has a `nativeSessionId`, else **run**. `pending`/`stopped`/`running` arms are unchanged (`running` already jumps on `sessionId`). **Rationale:** `done` is user-set and may leave the pane alive; jumping avoids spawning a duplicate agent on the same conversation, and matches how `running` is activated. **Alternative:** gate liveness in the daemon (refuse resume if the session is live) — deferred; the board is the surface the user drives, and jump is inherently a client action.

### D3: `enter` jumps a live `done`, `r` stays run/resume-only
Both `activateSelectedTask` (enter) and `runOrResumeSelectedTask` (`r`) pass the joined live session into `resolveTaskActivation`. `enter` acts on `run`/`resume`/`jump`; `r` acts only on `run`/`resume` (ignores `jump`, as it already does for `running`). So for a live `done` task, `enter` jumps to the pane and `r` is a no-op — consistent with how a `running` row behaves. For a dead-pane `done`, both resume/run.

### D4: Resume is only reached when the pane is gone
Because D2 makes the board jump (not resume) whenever the pane is live, a resume is dispatched only for a genuinely closed pane — so D1's unconditional project-session placement is always the right target. The daemon needs no liveness check of its own for the board path.

## Risks / Trade-offs

- **A resumed non-`new-session` task now appears in a project session, not the current one** → intended and the whole point; deterministic and project-associated. Fresh launches are unaffected.
- **CLI `ccmux task resume` on a live-`done` task can still duplicate** → documented edge (D2's gate is client-side). Fixable later with a daemon-side liveness refusal if it bites.
- **`resolveTaskActivation` signature changes** → an added optional arg; the pure-logic tests pass the live session explicitly, existing callers updated.

## Migration Plan

Additive/behavioral: the resume dispatch changes placement and activation gains a liveness check. No schema, endpoint, config, or data migration. Rollback = revert the resume dispatch, the `honorTargetRef` flag, and the `resolveTaskActivation` liveness arm.

## Open Questions

- None blocking. (A daemon-side "refuse resume if the task's session is still live" guard would also cover the CLI edge — a candidate follow-up.)
