## 1. Author the skill

- [x] 1.1 Write `plugins/ccmux/skills/tasks/SKILL.md`: frontmatter (`name: tasks`, trigger-rich `description` — scaffold/queue a task, run/resume, track state, send follow-ups) + body covering the task model (id/derived-name/status lifecycle), target selection (`background` headless vs `new-window`/`split`/`new-session` panes vs `send-to-existing`), the verbs (`create` incl. `--run`/`--bg`/`--template`/`--target`/`--target-ref`/`--` passthrough, `run`, `resume --prompt`, `list --stopped`, `rm`; id-prefix addressing), tracking/reading state, and the task-vs-invoke-vs-spawn boundary (cross-link `dispatch`).
- [x] 1.2 Write `plugins/ccmux/skills/tasks/references/examples.md`: end-to-end flows — a headless `--bg` backlog task, a live-pane task (`--target new-window --run`), a `send-to-existing` follow-up, and a `resume <ref> --prompt`.
- [x] 1.3 Verify every flag/verb against `ccmux task --help` (and subcommand help); note the no-`--name` caveat and id-prefix addressing; tell the agent to run `--help` when unsure.

## 2. Mirror + metadata

- [x] 2.1 Copy the skill to `.claude/skills/tasks/` byte-identical (SKILL.md + references), matching the `dispatch` mirror.
- [x] 2.2 Broaden the `description` in `plugins/ccmux/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` to mention driving ccmux tasks (create/run/resume/track), not just `invoke`.
- [x] 2.3 Add a `tasks` skill section to `plugins/ccmux/README.md` (install line, trigger summary, `/ccmux:tasks`), alongside `dispatch`.

## 3. Verify

- [x] 3.1 Frontmatter parses (valid YAML; `name` + `description` present) for both the plugin and mirrored copies; `diff -q` confirms the mirror is identical.
- [x] 3.2 Sanity-check the documented commands actually run: `ccmux task create --help`, a real `ccmux task create --bg --prompt ...` + `ccmux task list` + `ccmux task rm <prefix>` round-trip (clean up the throwaway task afterward).
- [x] 3.3 `bun run typecheck` (no code changed, but confirm nothing broke) — docs-only change, so no test suite impact expected.
