## Why

ccmux ships a rich **task** interface — a persisted, tracked unit of agent work (`ccmux task create/run/resume/list/rm`) whose `target` picks headless execution (routed to the invoke subsystem) or a live tmux pane. But nothing teaches a coding agent how to use it. The existing `dispatch` skill covers only raw `ccmux invoke` orchestration (the LLM as a router firing one-shot turns); there is no guidance for the higher-level task interface that scaffolds, names, tracks, and resumes work. Agents therefore can't reliably drive the primary surface the project is built around. Add a `tasks` skill, installable from the repo exactly like `dispatch`.

## What Changes

- **New `tasks` skill** at `plugins/ccmux/skills/tasks/SKILL.md` (standard Agent Skill frontmatter with trigger-rich `description`) teaching an agent to drive the task CLI: scaffold a task with the right `target`, run/resume it, list/track its lifecycle, deliver follow-ups, and delete it.
- **A `references/` worked-example** file with concrete task flows (headless backlog task, live pane task, send-to-existing follow-up, resume).
- **Mirror** the skill into `.claude/skills/tasks/` for the repo's own agent, matching the `dispatch` precedent (the plugin dir is the source of truth; the marketplace `source` `./plugins/ccmux` ships it).
- **Update plugin metadata** — `plugins/ccmux/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `plugins/ccmux/README.md` — so the plugin's description reflects task scaffolding, not just `invoke`.

The skill teaches **mechanics**, not a task-per-goal policy (that comes from the user's prompt), mirroring how `dispatch` is scoped. It also draws the boundary between `ccmux task` (persisted/tracked), raw `ccmux invoke` (one-shot, the `dispatch` skill), and `ccmux spawn` (a bare live pane).

## Capabilities

### New Capabilities
- `agent-skills`: the ccmux plugin bundles agent-facing skills that teach an agent to drive the ccmux CLI; this change adds the task-authoring skill and requires the plugin metadata to advertise it.

### Modified Capabilities
<!-- none -->

## Impact

- Files: new `plugins/ccmux/skills/tasks/SKILL.md` (+ `references/examples.md`), mirrored `.claude/skills/tasks/`; edited `plugins/ccmux/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugins/ccmux/README.md`.
- **Documentation only** — no `src/`, CLI, daemon, or spec-behavior change. Nothing to run; the skill is prose the agent reads.
- Depends on the existing `ccmux task` CLI (already shipped); the skill references its real flags.
