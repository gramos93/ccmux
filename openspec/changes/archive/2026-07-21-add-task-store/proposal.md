## Why

The fork grows ccmux from a session *monitor* into a light *launch + track plane* for the agentic SDLC. Every launch/track feature (spawn-a-task, kanban board, templates) needs one shared primitive — a `Task` — and a place to persist task instances that is separate from user config. This change lands only that foundation: the data model and its store. It is pure data (no daemon, API, TUI, or spawn wiring), so it is independently testable with `bun test` and carries zero renderer risk, while unblocking every later slice.

## What Changes

- Introduce a `Task` type: one schema with two lifecycles — a persistent **template** (lives in config) and an ephemeral **instance** (lives in state, deleted on done). Fields: `project`, `target` (`new-window` | `split` | `send-to-existing`; `new-session` reserved for later), optional `targetRef` (the pane/session a `split` or `send-to-existing` target acts on), `worktree` (typed `boolean | { branch?: string; base?: string }` so a branch/base can be named at creation), `agent`, `prompt` (a slash-command, when present, is just part of the prompt string — not a separate field), `status`, plus identity/timestamps.
- Add a new **state home** distinct from the config dir: `$CCMUX_STATE_HOME` → default `~/.ccmux`. `$CCMUX_HOME` is already the config dir (`~/.config/ccmux`) and stays config-only. Only the task store lands here now; relocating other runtime state is out of scope.
- Add a `task-store` persistence layer (one JSON file per instance, `~/.ccmux/tasks/<id>.json`, modeled on `src/lib/state.ts`): create / list / get / update-status / delete task instances. Malformed/absent files are skipped so listing degrades to empty, never throws.
- Extend `Preferences` (`src/lib/preferences.ts`) with the config-side surface: `templates` (named `Task` presets), `projects` (per-project overrides), and `defaults` (global task defaults, e.g. `worktree`, `agent`, `target`). Define the default cascade: global config → per-project override → template → creation-time input.

Non-goals (later changes): daemon `/tasks` CRUD + SSE, spawn/pane correlation, TUI launch/board view, keymap mirror.

## Capabilities

### New Capabilities
- `task-store`: The `Task`/`TaskTemplate` data model, the `$CCMUX_STATE_HOME` (`~/.ccmux`) resolution, the persistent task-instance store (CRUD over JSON), and the config-side default-cascade resolution that produces a concrete `Task` from global defaults + project override + template + creation input.

### Modified Capabilities
<!-- None: no existing specs in openspec/specs/; this is the first captured capability. -->

## Impact

- **New code:** task types (e.g. `src/types/task.ts` or `src/lib/task.ts`), `src/lib/task-store.ts`, `$CCMUX_STATE_HOME` resolution in `src/lib/config.ts`.
- **Modified code:** `src/lib/preferences.ts` (`Preferences` gains `templates`, `projects`, `defaults`; new `TaskTemplate` / `ProjectConfig` / `TaskDefaults` types).
- **Filesystem:** new dir `~/.ccmux` (created lazily on first write); config dir `~/.config/ccmux` unchanged.
- **No impact:** daemon, HTTP/SSE protocol, TUI renderer, tmux spawning — untouched by this change.
- **Dependencies:** none added.
