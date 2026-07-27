---
name: tasks
description: |
  Scaffold and drive units of agent work with the `ccmux task` CLI — a persisted, tracked
  record (id, name, status) that you create, run, resume, track, and tear down. Use this skill
  when a prompt asks to queue or scaffold agent work, launch it into a tmux pane or headlessly,
  check on or resume it, or manage a backlog of such work, e.g. "set up a task to add the
  --dry-run flag and run it", "queue three tasks I'll run later", "resume the stopped task and
  tell it to also update the tests", "run this in a new tmux session", "spin up codex in a pane
  for this refactor", "list my tasks / what's still pending". The task target chooses headless
  (invoke-backed) vs a live pane. The user supplies the what/which-agent policy; this skill
  teaches the mechanics of `create`/`run`/`resume`/`list`/`rm`, target selection, and the
  task-vs-invoke-vs-spawn boundary. For one-shot values you thread between steps use `invoke`
  (the `dispatch` skill); for a bare human-driven pane use `ccmux spawn`.
---

# Driving work with `ccmux task`

A **task** is ccmux's persisted, trackable unit of agent work: a record with an id, a name, a
`target` (where it runs), an agent, a prompt, and a lifecycle status. Unlike a one-shot
`ccmux invoke` (ephemeral, returns a value) or a bare `ccmux spawn` (a pane you hand to a
human), a task **survives**: you create it now, run it later, watch its status, resume it
after it stops, and delete it when done. It is the right surface when the work is a *thing you
manage*, not a value you immediately consume.

This skill teaches **mechanics**. The policy — what the task should do, which agent, when to
run it — comes from the user's prompt. When unsure of a flag, run `ccmux task --help` (and
`ccmux task <verb> --help`) rather than inventing one; this skill names only flags that exist.

## When to use

- The user wants to **scaffold/queue** work to run now or later ("set up a task…", "queue…").
- The work should land in a **live tmux pane** the user (or you) will watch or attach to.
- You need to **track** a set of in-flight/pending/stopped work and act on it (`list`, `resume`).
- The work is **resumable**: launch, let it stop, come back and continue it with a follow-up.

## When NOT to use

- You need a **value back in your own context** to thread into the next step (a plan, a review,
  a summary). That is `ccmux invoke` — see the `dispatch` skill. `ccmux task` does not hand a
  headless task's output back to you on the CLI.
- A **single quick turn** with no need to track it: just `ccmux invoke <agent> "..."` once.
- Work you should just do yourself; a task is overhead when there's nothing to track.

## task vs invoke vs spawn: pick the surface

All three launch an agent; they differ in **what you get back and who consumes it**.

| Surface        | What it is                                                    | You get back                          | Reach for it when                                        |
| -------------- | ------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------- |
| `ccmux task`   | a **persisted, tracked** record you create/run/resume/list   | a task id + status; a pane or session | the work is a unit you *manage* over time                |
| `ccmux invoke` | a **one-shot headless** turn (the `dispatch` skill)          | the final response on **stdout**      | you need the **value** to thread into your next step     |
| `ccmux spawn`  | a **bare live pane** running an agent                        | a `paneId` (terminal scrollback)      | the deliverable *is* a live session a **human** drives   |

The sharp line: **if you must read the result programmatically, use `invoke`** — a task does
not surface a headless task's text output through the `task` CLI (there is no `task result`).
A task's observable outcome is its **status** (`done`/`failed`) and, for a pane task, the live
session you can jump to. A `background` task is invoke-backed under the hood, but the returned
value is not exposed by `ccmux task`; when you need that value in hand, use `invoke` directly.

## The task model

- **id** — a ULID-ish id; every verb takes the full id **or a unique prefix** (`ccmux task run 87dd`).
- **name** — a human-readable label. The `create` CLI has **no `--name`**; the name is
  **derived from the prompt** (first line). (Renaming is a TUI/edit affair, not a create flag.)
- **status** — the lifecycle: `pending` → `running` → `stopped` | `done` | `failed`.
  - `pending`: created, not yet launched. `running`: launched (pane live, or headless in flight).
  - `stopped`: an interactive task whose pane/agent closed but which retains its conversation id
    — **resumable**. `done`/`failed`: terminal.
- **session link** — once a running task binds to a ccmux session, `list` shows `→ <sessionId>`;
  jump to it with `ccmux switch <sessionId>` or the picker.

## Targets: where the task runs

`--target` chooses placement (one mutually-exclusive value; default `new-window`):

| `--target`         | Placement                                                        | Use for                                                     |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------- |
| `new-window`       | a new tmux window in the current session                        | the common interactive case                                 |
| `split`            | a split pane next to a chosen pane (needs `--target-ref`)        | working beside an existing pane                             |
| `new-session`      | a dedicated tmux session named after the project                | isolating a project's work in its own session               |
| `send-to-existing` | delivers the prompt into an existing pane (needs `--target-ref`)| a follow-up to an agent already running in a pane           |
| `background`       | **headless**, routed to the invoke subsystem (no pane)          | unattended work you only need to *complete*, not watch      |

`--bg` is shorthand for `--target background`. Pane targets (`new-window`/`split`/`new-session`)
produce a live session you (or the user) can watch and attach to; `send-to-existing` needs a
`--target-ref <pane>`; `background` runs with no pane and surfaces only status.

## Scaffolding a task: `create`

```bash
# Create a pending task (does not launch it):
ccmux task create --dir /path/to/repo --agent claude \
  --prompt "Add a --dry-run flag to the importer and cover it with a test."

# Create AND launch immediately into a new tmux window:
ccmux task create --dir /path/to/repo --agent codex --target new-window --run \
  --prompt "Implement the --dry-run flag end to end."

# Headless backlog item (invoke-backed, no pane), run now:
ccmux task create --dir /path/to/repo --agent claude --bg --run \
  --prompt "Audit the repo for TODOs and open follow-up notes."

# Into a dedicated project session (optionally named via --target-ref):
ccmux task create --dir /path/to/repo --target new-session --target-ref review --run \
  --prompt "Review the open diff."
```

Flags (all optional except a prompt or a passthrough command): `--dir` (project, default cwd),
`--agent` (default from config), `--prompt`, `--template <name>` (apply a config preset),
`--target` / `--target-ref`, `--bg`, `--run`. A **raw passthrough command** after `--` is
launched verbatim instead of a prompt:

```bash
ccmux task create --dir /path/to/repo --target new-window --run -- codex exec "run the linters"
```

`create` prints `Created task <shortId>` (and, with `--run`, `Running task <shortId> (running)`).
Note the short id it prints — that prefix is how you address the task next.

## Running, resuming, tracking

```bash
ccmux task run 87dd                       # launch a pending task (id or unique prefix)
ccmux task resume 87dd                     # re-attach a stopped task (same conversation)
ccmux task resume 87dd --prompt "also update the changelog"   # resume + a follow-up turn
ccmux task list                            # all tasks: id · status · agent · project · → session
ccmux task list --stopped                  # only the resumable (stopped) set
ccmux task rm 87dd                         # delete a task
```

- Address every task by **full id or a unique prefix**; an ambiguous prefix errors.
- `list` is your status view: each row is `<id>  <status>  <agent>  <project>  → <sessionId>`
  (the `→` link appears once a running task binds a session). Parse status from that column;
  don't infer from anything else.
- `resume` only applies to a `stopped` task (retains its conversation id); a follow-up
  `--prompt` is submitted after it re-attaches.
- To **watch or attach** to a running pane task, jump to its session: `ccmux switch <sessionId>`
  (from the `list` link) or open the picker (`ccmux picker`).

## Delivering a follow-up into a running agent

To push another instruction into a pane that already runs an agent, either create a
`send-to-existing` task targeting that pane, or use the lower-level `ccmux send`:

```bash
ccmux task create --target send-to-existing --target-ref %3 --prompt "now run the tests"
# or, directly:
ccmux send <sessionId> "now run the tests"
```

## Prerequisites

- `ccmux` on PATH and the daemon running (`ccmux daemon status`; commands auto-start it).
- A **Claude** task/agent needs its hooks installed once (`ccmux setup --agent claude`);
  subprocess agents (codex/cursor/opencode/pi/gemini) need no hooks.
- There is **no `ccmux agents` command** to enumerate agents; use the names the user gave you
  (built-ins: `claude`, `codex`, `cursor`, `opencode`, `pi`, `gemini`, plus any custom agents
  configured in `~/.config/ccmux/ccmux.json`).

## Gotchas

- **No `--name` on `create`.** The name is derived from the prompt's first line; write a clear
  first line if the name matters. Don't pass `--name` (it doesn't exist).
- **A `background` task's text output is not on the `task` CLI.** You get status, not the
  response. If you need the value, use `ccmux invoke` (the `dispatch` skill) instead.
- **An agent is required.** `create` needs an `--agent` unless your config sets a default;
  without either it fails with `Task agent is required`. Pass `--agent` explicitly (especially
  for `--bg`, which has no interactive step to fall back on).
- **`split` and `send-to-existing` require `--target-ref`.** Without a resolvable pane they
  won't launch.
- **`create` without `--run` only stores a pending task** — remember to `run` it (or pass
  `--run`). Creating is not launching.
- **Prefix addressing is unique-or-error.** If `ccmux task run ab` is ambiguous, use more
  characters or the full id.
- When a flag or behavior is unclear, run `ccmux task --help` / `ccmux task <verb> --help`
  rather than guessing.

## Worked examples

For end-to-end flows — a headless backlog task, a live-pane task, a `send-to-existing`
follow-up, and a resume-with-follow-up — read
[references/examples.md](references/examples.md) in this skill's directory.
