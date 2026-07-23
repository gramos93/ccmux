import { basename } from "path";
import type { TaskInstance, TaskStatus } from "../../lib/task";

/** How the task board groups rows. Cycled with `b` (status → project → none). */
export type TaskGroupBy = "status" | "project" | "none";

export const TASK_GROUP_BY_ORDER: TaskGroupBy[] = ["status", "project", "none"];

/** Flat list of headers + task rows, mirroring the session pane's FlatItem. */
export type TaskFlatItem =
  | { type: "header"; groupKey: string; label: string; count: number }
  | { type: "task"; groupKey: string; task: TaskInstance };

/** Status group order (running/stopped first — the actionable ones). */
const STATUS_ORDER: TaskStatus[] = [
  "running",
  "stopped",
  "pending",
  "done",
  "failed",
];

function groupKeyOf(task: TaskInstance, groupBy: TaskGroupBy): string {
  if (groupBy === "project") return basename(task.project) || task.project;
  return task.status; // "status"
}

/**
 * Build the board's flat items for a grouping. `none` yields bare task rows;
 * otherwise rows are grouped under headers, status groups in a fixed priority
 * order and project groups alphabetically.
 */
export function buildTaskFlatItems(
  tasks: TaskInstance[],
  groupBy: TaskGroupBy,
): TaskFlatItem[] {
  if (groupBy === "none") {
    return tasks.map((task) => ({ type: "task", groupKey: "", task }));
  }

  const groups = new Map<string, TaskInstance[]>();
  for (const task of tasks) {
    const key = groupKeyOf(task, groupBy);
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  }

  const keys =
    groupBy === "status"
      ? STATUS_ORDER.filter((k) => groups.has(k))
      : [...groups.keys()].sort();

  const items: TaskFlatItem[] = [];
  for (const key of keys) {
    const members = groups.get(key)!;
    items.push({
      type: "header",
      groupKey: key,
      label: key,
      count: members.length,
    });
    for (const task of members) items.push({ type: "task", groupKey: key, task });
  }
  return items;
}

/** Flat-item index of a task row by id, or -1. */
export function taskFlatIndex(
  items: TaskFlatItem[],
  taskId: string | null,
): number {
  if (!taskId) return -1;
  return items.findIndex((i) => i.type === "task" && i.task.id === taskId);
}
