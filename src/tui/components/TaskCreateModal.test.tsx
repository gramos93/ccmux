import { describe, it, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import { TaskCreateModal } from "./TaskCreateModal";
import {
  projectPickerChoices,
  visibleCreateFieldsFor,
  type CreateFormState,
  type CreateOptions,
} from "../utils/task-create";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup;
afterEach(() => setup?.renderer.destroy());

async function render(el: () => JSX.Element): Promise<string> {
  setup = await testRender(el, { width: 90, height: 22 });
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
    runNow: true,
    ...overrides,
  };
}

const OPTIONS: CreateOptions = {
  agents: ["claude", "codex"],
  templates: ["review"],
  projects: ["/Users/test/app", "/Users/test/api"],
  sessions: [
    { pane: "%1", label: "%1 claude app", cwd: "/Users/test/app", project: "app" },
  ],
  templateHasPrompt: { review: true },
};

function props(
  f: CreateFormState,
  valid: boolean,
  pickerOpen = false,
  query = "",
) {
  const visible = visibleCreateFieldsFor(f);
  return {
    form: f,
    options: OPTIONS,
    visibleFields: visible,
    focusedField: pickerOpen ? ("project" as const) : visible[0],
    valid,
    onPromptInput: () => {},
    projectPickerOpen: pickerOpen,
    projectQuery: query,
    projectChoices: projectPickerChoices(OPTIONS.projects, query),
    projectPickerIndex: 0,
    onProjectQueryInput: () => {},
    onProjectPickerSubmit: () => {},
  };
}

describe("TaskCreateModal", () => {
  it("renders the core fields and no separate Background field", async () => {
    const frame = await render(() => <TaskCreateModal {...props(form(), false)} />);
    expect(frame).toContain("New task");
    expect(frame).toContain("Agent");
    expect(frame).toContain("Project");
    expect(frame).toContain("Target");
    expect(frame).toContain("Template");
    expect(frame).toContain("Prompt");
    expect(frame).toContain("Run now");
    expect(frame).not.toContain("Background");
  });

  it("shows a background target as a Target value", async () => {
    const frame = await render(() => (
      <TaskCreateModal {...props(form({ target: "background" }), false)} />
    ));
    expect(frame).toContain("background");
    expect(frame).not.toContain("Pane"); // background hides target-ref
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

  it("shows the picker placeholder when the query is empty", async () => {
    const frame = await render(() => (
      <TaskCreateModal {...props(form(), false, true, "")} />
    ));
    expect(frame).toContain("search projects");
  });

  it("renders the project picker overlay with filtered choices", async () => {
    const frame = await render(() => (
      <TaskCreateModal {...props(form(), false, true, "api")} />
    ));
    // Filtered known project plus the 'use typed path' escape hatch.
    expect(frame).toContain("/Users/test/api");
    expect(frame).toContain('Use "api"');
  });
});
