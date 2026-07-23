## Context

Phase 1 (`add-task-teardown-correlation`) added `TaskInstance.nativeSessionId` (the agent's durable conversation id) and the `stopped` status (agent/pane closed, native id retained). The launcher already models the idea — its "Run a task into a pane" requirement says "run the agent's interactive binary (`executable`, or `resumeCommand` when resuming a session)" — but the resume branch was never built. The invoke subsystem's `buildClaudeLaunchCommand` is the reference: claude has no `resumeCommand` and uses `<binary> --resume <id>`; other agents carry `resumeCommand` with an `{id}` placeholder (`codex resume {id}`, `cursor-agent --resume {id}`, …); some agents have neither and can't resume.

## Goals / Non-Goals

**Goals:** `POST /tasks/{id}/resume` + `TaskManager.resume`; a launcher resume mode (resume command, no prompt); agent-resumability gating; `ccmux task resume` + `list --stopped`.

**Non-Goals:** a follow-up prompt on resume (re-attach only), a resumed-pane target choice (always `new-window`), new-tmux-session target, the TUI board (phase 3). No data-model change (phase 1's fields suffice).

## Decisions

**D1 — Resume = relaunch the resume command into a fresh pane; follow-up prompt optional.** Reuse the pane path (cwd check → create pane → send launch command → correlate) but build the *resume* command instead of the fresh `executable`. Prompt delivery is conditional: with **no** follow-up prompt, skip ready-wait + submit entirely (re-attach is the whole job); with a follow-up prompt, ready-wait then `sendPromptToPane` exactly as `run` does. The resumed session re-correlates through the existing `pendingCorrelation` path, giving a new `paneId`/`sessionId` while `nativeSessionId` stays.

**D7 — Follow-up prompt reuses `run`'s ready-then-send.** The machinery is identical to a fresh launch's prompt delivery — wait for `readyPattern` (timeout fallback), then submit via the bracketed-paste helper. `launchTask`'s resume branch takes the follow-up as `opts.prompt`; when present it runs the same ready-then-send tail, when absent it returns right after launching the resume command. No new mechanism — the only branch is "was a follow-up prompt given?".

**D2 — Resume command mirrors `buildClaudeLaunchCommand`.** In `buildLaunchCommand(task, deps, { resume })`: claude → `${prefs.command ?? "claude"} --resume ${nativeSessionId}`; else an agent with `resumeCommand` → `resumeCommand.replace("{id}", nativeSessionId)`; else throw "agent does not support resume". This keeps one source of truth for per-agent resume shape and reuses the metadata already on `AgentDef`.

**D3 — Resumability gating, checked before any tmux.** `resume(id)` requires: the task exists (else the caller returns `404`), `status === "stopped"`, `nativeSessionId` set, and the agent is resumable (claude or has `resumeCommand`). Any failing precondition throws → the route maps it to `400` and nothing is launched. Requiring `stopped` avoids spawning a duplicate for a task that's still `running`.

**D4 — Launch bridge takes an opts arg.** Generalize the injected `TaskLaunchFn` to `(task, opts?: { resume?: boolean; prompt?: string }) => Promise<LaunchResult>`; `run` calls it with no opts, `resume` with `{ resume: true }` (+ `prompt` when a follow-up was supplied). `index.ts` wires `launch: (task, opts) => launchTask(task, deps, opts)`. One dep, one launcher, resume is just a mode — no parallel code path.

**D5 — Resumed pane is always `new-window`.** A `stopped` task's original pane/split context is gone; "resume in a new pane" is the natural behavior and avoids resolving a stale `targetRef`. The launcher forces `new-window` for a resume regardless of the task's stored `target`.

**D6 — CLI.** `ccmux task resume <ref>` reuses `resolveTaskRef` (prefix) then `POST /resume`. `ccmux task list --stopped` filters the list client-side to `status === "stopped"` — the resumable set at a glance.

## Risks / Trade-offs

- **`opencode`'s `resumeCommand` (`opencode --continue`) has no `{id}`** — it resumes the most recent session, not necessarily this task's. → Accepted; it's the same behavior ccmux's invoke path uses. The `{id}` replace is a harmless no-op there.
- **Re-attach without a prompt means the user drives the resumed agent** — that's the default; supplying `--prompt` submits a "continue with X" turn after ready (D7).
- **Resuming when the native id is stale/expired** (agent GC'd the conversation) → the agent's own resume errors in-pane; the task is still `running` with a live pane. Acceptable; detecting agent-side resume failure is out of scope.
- **A resumed task that's closed again** → phase-1 teardown fires and it returns to `stopped`, re-resumable. The cycle composes for free.

## Migration Plan

Additive: new route + CLI subcommand/flag; reuses `task_updated` and existing correlation. No model or protocol change. Rollback = revert; `stopped` tasks simply become dead-ends again.

## Open Questions

- None outstanding for this phase.
