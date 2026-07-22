## 1. Model (`src/lib/task.ts`)

- [ ] 1.1 Add `"background"` to `TaskTarget`; keep `new-session` reserved; add it to `VALID_TASK_TARGETS`
- [ ] 1.2 Add optional `command?: string[]` (raw passthrough argv) to `TaskSpec`
- [ ] 1.3 `validateNewTask` accepts `background`; `resolveTask` built-in target default stays `new-window`

## 2. Agent-adaptive interactive launcher (`src/daemon/task-launcher.ts`)

- [ ] 2.1 Replace `buildTaskCommand`'s `--prompt` with an adaptive launch command: `resumeCommand`-with-`{id}` when resuming, else `executable` (fallback to agent name / `prefs.command` for claude)
- [ ] 2.2 `launchTask` new-window/split: create pane, launch the command, then deliver the prompt via `send-keys` after the agent's `readyPattern` matches (bounded timeout; fixed-delay fallback when no `readyPattern`). Reuse the claude-invoker ready-wait / `sendLiteralToPane` helpers
- [ ] 2.3 When the task has a `command` argv, launch it verbatim (discrete `send-keys` tokens) instead of the adapter command
- [ ] 2.4 Keep `send-to-existing` (raw prompt to `targetRef`); background is NOT handled here (see §3)
- [ ] 2.5 Before creating a pane, verify the task's working directory exists (`existsSync` + `isDirectory`); throw a clear error if not (→ `handleRunTask` 400). Authoritative counterpart to the CLI's create-time check

## 3. Background routing (`src/daemon/task-manager.ts` + `index.ts`)

- [ ] 3.1 Inject an invoke bridge into `TaskManager` (`(input) => invocationManager.invoke(input)`); wire it in `index.ts` where both are constructed
- [ ] 3.2 `run` branches on `target === "background"`: mint `invocationId`, resolve `AgentDef`, build `InvokeInput { invocationId, agent, prompt, cwd: project, timeoutMs }`, call the bridge; patch task `{ status: "running", ... }` with the `invocationId`
- [ ] 3.3 On invoke resolution, patch status `done`/`failed` asynchronously (don't block the run response); emit `task_updated`
- [ ] 3.4 A non-invokable agent (no `invokeMode`, not claude) → surface the registry/`noInvokeModeMessage` error so `handleRunTask` maps it to 400 and status is not left `running`
- [ ] 3.5 Add `command`/`invocationId` to the store patch surface if needed (extend `patchTask`'s allowed keys)

## 4. CLI (`src/commands/task.ts`)

- [ ] 4.1 Add `--bg` to `create` → sets `target: "background"`
- [ ] 4.2 Enable commander passthrough (`enablePositionalOptions`/`passThroughOptions`) and capture the tail after `--` as `command`; send it in the create body
- [ ] 4.3 Reflect `background`/`command` in `list` output where useful (e.g. show `bg` or the command)

## 5. Tests

- [ ] 5.1 Launcher: adaptive command uses `executable`/`resumeCommand` (not `--prompt`); ready-then-send delivers the prompt after a matching capture (fake tmux runner + fake capture); passthrough `command` launched verbatim; a missing working directory throws before any tmux call
- [ ] 5.2 Manager: `background` run calls the injected invoke bridge with a correct `InvokeInput`, records `invocationId`, stays `running`, then patches `done`/`failed` on resolve (inject a fake bridge); non-invokable agent errors without leaving `running`
- [ ] 5.3 Manager: interactive run still records `paneId` + correlates (regression against the fake launcher)
- [ ] 5.4 Model: `background` target validates; `command` round-trips through create→get
- [ ] 5.5 CLI: `--bg` sets target background; `-- <args>` captured as `command` (mock fetch, assert body)

## 6. Verification

- [ ] 6.1 `bun run typecheck` passes
- [ ] 6.2 `bun test` passes
- [ ] 6.3 Live smoke (isolated daemon, detached tmux): an interactive `ccmux task create -d <repo> --agent <a> --prompt X --run` launches the real agent binary (not `--prompt`) and the prompt lands after ready; a `--bg` task runs headlessly via invoke and flips to `done`; a `-- <raw>` task launches the raw command verbatim
- [ ] 6.4 Confirm no TUI renderer / `/spawn` changes (spawn's twin bug left as a noted follow-up)
