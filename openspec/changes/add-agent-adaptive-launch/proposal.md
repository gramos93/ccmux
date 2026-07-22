## Why

Task launch hardcodes `<binary> --prompt '<prompt>'`, which matches **no** agent's real CLI — every built-in agent passes prompts differently (`-p`, `--print`, `run`, `exec`, or stdin), and Claude takes none (interactive + JSONL). So a launched non-Claude task today runs a bogus command. Meanwhile ccmux already models per-agent invocation fully (`AgentDef.invokeMode`) for the headless `invoke` subsystem, and interactively for Claude (launch bare, wait for `readyPattern`, send-keys the prompt). This change makes task launch **agent-adaptive** by reusing that existing metadata, adds a **background** mode that routes to the invoke subsystem, and adds a **raw passthrough** escape hatch so the dev can always bypass the adapter.

## What Changes

- **Agent-adaptive interactive launch.** Replace the hardcoded `--prompt` (`src/daemon/task-launcher.ts`) with the Claude-invoker pattern generalized to all agents: launch the agent's `executable` (or `resumeCommand` when resuming), wait for its `readyPattern` (timeout fallback), then deliver the prompt via `send-keys`. No per-agent guessing; uses `executable`/`readyPattern`/`resumeCommand` already on `AgentDef`.
- **Background (headless) tasks route to the invoke subsystem.** Add a `background` task target: instead of a pane, the daemon builds an `InvokeInput` and calls `InvocationManager.invoke` (which already picks `ClaudeInvoker` vs `SubprocessInvoker` from `invokeMode` and captures output). The task records the `invocationId`, stays `running`, and flips to `done`/`failed` when the invocation resolves. Realizes the fork's "headless Task = invocation, interactive Task = spawn" convergence.
- **Raw passthrough.** `TaskSpec` gains an optional `command: string[]` (raw argv). When set, the launcher runs it verbatim in the pane, bypassing the adapter entirely. CLI surface: `ccmux task create ... -- <raw agent args>` (modeled on `invoke`'s `[args...]`, with commander passthrough enabled).
- **CLI:** `--bg` (sets `target: background`) and the `-- <passthrough>` tail on `ccmux task create`.

Non-goals: fixing `/spawn`'s identical `--prompt` bug (shares the flaw; a follow-up can reuse the new adaptive builder), a per-agent "interactive initial-prompt flag" field (the ready-then-send pattern avoids needing one), and streaming background output into the TUI (invoke already captures it; surfacing is a later slice).

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `task-store`: `target` gains `background`; `TaskSpec` gains optional `command` (raw passthrough argv).
- `task-launch`: interactive launch becomes agent-adaptive (ready-then-send, not `--prompt`); adds background→invoke execution and passthrough launch.

## Impact

- **Modified code:** `src/lib/task.ts` (`target` union + `command` field), `src/daemon/task-launcher.ts` (adaptive builder + passthrough), `src/daemon/task-manager.ts` (`run` branches interactive vs background; needs an injected invoke bridge), `src/daemon/index.ts` (wire `InvocationManager` into `TaskManager`), `src/commands/task.ts` (`--bg`, `--` passthrough).
- **Reused (unchanged):** `AgentDef.invokeMode`/`executable`/`readyPattern`/`resumeCommand`, `InvocationManager.invoke`, the invoker registry, the Claude ready-then-send helper.
- **Depends on / composes with:** `add-task-cli-ergonomics` (both touch `src/commands/task.ts`; this change deliberately does not re-modify the `Task CLI` spec requirement to avoid conflicting deltas — apply ergonomics first for the cleanest merge).
- **Dependencies:** none added.
