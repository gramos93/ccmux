# ccmux plugin

A Claude Code plugin whose skills teach your agent to drive other AI coding agents (Claude Code, Codex, Cursor, OpenCode, Pi, Gemini, or any custom agent) through the ccmux CLI. It ships two skills: **`dispatch`**, for orchestrating one-shot `ccmux invoke` turns (your LLM is the router), and **`tasks`**, for scaffolding, running, resuming, and tracking persistent `ccmux task` units of work. ccmux is the cross-harness substrate both drive work through.

## Prerequisite

This plugin is **additive glue for the ccmux CLI**, which the skill calls (`ccmux invoke`, `ccmux invoke list`, and friends). The skill does nothing without it. Install ccmux first and make sure it is on your `PATH`:

- See the [ccmux install instructions](https://github.com/epilande/ccmux#-installation).
- Verify with `ccmux daemon status`.

## Install

In Claude Code:

```
/plugin marketplace add epilande/ccmux
/plugin install ccmux@ccmux
```

Or from a shell:

```bash
claude plugin marketplace add epilande/ccmux
claude plugin install ccmux@ccmux
```

## What it does

**`dispatch`** (`/ccmux:dispatch`) triggers when you ask your agent to coordinate, delegate, fan out, or pipeline work across multiple agents (for example, "plan with claude, implement with codex, search with gemini"). It teaches the mechanics of firing, polling, joining, cancelling, and reading worker output over `ccmux invoke`, plus where the invoke boundary is: when to hand a long or human-supervised job off to `ccmux spawn` (a live pane) instead of invoking it. You supply the agent-per-task policy in your prompt. See [`skills/dispatch/SKILL.md`](skills/dispatch/SKILL.md).

**`tasks`** (`/ccmux:tasks`) triggers when you ask your agent to scaffold, queue, run, resume, or track units of work with the `ccmux task` CLI — for example, "set up a task to add the --dry-run flag and run it", "resume the stopped task", or "run this in a new tmux session". It teaches `create`/`run`/`resume`/`list`/`rm`, target selection (headless `background` vs a live pane vs `send-to-existing`), and the task-vs-invoke-vs-spawn boundary. See [`skills/tasks/SKILL.md`](skills/tasks/SKILL.md).

Both trigger automatically from their descriptions once installed.

## Other agents

The plugin wrapper is Claude Code specific, but the skills themselves are standard [Agent Skills](https://agentskills.io) written harness-agnostically: they need only a shell and the ccmux CLI on `PATH`. To use one from another skills-capable agent (Codex, Cursor, OpenCode, and others), copy the skill directory into that agent's skills location, for example:

```bash
cp -r skills/dispatch ~/.codex/skills/dispatch
cp -r skills/tasks    ~/.codex/skills/tasks
```

Check your agent's Agent Skills documentation for where it discovers skills.
