## 1. Launcher resume mode (`src/daemon/task-launcher.ts`)

- [x] 1.1 `buildLaunchCommand(task, deps, opts?)`: when `opts.resume`, build the resume command — claude → `${prefs.command ?? "claude"} --resume ${task.nativeSessionId}`; else agent `resumeCommand` with `{id}` → `nativeSessionId`; else throw "agent does not support resume"
- [x] 1.2 `launchTask(task, deps, opts?: { resume?; prompt? })`: on `opts.resume`, force a `new-window` pane, launch the resume command via `sendLiteral`; if `opts.prompt` is given, ready-wait + `sendPrompt` (reuse the run tail), else skip; return `{ paneId }`
- [x] 1.3 Add a `isResumable(agent)` helper (claude or has `resumeCommand`) for the manager's gating

## 2. Manager resume (`src/daemon/task-manager.ts` + `index.ts`)

- [x] 2.1 Generalize the injected `TaskLaunchFn` to `(task, opts?: { resume?: boolean; prompt?: string }) => Promise<LaunchResult>`; `run` passes no opts
- [x] 2.2 Add `resume(id, prompt?)`: get task (undefined → caller 404); throw when not `stopped`, no `nativeSessionId`, or agent not resumable (→400); call `launch(task, { resume: true, prompt })`; `patchTask { status: "running", paneId }`; register `pendingCorrelation`; emit `updated`
- [x] 2.3 `index.ts`: wire the launch bridge to pass opts through (`launch: (task, opts) => launchTask(task, deps, opts)`); resumability check uses the daemon's agent lookup

## 3. Server route (`src/daemon/server.ts`)

- [x] 3.1 Add `POST /tasks/{id}/resume` route (suffixed, before the generic `/tasks/{id}`)
- [x] 3.2 `handleResumeTask`: read optional `{ prompt }` from the JSON body (tolerate an empty body); 404 when missing; 400 on a gating failure (not stopped / no native id / non-resumable agent / launch error); 200 `{ success: true, task }` on resume

## 4. CLI (`src/commands/task.ts`)

- [x] 4.1 Add `resume <ref>` subcommand with an optional `--prompt <text>`: `resolveTaskRef` then `POST /tasks/{id}/resume` with `{ prompt }` when provided
- [x] 4.2 Add `--stopped` flag to `list` filtering output to `status === "stopped"`

## 5. Tests

- [x] 5.1 Launcher: `buildLaunchCommand({resume})` → claude `--resume <native>`; agent `resumeCommand` `{id}` substitution; non-resumable throws. `launchTask({resume})` forces new-window, launches resume cmd, sends NO prompt; `launchTask({resume, prompt})` ready-waits + sends the follow-up (inject fakes)
- [x] 5.2 Manager: `resume` on a stopped+resumable task → running, new pane recorded, pendingCorrelation set, emits updated; `resume(id, prompt)` threads the follow-up to launch; rejects not-stopped / no-nativeSessionId / non-resumable agent; missing id → undefined
- [x] 5.3 Server: `POST /tasks/{id}/resume` → 404 missing, 400 not-stopped, 200 re-attach, 200 with a follow-up prompt in the body (stub launch)
- [x] 5.4 CLI: `resume <ref>` resolves prefix then POSTs `/resume`; `resume <ref> --prompt <t>` includes it in the body; `list --stopped` filters

## 6. Verification

- [x] 6.1 `bun run typecheck` passes
- [x] 6.2 `bun test` passes
- [ ] 6.3 Live smoke (real claude): create+run a task, close its pane → `stopped`; `ccmux task resume <id>` → claude relaunches with `--resume <nativeSessionId>` in a new pane (prior conversation loaded, no new prompt), task back to `running` and re-correlates; `ccmux task resume <id> --prompt "continue: …"` submits the follow-up after ready; `ccmux task list --stopped` shows only stopped tasks
- [x] 6.4 Confirm no renderer/TUI-board code added
