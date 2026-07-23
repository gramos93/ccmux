import { describe, it, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import { TaskList } from "./TaskList";
import { buildTaskFlatItems } from "../utils/task-grouping";
import { mockTask } from "./test-helpers";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup;
afterEach(() => setup?.renderer.destroy());

async function render(el: () => JSX.Element): Promise<string> {
  setup = await testRender(el, { width: 80, height: 12 });
  await setup.renderOnce();
  return setup.captureCharFrame();
}

describe("TaskList", () => {
  it("renders status group headers and their task rows", async () => {
    const items = buildTaskFlatItems(
      [
        mockTask({ id: "run11111", status: "running" }),
        mockTask({ id: "stop2222", status: "stopped" }),
      ],
      "status",
    );
    const frame = await render(() => (
      <TaskList
        items={items}
        selectedIndex={1}
        selectedTaskId="run11111"
        getSessionById={() => null}
      />
    ));
    expect(frame).toContain("running"); // header
    expect(frame).toContain("stopped"); // header
    expect(frame).toContain("run11111"); // row
    expect(frame).toContain("stop2222"); // row
  });

  it("shows a kind indicator (bg vs pane)", async () => {
    const items = buildTaskFlatItems(
      [
        mockTask({ id: "bgtask11", status: "running", target: "background" }),
        mockTask({ id: "pntask11", status: "running", target: "new-window" }),
      ],
      "none",
    );
    const frame = await render(() => (
      <TaskList
        items={items}
        selectedIndex={0}
        selectedTaskId={null}
        getSessionById={() => null}
      />
    ));
    expect(frame).toContain("bg");
    expect(frame).toContain("pane");
  });

  it("shows an empty state with no tasks", async () => {
    const frame = await render(() => (
      <TaskList
        items={[]}
        selectedIndex={-1}
        selectedTaskId={null}
        getSessionById={() => null}
      />
    ));
    expect(frame).toContain("No tasks");
  });
});
