## Why

Three friction points in the `ccmux task` CLI as shipped: you must pass the project path explicitly every time, the CLI's hardcoded `--agent claude` / `--target new-window` defaults silently defeat the config `defaults` cascade we built (the config default never applies because the CLI always sends a value), and `run`/`rm` require the full UUID. These are quick, pure-CLI ergonomics fixes with no daemon or data-model change.

## What Changes

- `ccmux task create`: the working directory defaults to the current directory (`PWD`), overridable with `-d/--dir <path>`. The required `<project>` positional is removed.
- Remove the CLI's hardcoded `--agent` and `--target` defaults so an unset flag flows through as absent, letting the daemon's default cascade (`defaults` → per-project → template → input) apply. Agent then comes from config `defaults.agent` (or the flag); `target` falls back to the built-in `new-window` server-side.
- `ccmux task run` / `rm` / (get): accept a **unique id prefix** (git-style short id), resolved CLI-side against `GET /tasks`. A prefix matching exactly one task resolves to its full id; an ambiguous prefix lists the candidates and errors; no match errors. The daemon endpoints keep taking full ids.
- `ccmux task list`: show a short id column so the prefix to type is obvious.

Non-goals (change #2, `agent-adaptive-launch`): `--name` handles, `--bg`/invoke routing, per-agent adapters + `-- <passthrough>`, and the shell-completion generator.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `task-launch`: the `Task CLI` requirement gains dir-defaulting, config-driven agent/target (no CLI-forced defaults), and id-prefix resolution for `run`/`rm`.

## Impact

- **Modified code:** `src/commands/task.ts` only (arg/option changes + a small `resolveTaskRef` helper that fetches `/tasks` and matches a prefix).
- **Unchanged:** daemon, `/tasks` routes (still full-id), task store, data model.
- **Dependencies:** none.
