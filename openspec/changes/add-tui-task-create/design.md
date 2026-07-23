## Context

The task board (`add-tui-task-board`) is a read-and-act surface: it lists tasks, resumes stopped ones, jumps to running ones, and deletes. Creation and starting a pending task still require the `ccmux task` CLI. The CLI's `create` resolves a spec through the `resolveTask` cascade (`defaults → projects[project] → templates[template] → input`) and POSTs `/tasks`; `run` POSTs `/tasks/{id}/run`. Both endpoints already exist and are authoritative.

The picker/sidebar is a **local process** (not the daemon): it already receives `columns`/`breakpoints`/etc. from `getPreferences()` at launch and holds the live session list in its store. So the create form can build its field choices locally without any new daemon surface.

Constraints: keep the daemon thin (launch/track-plane principle); reuse existing overlay primitives (`ConfirmationDialog`, `ContextMenu`, `SearchInput`) rather than inventing a new UI framework; do not optimistically mutate the store — the `task_created`/`task_updated` broadcast drives the row, matching the board's existing pattern.

## Goals / Non-Goals

**Goals:**
- Create a task from the board via a single modal form (agent, project, target, target-ref, template, prompt, background, run-now), pre-filled from the cascade.
- Start a `pending` task from the board (Enter / `r`), unifying row-activate semantics across all statuses.
- Source form choices (agents, templates, projects, defaults) from local config; leave `/tasks` and `/tasks/{id}/run` unchanged.

**Non-Goals:**
- Resume-with-prompt (`R`) — deferred to a later phase.
- `-- <argv>` passthrough command in the form — remains CLI-only.
- Worktree creation, editing an existing task, or a project/repo browser. Project is chosen from known values or typed free-text.
- Any new daemon endpoint.

## Decisions

### D1: Single modal form (not a wizard or quick-create)
One overlay with all fields stacked, pre-filled from `resolveTask`, is the fastest path for the power users who live in the board and lets them review everything before submit. **Alternatives:** a stepped wizard (more keystrokes, no at-a-glance review) and a quick-create-plus-advanced split (two code paths for one action). Chosen the single form for reviewability and a single submit path.

### D2: Field-level cycling for enums, text input for prompt/project
Enum-ish fields (agent, target, template) cycle with left/right (or a key) through a known list — no free typing, no validation surface. `prompt` is a text input. `project` is a **hybrid**: cycle through known projects (config `projects` ∪ live-session cwds) but allow free-text entry for a new path. **Alternative:** a dropdown component — heavier than the codebase's existing primitives; cycling matches the board's `b`-to-cycle-grouping idiom.

### D3: target-ref is a live-session sub-picker, shown conditionally
`targetRef` only applies to `split` and `send-to-existing`. The field is hidden for `new-window`/`background`, and when shown it picks from the store's live sessions (label = pane id + agent + project basename) — the value sent is the tmux pane. **Alternative:** free-text pane id (error-prone; the user would have to know `%N`). Reusing the session list the board already has is both safer and free.

### D4: Local config sourcing, POST unchanged
The form imports `getPreferences()` + the built-in agent registry (`src/lib/agents.ts`) and calls `resolveTask` for pre-fill. On submit it POSTs the raw field values to `/tasks` (omitting unset fields so the daemon's cascade still applies), then POSTs `/tasks/{id}/run` when run-now is set. **Rationale:** the daemon's resolver stays the single source of truth; the form's local resolve is only for sensible defaults in the UI. **Alternative:** a `GET /task-defaults` endpoint — rejected as needless daemon surface for data the local process already has.

### D5: `pending` → run folded into activate + `r`
`activateSelectedTask` becomes: `pending` → `POST /run`, `stopped` → resume, `running` (with `sessionId`) → jump. `r` mirrors run/resume for the actionable statuses. This removes the current dead-end where a `pending` row ignores Enter. **Alternative:** a separate `s`/start key — an extra binding for what is conceptually "activate this row."

### D6: No optimistic store mutation
Create/run/`run` results arrive as `task_created`/`task_updated` over SSE, exactly like the existing resume/delete flow. The modal closes on a successful POST; the row appears/updates when the broadcast lands. Keeps one code path for row state and avoids divergence on a failed POST.

## Risks / Trade-offs

- **Stale project/agent lists** → the form reads config at open time (cheap), and live-session cwds come from the reactive store, so both reflect current state each time the modal opens.
- **Create succeeds but run fails (run-now)** → surface a toast; the task still exists as `pending` and is runnable from the board. Do not roll back the create.
- **Empty prompt with no passthrough** → the daemon already rejects this (`validateNewTask`); the form disables submit until prompt is non-empty (or a template supplies one), and surfaces the daemon's error as a toast if it slips through.
- **Modal keybind collisions** → while the modal is open, its own key handler owns all keys (like `searchMode`/`confirmMode`), returning early before the board's key set runs.

## Migration Plan

Purely additive: new keybind + overlay + one extended activate branch. No config migration, no daemon change, no rollback concern. Shipping it changes nothing for users who don't press `c`.

## Open Questions

None — the three shape decisions (single modal, core+template scope, defer resume-prompt) are settled.
