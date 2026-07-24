import type { Component } from "solid-js";
import { Show } from "solid-js";
import { basename } from "path";
import type { EnrichedSession } from "../../types";
import { taskDisplayName, type TaskInstance, type TaskStatus } from "../../lib/task";
import type { IconStyle } from "../../lib/icons";
import { theme } from "../theme";
import { agentColorFor } from "./SessionItem";
import { StatusBadge } from "./StatusBadge";

/** Task lifecycle status → color. Shaped like `getStatusColor`, but keyed by
 *  `TaskStatus` (not `SessionStatus`). A function so it reads the live theme. */
export function taskStatusColor(status: TaskStatus): string {
  switch (status) {
    case "running":
      return theme.peach;
    case "stopped":
      return theme.yellow;
    case "done":
      return theme.green;
    case "failed":
      return theme.red;
    case "pending":
    default:
      return theme.overlay;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** bg = headless invoke; pane = an interactive tmux pane target. */
export function taskKindLabel(task: { target: string }): string {
  return task.target === "background" ? "bg" : "pane";
}

export interface TaskRowProps {
  task: TaskInstance;
  selected: boolean;
  /** The live session joined by `task.sessionId`; shown as live activity for a
   *  running task. Null when unlinked or not running. */
  liveSession?: EnrichedSession | null;
  iconStyle?: IconStyle;
}

export const TaskRow: Component<TaskRowProps> = (props) => {
  const bg = () => (props.selected ? theme.surface : undefined);
  return (
    <box flexDirection="row" backgroundColor={bg()}>
      <text fg={taskStatusColor(props.task.status)}>
        {`● ${props.task.status.padEnd(8)}`}
      </text>
      <box flexGrow={1} flexShrink={1}>
        <text fg={theme.text}>{taskDisplayName(props.task)}</text>
      </box>
      <text fg={agentColorFor(props.task.agent)}>
        {`  ${props.task.agent.padEnd(9)}`}
      </text>
      <text
        fg={props.task.target === "background" ? theme.mauve : theme.overlay}
      >
        {taskKindLabel(props.task).padEnd(5)}
      </text>
      <text fg={theme.subtext}>{`${basename(props.task.project)}  `}</text>
      <Show when={props.task.status === "running" ? props.liveSession : null}>
        {(session: () => EnrichedSession) => (
          <StatusBadge
            status={session().status}
            session={session()}
            mode="short"
            iconStyle={props.iconStyle}
          />
        )}
      </Show>
      <text fg={theme.overlay}>{`  ${shortId(props.task.id)}`}</text>
    </box>
  );
};
