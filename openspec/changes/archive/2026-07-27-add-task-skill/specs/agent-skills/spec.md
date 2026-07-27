## ADDED Requirements

### Requirement: Task-authoring skill in the ccmux plugin

The ccmux plugin SHALL bundle a `tasks` Agent Skill at `plugins/ccmux/skills/tasks/SKILL.md` that teaches an agent to drive the `ccmux task` CLI. The skill file SHALL carry standard Agent Skill frontmatter — a `name` and a trigger-rich `description` naming when to use it (scaffolding/queuing a task, running or resuming it, tracking task state) — and SHALL be mirrored, byte-identical, to `.claude/skills/tasks/SKILL.md` for the repo's own agent, following the existing `dispatch` skill's layout. Because the marketplace manifest's plugin `source` is the plugin directory, the skill SHALL install from the repository with no additional marketplace wiring. The skill SHALL teach mechanics only and remain policy-agnostic (the task-per-goal decomposition comes from the user's prompt), and SHALL anchor to `ccmux task --help` for flags rather than inventing them.

#### Scenario: Skill present and installable

- **WHEN** the ccmux plugin is installed from the repository
- **THEN** a `tasks` skill is available to the agent with valid frontmatter (a `name` and a trigger-describing `description`), sourced from `plugins/ccmux/skills/tasks/SKILL.md`

#### Scenario: Mirrored for the repo's own agent

- **WHEN** the repository is checked out
- **THEN** `.claude/skills/tasks/SKILL.md` exists and is byte-identical to the plugin copy (matching the `dispatch` skill's mirroring)

### Requirement: Task skill covers the task lifecycle and target selection

The `tasks` skill SHALL teach the full task lifecycle and how to choose a placement. It SHALL explain that a task is a persisted, tracked record with an id, a name (derived from the prompt when unset), and a status (`pending → running → stopped | done | failed`), addressable by id or unique id-prefix. It SHALL document the CLI verbs — `create` (including `--run`, the `--bg` headless shorthand, `--template`, `--target`, `--target-ref`, and the `--` passthrough), `run`, `resume` (with a follow-up `--prompt`), `list` (including `--stopped`), and `rm`. It SHALL explain **target selection**: `background` (headless, routed to the invoke subsystem, for unattended work whose result is read back) versus the live-pane targets `new-window`/`split`/`new-session` versus `send-to-existing` (deliver into a pane already running an agent, which requires a target-ref). It SHALL draw the boundary between `ccmux task` (persisted/tracked), raw `ccmux invoke` (one-shot; the `dispatch` skill), and `ccmux spawn` (a bare live pane), cross-linking `dispatch` rather than duplicating it.

#### Scenario: Scaffolding guidance

- **WHEN** an agent consults the skill to create a task
- **THEN** it finds how to pick a `target` (headless `background` vs a live pane vs `send-to-existing`), set the agent/prompt/dir, apply a template, use `--run`, and pass a raw command after `--`

#### Scenario: Run, resume, and track

- **WHEN** an agent needs to launch, resume, or check on a task
- **THEN** the skill shows `run <ref>`, `resume <ref> --prompt`, and `list [--stopped]`, addressing tasks by unique id-prefix, and explains the status lifecycle

#### Scenario: Choosing task vs invoke vs spawn

- **WHEN** an agent is unsure whether to use a task, a raw invoke, or a spawn
- **THEN** the skill states the boundary — persisted/tracked work → `task`; a one-shot value → `invoke` (dispatch skill); a bare human-driven pane → `spawn`

#### Scenario: Worked examples provided

- **WHEN** an agent needs a concrete pattern
- **THEN** a `references/` example file shows end-to-end flows (a headless backlog task, a live-pane task, a `send-to-existing` follow-up, and a resume)

### Requirement: Plugin metadata advertises the task skill

The plugin metadata SHALL reflect that the plugin provides task scaffolding/tracking, not `invoke` alone. The `plugins/ccmux/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` `description` fields SHALL mention driving the task interface, and `plugins/ccmux/README.md` SHALL document the `tasks` skill (its install line, trigger summary, and invocable name).

#### Scenario: Descriptions mention tasks

- **WHEN** a user reads the plugin or marketplace description
- **THEN** it conveys that the plugin drives ccmux tasks (create/run/resume/track), not only `ccmux invoke`

#### Scenario: README documents the skill

- **WHEN** a user reads `plugins/ccmux/README.md`
- **THEN** it describes the `tasks` skill alongside `dispatch`, including how it is invoked
