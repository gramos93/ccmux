import { describe, it, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import { TaskCreateModal } from "./TaskCreateModal";
import {
  visibleCreateFieldsFor,
  type CreateFormState,
  type CreateOptions,
} from "../utils/task-create";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup;
afterEach(() => setup?.renderer.destroy());

async function render(el: () => JSX.Element): Promise<string> {
  setup = await testRender(el, { width: 80, height: 20 });
  await setup.renderOnce();
  return setup.captureCharFrame();
}

function form(overrides: Partial<CreateFormState> = {}): CreateFormState {
  return {
    agent: "claude",
    project: "/Users/test/app",
    target: "new-window",
    targetRef: "",
    template: "",
    prompt: "",
    background: false,
    runNow: true,
    ...overrides,
  };
}

const OPTIONS: CreateOptions = {
  agents: ["claude", "codex"],
  templates: ["review"],
  projects: ["/Users/test/app"],
  sessions: [{ pane: "%1", label: "%1 claude app" }],
  templateHasPrompt: { review: true },
};

function props(f: CreateFormState, valid: boolean) {
  const visible = visibleCreateFieldsFor(f);
  return {
    form: f,
    options: OPTIONS,
    visibleFields: visible,
    focusedField: visible[0],
    valid,
    onPromptInput: () => {},
  };
}

describe("TaskCreateModal", () => {
  it("renders the core fields", async () => {
    const frame = await render(() => <TaskCreateModal {...props(form(), false)} />);
    expect(frame).toContain("New task");
    expect(frame).toContain("Agent");
    expect(frame).toContain("Project");
    expect(frame).toContain("Target");
    expect(frame).toContain("Template");
    expect(frame).toContain("Prompt");
    expect(frame).toContain("Background");
    expect(frame).toContain("Run now");
  });

  it("shows target-ref only for split/send-to-existing", async () => {
    const windowFrame = await render(() => (
      <TaskCreateModal {...props(form({ target: "new-window" }), false)} />
    ));
    expect(windowFrame).not.toContain("Pane");
    setup.renderer.destroy();

    const splitFrame = await render(() => (
      <TaskCreateModal {...props(form({ target: "split" }), false)} />
    ));
    expect(splitFrame).toContain("Pane");
  });

  it("shows the required hint when invalid and the create hint when valid", async () => {
    const invalid = await render(() => (
      <TaskCreateModal {...props(form(), false)} />
    ));
    expect(invalid).toContain("prompt required");
    setup.renderer.destroy();

    const valid = await render(() => (
      <TaskCreateModal {...props(form({ prompt: "go" }), true)} />
    ));
    expect(valid).toContain("enter create");
  });
});
