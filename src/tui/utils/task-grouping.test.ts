import { describe, it, expect } from "bun:test";
import {
  buildTaskFlatItems,
  taskFlatIndex,
  type TaskFlatItem,
} from "./task-grouping";
import { mockTask } from "../components/test-helpers";

const labels = (items: TaskFlatItem[]) =>
  items.filter((i) => i.type === "header").map((i) => (i as { label: string }).label);
const taskIds = (items: TaskFlatItem[]) =>
  items.filter((i) => i.type === "task").map((i) => (i as { task: { id: string } }).task.id);

describe("buildTaskFlatItems", () => {
  it("groups by status in priority order with headers + counts", () => {
    const items = buildTaskFlatItems(
      [
        mockTask({ id: "d1", status: "done" }),
        mockTask({ id: "r1", status: "running" }),
        mockTask({ id: "s1", status: "stopped" }),
        mockTask({ id: "r2", status: "running" }),
      ],
      "status",
    );
    // running before stopped before done (priority order); pending/failed absent.
    expect(labels(items)).toEqual(["running", "stopped", "done"]);
    const runHeader = items.find(
      (i) => i.type === "header" && i.label === "running",
    ) as Extract<TaskFlatItem, { type: "header" }>;
    expect(runHeader.count).toBe(2);
    // Rows follow their header.
    expect(taskIds(items)).toEqual(["r1", "r2", "s1", "d1"]);
  });

  it("groups by project (basename), alphabetical", () => {
    const items = buildTaskFlatItems(
      [
        mockTask({ id: "a", project: "/x/zebra" }),
        mockTask({ id: "b", project: "/y/apple" }),
      ],
      "project",
    );
    expect(labels(items)).toEqual(["apple", "zebra"]);
  });

  it("none yields bare task rows (no headers)", () => {
    const items = buildTaskFlatItems(
      [mockTask({ id: "a" }), mockTask({ id: "b" })],
      "none",
    );
    expect(labels(items)).toEqual([]);
    expect(taskIds(items)).toEqual(["a", "b"]);
  });
});

describe("taskFlatIndex", () => {
  it("finds a task row's flat index (past headers), or -1", () => {
    const items = buildTaskFlatItems(
      [mockTask({ id: "r1", status: "running" })],
      "status",
    );
    // [header running, task r1] → r1 at index 1
    expect(taskFlatIndex(items, "r1")).toBe(1);
    expect(taskFlatIndex(items, "nope")).toBe(-1);
    expect(taskFlatIndex(items, null)).toBe(-1);
  });
});
