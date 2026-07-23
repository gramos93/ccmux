## Context

`task-launcher.ts:buildTaskCommand` emits `<binary> --prompt '<prompt>'`. No agent uses `--prompt`: headless flags are `-p` (gemini/pi/antigravity/copilot), `--print` (cursor), `run` (opencode), `exec` (codex); Claude uses none. So a launched non-Claude task runs a bogus command. `/spawn` (`server.ts:1811-1830`) has the identical bug.

Two per-agent models already exist and should be reused instead of extended:
- **Headless:** `AgentDef.invokeMode` (`args`/`resumeArgs`/`output` + `{prompt}`/`{id}`/`{tmpfile}` placeholders; stdin unless `{prompt}` is in argv). Driven by `SubprocessInvoker`/`ClaudeInvoker`, chosen by `InvokerRegistry.get` (`invokeMode` → subprocess; `claude` → claude). Entry: `InvocationManager.invoke(InvokeInput)`.
- **Interactive:** only `executable` (fresh binary) and `resumeCommand` (`{id}`). There is *no* modeled "interactive + initial prompt" flag. `ClaudeInvoker` handles this by launching the bare binary, waiting for `readyPattern`, then send-keys'ing the prompt into the pane.

## Goals / Non-Goals

**Goals:** agent-adaptive interactive launch (reuse `executable`/`readyPattern`/`resumeCommand`, drop `--prompt`); `background` target routed to the invoke subsystem; raw `--` passthrough; wire it through `TaskManager.run` and the `ccmux task` CLI.

**Non-Goals:** fixing `/spawn`'s twin bug (follow-up; can reuse the new builder), adding a per-agent "interactive prompt flag" field (ready-then-send removes the need), streaming background output into the TUI, and re-touching the `Task CLI` spec requirement (owned by `add-task-cli-ergonomics`; this change adds bg/passthrough as their own requirements to avoid conflicting deltas).

## Decisions

**D1 — Interactive launch = launch bare binary, wait for ready, then submit the prompt via the proven paste helper (generalize `ClaudeInvoker`).** Prompt delivery uses `sendPromptToPane` (bracketed paste + a *separate, delayed* Enter), NOT a batched `send-keys <text> Enter` — live testing confirmed the batched form leaves the text unsubmitted in claude's composer. The launch command uses `sendLiteralToPane` (same separate-Enter reason). Both are injected into the launcher (default = pane-io) so tests stay tmux-free; pane creation + the ready-poll capture stay on `runTmux`. Build the launch command from `executable` (or `resumeCommand` when the task resumes a session), run it in the pane, poll the pane capture for the agent's `readyPattern` (bounded timeout), then deliver the prompt via `send-keys`. This is agent-adaptive with zero new per-agent config and matches how Claude already launches. Extract/reuse the claude-invoker ready-wait + `sendLiteralToPane` helpers rather than reimplementing.
- *Alternatives — keep `--prompt` (rejected, wrong for every agent); add an `interactiveMode` field with a per-agent prompt flag (rejected: most agents' interactive entry has no clean initial-prompt flag; ready-then-send is what actually works and needs no new metadata).*
- *Risk:* readiness polling adds latency and can time out on a slow/absent `readyPattern`. Mitigation: a sane timeout then send anyway; agents without a `readyPattern` fall back to a short fixed delay.

**D2 — `background` target routes to `InvocationManager.invoke`.** `TaskManager` gains an injected invoke bridge (a function wrapping `invocationManager.invoke`, wired in `index.ts` where both live). On a `background` run: mint an `invocationId`, resolve the `AgentDef`, build `InvokeInput { invocationId, agent, prompt, cwd: project, timeoutMs }`, call the bridge, patch the task with `invocationId` + `running`, and — since invoke resolves asynchronously — patch `done`/`failed` from the result without blocking the HTTP response. The registry already rejects non-invokable agents (`noInvokeModeMessage`); surface that as the run error.
- *Alternative — POST to `/invoke` from the CLI instead of an in-daemon bridge:* rejected; `TaskManager` is already in the daemon, so a direct call avoids a self-HTTP hop and keeps the task lifecycle owner in one place.
- *Note:* correlation for background tasks rides the existing invoke path (`originInvocationId`); the task stores `invocationId` for lookup. Full task↔invocation join can deepen later.

**D3 — Passthrough `command: string[]` on `TaskSpec`.** When present, the launcher runs it verbatim in the pane (interactive targets), skipping the adapter. CLI: `ccmux task create ... <agent> -- <raw>` using commander `enablePositionalOptions()` + `passThroughOptions()` (or capturing `program.args` after `--`), modeled on `invoke`'s `[args...]`. Passthrough is pane-only this slice (a background passthrough would duplicate `ccmux invoke`).

**D4 — Model.** `TaskTarget` adds `"background"`; `TaskSpec` adds optional `command?: string[]`. `new-session` stays reserved. `validateNewTask` accepts `background`; `resolveTask` built-in target default stays `new-window`.

**D5 — Routing branch in `TaskManager.run`.** `run` branches once on `target === "background"` → invoke bridge; else → the (now adaptive) pane launcher. Pane correlation (`pendingCorrelation`) is unchanged for pane targets; background tasks don't register a pane.

## Risks / Trade-offs

- **Ready-wait flakiness / latency** → bounded timeout + fixed-delay fallback for agents without `readyPattern` (D1).
- **Background invoke is long-running** → `run` returns immediately with `running` + `invocationId`; completion patches status asynchronously, mirroring the invoke lifecycle. Daemon restart mid-invoke loses the async patch (status stuck `running`) — acceptable at POC; a boot reconcile against `invocationManager` is the escape hatch.
- **Passthrough shell-escaping** → argv is sent as discrete `send-keys` tokens (no shell string interpolation), avoiding the quoting hazard the current `--prompt` string has.
- **Two active changes touch `src/commands/task.ts`** → non-overlapping spec requirements; recommend applying `add-task-cli-ergonomics` first, then this, resolving any code-level merge in `task.ts` at apply time.

## Migration Plan

Additive model fields (`background` target, `command`); old task files load unchanged. The `--prompt` removal changes launch behavior for pane tasks (previously broken for non-Claude) — a fix, not a regression. Rollback = revert; persisted `command`/`background` are ignored by older code. No protocol/route change (reuses `POST /tasks/{id}/run` and `task_updated`).

## Open Questions

- Should a `background` task whose agent is Claude use the Claude invoker (interactive-in-detached-session + JSONL) automatically? Yes by default (the registry already routes `claude` → `ClaudeInvoker`), but confirm that's the desired "background claude" semantics vs. requiring an explicit interactive target.
