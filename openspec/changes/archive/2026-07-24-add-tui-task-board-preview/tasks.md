## 1. Store selection

- [x] 1.1 Add a `selectedTask()` memo in `src/tui/store.ts` — the instance whose id is `selectedTaskId`, falling back to the first task in `taskFlatItems` order. Ensure entering the board / tasks arriving leaves `selectedTaskId` on a real row (set it when unset and tasks exist).

## 2. Name-first rows

- [x] 2.1 `TaskRow.tsx`: lead with `taskDisplayName(task)` (in `theme.text`, flexible width); move the short `id.slice(0,8)` to a trailing `theme.overlay` token. Keep status/agent/kind/project + the running live-activity badge.
- [x] 2.2 Update/extend `TaskRow` tests for the name-first layout.

## 3. TaskDetail pane

- [x] 3.1 New `src/tui/components/TaskDetail.tsx` mirroring `GroupPreview` chrome (`width={previewWidth}%`, left border, `useTerminalDimensions` separator): header = display name + status; body = agent, project, target (+ `new-session` session name from `targetRef`/project-derived), worktree, created/updated, linked `sessionId`, failure hint for `failed`; the prompt in a focus-scrollable `scrollbox` (reusing `previewFocused`).
- [x] 3.2 `TaskDetail` tests via `testRender` (pending/stopped/done/failed variants; long-prompt scroll region present; failure hint shown for `failed`).

## 4. Layout + keybinds (`src/tui/App.tsx`)

- [x] 4.1 In the `view === "tasks"` branch, wrap `TaskList` + a `<Show when={!props.sidebar && store.state.showPreview}>` that renders `Preview` (when `selectedTask()` is `running` and `getSessionById(sessionId)` resolves) else `TaskDetail`, passing `previewWidth`/`previewFocused`/`refreshKey` as the session branch does.
- [x] 4.2 Extend the preview keybinds to the task-view key branch: `p` → `togglePreview`, and the preview-focus/scroll keys, gated on `showPreview` exactly as in the session branch.
- [x] 4.3 Pass the preview scrollbox ref through so focus-scroll drives the task pane (`Preview`/`TaskDetail`).

## 5. Verify

- [x] 5.1 `bun run typecheck` and full `bun test` green (incl. new `TaskDetail`/`TaskRow` tests).
- [x] 5.2 Render verification in a detached tmux session (per AGENTS.md): board with a `pending` task → detail card (name-first row, prompt visible); create+run a task so it is `running` and linked → selecting it shows the live pane; toggle preview off with `p` → list goes full width. Capture panes at ~200x50 and at a narrow width.
