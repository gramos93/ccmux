import type { Component } from "solid-js";
import { createEffect, For, Show } from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { EnrichedSession } from "../../types";
import type { IconStyle } from "../../lib/icons";
import type { TaskFlatItem } from "../utils/task-grouping";
import { theme } from "../theme";
import { TaskRow } from "./TaskRow";

interface TaskListProps {
  items: TaskFlatItem[];
  /** Flat-item index of the selected task row (for scroll-into-view). */
  selectedIndex: number;
  selectedTaskId: string | null;
  getSessionById: (id: string) => EnrichedSession | null;
  iconStyle?: IconStyle;
}

/**
 * The task board list: group headers + task rows in a scrollbox, mirroring
 * `SessionList` (parallel implementation per the design). Rows are a uniform
 * one line, so scroll-into-view is a simple index clamp against the viewport.
 */
export const TaskList: Component<TaskListProps> = (props) => {
  let scrollboxRef: ScrollBoxRenderable | undefined;

  createEffect(() => {
    const index = props.selectedIndex;
    if (!scrollboxRef || index < 0) return;
    const viewport = scrollboxRef.viewport?.height ?? 0;
    if (viewport <= 0) return;
    const top = scrollboxRef.scrollTop;
    if (index < top) scrollboxRef.scrollTo(index);
    else if (index >= top + viewport) scrollboxRef.scrollTo(index - viewport + 1);
  });

  return (
    <box flexGrow={1} flexDirection="column">
      <Show
        when={props.items.length > 0}
        fallback={
          <text fg={theme.overlay}>
            {"  No tasks. Create one with `ccmux task create`."}
          </text>
        }
      >
        <scrollbox
          ref={(r: ScrollBoxRenderable) => {
            scrollboxRef = r;
          }}
          flexGrow={1}
        >
          <For each={props.items}>
            {(item) => (
              <Show
                when={item.type === "header" ? item : null}
                fallback={
                  <Show when={item.type === "task" ? item : null}>
                    {(row: () => Extract<TaskFlatItem, { type: "task" }>) => (
                      <box paddingLeft={1} paddingRight={1}>
                        <TaskRow
                          task={row().task}
                          selected={row().task.id === props.selectedTaskId}
                          liveSession={
                            row().task.sessionId
                              ? props.getSessionById(row().task.sessionId!)
                              : null
                          }
                          iconStyle={props.iconStyle}
                        />
                      </box>
                    )}
                  </Show>
                }
              >
                {(header: () => Extract<TaskFlatItem, { type: "header" }>) => (
                  <box paddingLeft={1} paddingRight={1}>
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.overlay}>▼</text>
                      <text fg={theme.text}>{header().label}</text>
                      <text fg={theme.subtext}>({header().count})</text>
                    </box>
                  </box>
                )}
              </Show>
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
};
