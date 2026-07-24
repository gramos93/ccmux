import { describe, it, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import { TaskDetail } from "./TaskDetail";
import { mockTask } from "./test-helpers";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup;
afterEach(() => setup?.renderer.destroy());

async function render(el: () => JSX.Element): Promise<string> {
  setup = await testRender(el, { width: 100, height: 24 });
  await setup.renderOnce();
  return setup.captureCharFrame();
}

describe("TaskDetail", () => {
  it("shows the display name, status, agent, project, target, and prompt", async () => {
    const frame = await render(() => (
      <TaskDetail
        task={mockTask({
          name: "Fix login",
          status: "pending",
          agent: "codex",
          project: "/Users/test/Code/myapp",
          target: "new-window",
          prompt: "Investigate the auth middleware",
        })}
        width={50}
      />
    ));
    expect(frame).toContain("Fix login");
    expect(frame).toContain("pending");
    expect(frame).toContain("codex");
    expect(frame).toContain("myapp");
    expect(frame).toContain("new-window");
    expect(frame).toContain("Investigate the auth middleware");
  });

  it("shows the explicit session name for a new-session task", async () => {
    const frame = await render(() => (
      <TaskDetail
        task={mockTask({ target: "new-session", targetRef: "review" })}
        width={50}
      />
    ));
    expect(frame).toContain("review");
  });

  it("shows a failure hint for a failed task", async () => {
    const frame = await render(() => (
      <TaskDetail task={mockTask({ status: "failed" })} width={50} />
    ));
    expect(frame).toContain("failed");
    expect(frame).toContain("error");
  });

  it("derives a name from the prompt when none is set", async () => {
    const frame = await render(() => (
      <TaskDetail
        task={mockTask({ prompt: "Refactor the parser", name: undefined })}
        width={50}
      />
    ));
    expect(frame).toContain("Refactor the parser");
  });
});
