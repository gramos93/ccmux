## Context

Skills in this repo live at `plugins/ccmux/skills/<name>/SKILL.md` (standard Agent Skill: YAML frontmatter `name` + trigger-rich `description`, then Markdown body, optional `references/*.md`). The plugin dir is the source of truth; the marketplace manifest (`.claude-plugin/marketplace.json`) points `source` at `./plugins/ccmux`, so anything under `plugins/ccmux/skills/` installs via `/plugin marketplace add epilande/ccmux` + `/plugin install ccmux@ccmux`. The repo's own agent reads a **copy** at `.claude/skills/<name>/` (verified: `.claude/skills/dispatch` is byte-identical to the plugin copy). Today the only skill is `dispatch`, which teaches raw `ccmux invoke` orchestration.

The `ccmux task` CLI: `create [--dir --agent --prompt --template --target --target-ref --bg --run] [-- passthrough]`, `run <ref>`, `resume <ref> [--prompt]`, `list [--stopped]`, `rm <ref>`. `--target` ∈ `new-window | split | send-to-existing | background | new-session`. A `background` task is routed to the invoke subsystem (headless); pane targets open live tmux panes. A task is persisted with an id, a name (derived from the prompt when unset), and a lifecycle status (`pending → running → stopped|done|failed`); `run`/`resume`/`list`/`rm` operate by id-or-unique-prefix.

## Goals / Non-Goals

**Goals:**
- A `tasks` skill that lets an agent scaffold, run, resume, track, and tear down tasks correctly.
- Draw the boundary between `task`, raw `invoke` (`dispatch` skill), and `spawn`.
- Ship it the same way `dispatch` ships (plugin + mirror + advertised metadata).

**Non-Goals:**
- A task-per-goal policy (agent-selection/decomposition comes from the user's prompt).
- Any `src/`/CLI/daemon change, or new task features (the skill documents what exists).
- Re-teaching raw `invoke` orchestration (that's `dispatch`; cross-link instead of duplicate).

## Decisions

### D1: A separate `tasks` skill, not an extension of `dispatch`
`dispatch` teaches the LLM-as-router pattern over one-shot `ccmux invoke` (fire/poll/join/cancel, ephemeral sessions). `tasks` teaches the **persisted, tracked** interface (a durable record with a name/status you create, run, resume, and list). Distinct triggers ("scaffold a task", "queue this", "resume the stopped task", "run it in a pane") and distinct mental models. **Alternative:** fold into `dispatch` — rejected: it would blur two models and bloat one file; the two skills cross-reference instead.

### D2: Location + mirror, matching `dispatch`
Author at `plugins/ccmux/skills/tasks/{SKILL.md,references/examples.md}`; copy to `.claude/skills/tasks/`. No marketplace `plugins[]` edit needed (source is the whole plugin dir); only the human-facing descriptions change (D5). **Rationale:** exactly the shape already in the repo, so install-from-GitHub works with no new wiring.

### D3: Content scope — the task model + the CLI verbs + the boundary
The body teaches, in order: (1) what a task is (persisted id + derived name + lifecycle status, correlated to a session); (2) **target selection** — `background` (headless, invoke-backed, for unattended work whose result you read back) vs `new-window`/`split`/`new-session` (live panes for supervised/interactive work) vs `send-to-existing` (deliver into a pane that already runs an agent); (3) the verbs — `create` (with `--run` to launch immediately, `--bg` shorthand, `--template`, `-- passthrough`), `run`, `resume --prompt`, `list --stopped`, `rm`, addressing tasks by unique id-prefix; (4) tracking/reading state and delivering follow-ups; (5) **task vs invoke vs spawn** — when to reach for each. Keep it mechanics-first and policy-agnostic like `dispatch`.

### D4: Stay honest to the CLI
Reference only real flags (from `ccmux task --help`) and call out the sharp edges: the CLI `create` has **no `--name`** (the name derives from the prompt; renaming is a TUI/edit-endpoint affair), addressing is by id or unique prefix, and `send-to-existing` requires a `--target-ref` pane. The skill tells the agent to run `ccmux task --help` when unsure rather than inventing flags. **Rationale:** a skill that hallucinates flags is worse than none; anchoring to `--help` bounds drift.

### D5: Advertise both skills in plugin metadata
Broaden the `description` in `plugin.json` and `marketplace.json` from "dispatch work … through invoke" to cover task scaffolding/tracking, and add a "tasks skill" section to `plugins/ccmux/README.md` (install line, trigger summary, `/ccmux:tasks`). **Rationale:** discovery — the current metadata implies invoke-only.

## Risks / Trade-offs

- **Skill drifts from the CLI as flags evolve** → mitigated by D4 (anchor to `--help`, minimal flag transcription) and by this change living next to the CLI in the same repo.
- **Overlap/confusion with `dispatch`** → mitigated by D1's explicit boundary section and reciprocal cross-links.
- **Mirror divergence** (`.claude/skills` copy drifting from the plugin) → keep them byte-identical; note the plugin dir is canonical (same as `dispatch` today).

## Migration Plan

Purely additive documentation. No runtime, data, or protocol change; nothing to migrate or roll back beyond deleting the new files and reverting the metadata description edits.

## Open Questions

- None blocking. (A future refinement could add a `--name` flag to `ccmux task create` so the skill needn't route naming through the TUI — out of scope here.)
