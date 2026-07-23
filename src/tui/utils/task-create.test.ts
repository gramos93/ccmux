import { describe, it, expect } from "bun:test";
import {
  buildCreateBody,
  buildCreateOptions,
  cycleOptionsFor,
  resolveTaskActivation,
  visibleCreateFieldsFor,
  type CreateFormState,
  type CreateOptions,
} from "./task-create";
import { mockEnrichedSession, mockTask } from "../components/test-helpers";

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
  templates: ["review", "fix"],
  projects: ["/a", "/b"],
  sessions: [
    { pane: "%1", label: "%1 claude app" },
    { pane: "%2", label: "%2 codex api" },
  ],
  templateHasPrompt: { review: true, fix: false },
};

describe("buildCreateOptions", () => {
  it("merges built-in agents, config, and live-session cwds (de-duped)", () => {
    const sessions = [
      mockEnrichedSession({ id: "s1", cwd: "/Users/test/app", tmuxPane: "%1" }),
      mockEnrichedSession({ id: "s2", cwd: "/Users/test/app", tmuxPane: "%2" }),
      mockEnrichedSession({ id: "s3", cwd: "/Users/test/api", tmuxPane: "%3" }),
    ];
    const opts = buildCreateOptions(sessions, "/Users/test/app");
    // Built-in registry always includes claude.
    expect(opts.agents).toContain("claude");
    // Default project first, api present once, app not duplicated.
    expect(opts.projects[0]).toBe("/Users/test/app");
    expect(opts.projects.filter((p) => p === "/Users/test/app")).toHaveLength(1);
    expect(opts.projects).toContain("/Users/test/api");
    // Only paned sessions become target-ref choices, labelled by basename.
    expect(opts.sessions).toHaveLength(3);
    expect(opts.sessions[0].label).toContain("app");
  });
});

describe("buildCreateBody", () => {
  it("omits unset fields and keeps the target", () => {
    const body = buildCreateBody(form({ prompt: "do it", agent: "claude" }));
    expect(body).toEqual({
      project: "/Users/test/app",
      target: "new-window",
      agent: "claude",
      prompt: "do it",
    });
    expect("targetRef" in body).toBe(false);
    expect("template" in body).toBe(false);
  });

  it("collapses the background toggle into target=background", () => {
    const body = buildCreateBody(form({ background: true, prompt: "x" }));
    expect(body.target).toBe("background");
  });

  it("includes target-ref only for split/send-to-existing", () => {
    expect(
      buildCreateBody(form({ target: "split", targetRef: "%1", prompt: "x" }))
        .targetRef,
    ).toBe("%1");
    // new-window ignores a stray targetRef.
    expect(
      "targetRef" in
        buildCreateBody(form({ target: "new-window", targetRef: "%1" })),
    ).toBe(false);
  });

  it("drops an empty/whitespace prompt", () => {
    expect("prompt" in buildCreateBody(form({ prompt: "   " }))).toBe(false);
  });
});

describe("resolveTaskActivation", () => {
  it("runs a pending task", () => {
    expect(resolveTaskActivation(mockTask({ id: "t1", status: "pending" }))).toEqual(
      { kind: "run", id: "t1" },
    );
  });
  it("resumes a stopped task", () => {
    expect(resolveTaskActivation(mockTask({ id: "t2", status: "stopped" }))).toEqual(
      { kind: "resume", id: "t2" },
    );
  });
  it("jumps to a running task's session", () => {
    expect(
      resolveTaskActivation(
        mockTask({ status: "running", sessionId: "sess-9" }),
      ),
    ).toEqual({ kind: "jump", sessionId: "sess-9" });
  });
  it("is a no-op for a running task with no session, and for done/failed", () => {
    expect(resolveTaskActivation(mockTask({ status: "running" })).kind).toBe(
      "none",
    );
    expect(resolveTaskActivation(mockTask({ status: "done" })).kind).toBe("none");
    expect(resolveTaskActivation(mockTask({ status: "failed" })).kind).toBe(
      "none",
    );
  });
});

describe("visibleCreateFieldsFor", () => {
  it("hides target-ref except for split/send-to-existing", () => {
    expect(visibleCreateFieldsFor(form())).not.toContain("targetRef");
    expect(visibleCreateFieldsFor(form({ target: "split" }))).toContain(
      "targetRef",
    );
    expect(
      visibleCreateFieldsFor(form({ target: "send-to-existing" })),
    ).toContain("targetRef");
  });
  it("hides target-ref in background mode even for split", () => {
    expect(
      visibleCreateFieldsFor(form({ target: "split", background: true })),
    ).not.toContain("targetRef");
  });
});

describe("cycleOptionsFor", () => {
  it("prepends an empty (none) choice for template", () => {
    expect(cycleOptionsFor("template", OPTIONS)).toEqual(["", "review", "fix"]);
  });
  it("returns the pane list for target-ref and empty for prompt", () => {
    expect(cycleOptionsFor("targetRef", OPTIONS)).toEqual(["%1", "%2"]);
    expect(cycleOptionsFor("prompt", OPTIONS)).toEqual([]);
  });
});
