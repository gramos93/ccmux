import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import type { EnrichedSession } from "../../types";
import type { TaskInstance } from "../../lib/task";
import type { IconStyle } from "../../lib/icons";
import { theme } from "../theme";
import { TaskRow } from "./TaskRow";

export interface TaskBoardProps {
  tasks: TaskInstance[];
  selectedTaskId: string | null;
  /** Resolve a ccmux session by id for the running-task live-activity join. */
  getSessionById: (id: string) => EnrichedSession | null;
  iconStyle?: IconStyle;
}

/**
 * Flat task list. Rows show status/agent/project and — for running tasks — the
 * linked session's live activity. Actions (resume/delete) are driven from the
 * App keyboard handler against the selected row. Deliberately not a kanban.
 */
export const TaskBoard: Component<TaskBoardProps> = (props) => {
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={props.tasks.length > 0}
        fallback={
          <text fg={theme.overlay}>
            No tasks. Create one with `ccmux task create`.
          </text>
        }
      >
        <For each={props.tasks}>
          {(task) => (
            <TaskRow
              task={task}
              selected={task.id === props.selectedTaskId}
              liveSession={
                task.sessionId ? props.getSessionById(task.sessionId) : null
              }
              iconStyle={props.iconStyle}
            />
          )}
        </For>
      </Show>
    </box>
  );
};
