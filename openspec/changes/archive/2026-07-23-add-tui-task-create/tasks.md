## 1. Run-pending (smallest, unblocks the activate rule)

- [x] 1.1 Extend `activateSelectedTask` in `src/tui/App.tsx`: add the `pending` → `POST /tasks/{id}/run` branch (keep `stopped` → resume, `running` → jump); fire-and-forget, no optimistic mutation
- [x] 1.2 Make the task-view `r` key run a `pending` task and resume a `stopped` one (no-op otherwise); factor a shared `runOrResumeSelectedTask` helper
- [x] 1.3 Test (store/App-level): activating a `pending` row POSTs the run endpoint; `running`/`stopped`/`done` behavior unchanged

## 2. Create-modal state in the store

- [x] 2.1 Add create-modal state to `src/tui/store.ts`: `createModalOpen` plus a `createForm` field object (agent, project, target, targetRef, template, prompt, background, runNow) and a `createFocusIndex`
- [x] 2.2 Add actions: `openCreateModal(prefill)`, `closeCreateModal`, `setCreateField(key, value)`, `moveCreateFocus(delta)`, `cycleCreateField(key, dir)` (enum fields), plus a `createFormValid()` memo (prompt non-empty OR template supplies a prompt)
- [x] 2.3 Test: open seeds fields from prefill, cycle wraps within the option list, `createFormValid()` gates on prompt/template, close resets

## 3. Local config sourcing + pre-fill

- [x] 3.1 Add a TUI helper (e.g. `src/tui/utils/task-create.ts`) that reads `getPreferences()` + the built-in agent registry and returns option lists: agents, templates, project candidates (config `projects` ∪ distinct live-session cwds)
- [x] 3.2 Compute the pre-fill via `resolveTask` (from `src/lib/task.ts`) for the chosen project/template so the modal opens with the same defaults the daemon would resolve
- [x] 3.3 Test: option lists merge config + built-ins + live cwds and de-dupe; pre-fill matches `resolveTask` output for a sample config

## 4. Create modal component

- [x] 4.1 Add `src/tui/components/TaskCreateModal.tsx`: stacked field rows (agent/target/template cycle; project hybrid cycle+text; prompt text input reusing the `SearchInput` primitive), a background and run-now toggle, and a footer hint (`enter create · esc cancel`)
- [x] 4.2 Show the target-ref row only when target is `split`/`send-to-existing`; render it as a picker over the store's live sessions (label = pane + agent + project basename; value = tmux pane)
- [x] 4.3 Disable/deny submit when `createFormValid()` is false
- [x] 4.4 Component test with `testRender`: renders all fields; target-ref appears only for split/send-to-existing; invalid (empty prompt) shows the blocked-submit state

## 5. Wire the modal into App + keys

- [x] 5.1 Bind `c` in the task view (and, if desired, from the session view) to `openCreateModal(prefill)`; render `<TaskCreateModal>` under a `<Show when={store.state.createModalOpen}>`
- [x] 5.2 Add a modal key handler that owns all keys while open (mirroring `searchMode`/`confirmMode`): focus nav, field cycle, text entry, submit, cancel — returning before the board key set runs
- [x] 5.3 On submit: POST entered fields to `/tasks` (omit unset so the daemon cascade applies); on success close the modal and, if run-now, POST `/tasks/{id}/run`; surface failures via toast; rely on `task_created`/`task_updated` broadcasts for the row
- [x] 5.4 Test: submit posts the expected body (unset fields omitted), run-now triggers the follow-up run, a failed create keeps the modal/ surfaces a toast

## 6. Footer / help + verification

- [x] 6.1 Update `src/tui/components/Footer.tsx` task-view line to advertise `c create` (and that enter runs a pending task); update `HelpOverlay.tsx` if it lists task-view keys
- [x] 6.2 `bun run typecheck` + `bun test` green
- [x] 6.3 Live-verify per AGENTS.md: detached tmux, `ccmux picker`, `t` to the board, `c` to open the modal, create a real task (run-now) and confirm the row appears/runs; capture-pane the modal and the resulting row
