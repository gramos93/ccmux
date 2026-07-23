import { describe, it, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import { TaskRow, taskStatusColor, taskKindLabel } from "./TaskRow";
import { theme } from "../theme";
import { mockTask, mockEnrichedSession } from "./test-helpers";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup;
afterEach(() => setup?.renderer.destroy());

async function render(el: () => JSX.Element): Promise<string> {
  setup = await testRender(el, { width: 80, height: 3 });
  await setup.renderOnce();
  return setup.captureCharFrame();
}

describe("taskStatusColor", () => {
  it("maps each status to a distinct color", () => {
    expect(taskStatusColor("running")).toBe(theme.peach);
    expect(taskStatusColor("stopped")).toBe(theme.yellow);
    expect(taskStatusColor("done")).toBe(theme.green);
    expect(taskStatusColor("failed")).toBe(theme.red);
    expect(taskStatusColor("pending")).toBe(theme.overlay);
  });
});

describe("taskKindLabel", () => {
  it("distinguishes background from pane tasks", () => {
    expect(taskKindLabel({ target: "background" })).toBe("bg");
    expect(taskKindLabel({ target: "new-window" })).toBe("pane");
    expect(taskKindLabel({ target: "split" })).toBe("pane");
  });
});

describe("TaskRow", () => {
  it("renders short id, status, agent, and project basename", async () => {
    const frame = await render(() => (
      <TaskRow
        task={mockTask({
          id: "abcdef12-rest",
          agent: "claude",
          project: "/Users/test/Code/myapp",
          status: "stopped",
        })}
        selected={false}
      />
    ));
    expect(frame).toContain("abcdef12"); // 8-char short id
    expect(frame).toContain("stopped");
    expect(frame).toContain("claude");
    expect(frame).toContain("myapp"); // basename of project
  });

  it("shows the joined session's live activity for a running task", async () => {
    const frame = await render(() => (
      <TaskRow
        task={mockTask({ status: "running" })}
        selected={false}
        liveSession={mockEnrichedSession({ status: "working" })}
      />
    ));
    expect(frame).toContain("work"); // StatusBadge short mode → "work"(ing)
  });

  it("omits live activity when the running task is unlinked", async () => {
    const frame = await render(() => (
      <TaskRow
        task={mockTask({ status: "running" })}
        selected={false}
        liveSession={null}
      />
    ));
    expect(frame).toContain("running"); // the task's own status still shows
    expect(frame).not.toContain("work"); // but no borrowed activity
  });
});
