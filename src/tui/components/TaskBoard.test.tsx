import { describe, it, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import { TaskBoard } from "./TaskBoard";
import { mockTask } from "./test-helpers";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup;
afterEach(() => setup?.renderer.destroy());

async function render(el: () => JSX.Element): Promise<string> {
  setup = await testRender(el, { width: 80, height: 10 });
  await setup.renderOnce();
  return setup.captureCharFrame();
}

describe("TaskBoard", () => {
  it("renders a row per task", async () => {
    const frame = await render(() => (
      <TaskBoard
        tasks={[mockTask({ id: "aaa11111" }), mockTask({ id: "bbb22222" })]}
        selectedTaskId="aaa11111"
        getSessionById={() => null}
      />
    ));
    expect(frame).toContain("aaa11111");
    expect(frame).toContain("bbb22222");
  });

  it("shows an empty state when there are no tasks", async () => {
    const frame = await render(() => (
      <TaskBoard tasks={[]} selectedTaskId={null} getSessionById={() => null} />
    ));
    expect(frame).toContain("No tasks");
  });
});
