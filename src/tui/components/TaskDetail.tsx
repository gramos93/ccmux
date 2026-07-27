import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import { basename } from "path";
import type { TaskInstance } from "../../lib/task";
import { taskDisplayName } from "../../lib/task";
import { formatRelativeTime, shortenCwd } from "../utils/format";
import { theme } from "../theme";
import { taskStatusColor } from "./TaskRow";

interface TaskDetailProps {
  task: TaskInstance;
  /** Preview width as a percentage of the terminal (shared with the session
   *  view's `previewWidth`). */
  width: number;
  /** When focused, the border highlights and the prompt scrollbox takes keys. */
  focused?: boolean;
  onScrollboxRef?: (ref: ScrollBoxRenderable) => void;
}

/** One `label: value` line; omitted when the value is empty. The label never
 *  shrinks (so its colon isn't clipped); a long value truncates at the edge. */
const Field: Component<{ label: string; value: string; color?: string }> = (
  props,
) => (
  <Show when={props.value.length > 0}>
    <box flexDirection="row" gap={1} height={1}>
      <box flexShrink={0}>
        <text fg={theme.overlay}>{`${props.label}:`}</text>
      </box>
      <box flexShrink={1}>
        <text fg={props.color ?? theme.text}>{props.value}</text>
      </box>
    </box>
  </Show>
);

/**
 * The right-hand detail card for a task with no live pane (pending/stopped/
 * done/failed, or a running task without a linked session). Mirrors
 * `GroupPreview`'s chrome (width%, left border, header + separator) but does
 * no tmux capture — it renders the task's own fields and its prompt in a
 * focus-scrollable region. Running, session-linked tasks use `Preview` instead.
 */
export const TaskDetail: Component<TaskDetailProps> = (props) => {
  const dims = useTerminalDimensions();
  const separatorWidth = createMemo(() =>
    Math.max(1, Math.floor((dims().width * props.width) / 100) - 3),
  );

  const t = () => props.task;

  /** For a new-session task, the session it lands in: the explicit `targetRef`
   *  name, else the project-derived name. */
  const sessionName = () => {
    const task = t();
    if (task.target !== "new-session") return "";
    const ref = task.targetRef?.trim();
    return ref && ref.length > 0 ? ref : `${basename(task.project)} (project)`;
  };

  const worktree = () => {
    const w = t().worktree;
    if (!w) return "";
    if (w === true) return "yes (default)";
    return [w.branch && `branch ${w.branch}`, w.base && `base ${w.base}`]
      .filter(Boolean)
      .join(", ") || "yes";
  };

  return (
    <box
      flexDirection="column"
      width={`${props.width}%`}
      height="100%"
      border={["left"]}
      borderStyle="single"
      borderColor={props.focused ? theme.mauve : theme.border}
      paddingLeft={1}
      paddingRight={1}
    >
      <box height={2} flexDirection="column">
        <box flexDirection="row" gap={1} height={1}>
          <box flexShrink={0}>
            <text fg={taskStatusColor(t().status)}>●</text>
          </box>
          <box flexGrow={1} flexShrink={1}>
            <text fg={theme.text}>
              <b>{taskDisplayName(t())}</b>
            </text>
          </box>
          <box flexShrink={0}>
            <text fg={taskStatusColor(t().status)}>{t().status}</text>
          </box>
        </box>
        <text fg={theme.border}>{"─".repeat(separatorWidth())}</text>
      </box>

      <scrollbox
        flexGrow={1}
        ref={(r: ScrollBoxRenderable) => props.onScrollboxRef?.(r)}
      >
        <box flexDirection="column" paddingTop={1}>
          <Field label="agent" value={t().agent} />
          <Field label="project" value={shortenCwd(t().project)} />
          <Field label="target" value={t().target} />
          <Field label="session" value={sessionName()} />
          <Field label="worktree" value={worktree()} />
          <Field
            label="created"
            value={t().createdAt ? formatRelativeTime(new Date(t().createdAt)) : ""}
          />
          <Field
            label="updated"
            value={t().updatedAt ? formatRelativeTime(new Date(t().updatedAt)) : ""}
          />
          <Field label="session id" value={t().sessionId ?? ""} />
          <Show when={t().status === "failed"}>
            <Field
              label="error"
              value="task failed — see its pane/log"
              color={theme.red}
            />
          </Show>
          <box height={1} />
          <text fg={theme.overlay}>prompt</text>
          <text fg={theme.text}>{t().prompt || "(no prompt)"}</text>
        </box>
      </scrollbox>
    </box>
  );
};
