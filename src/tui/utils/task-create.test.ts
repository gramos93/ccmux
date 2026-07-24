import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCreateBody,
  buildCreateOptions,
  buildEditBody,
  cycleOptionsFor,
  formFromTask,
  projectPickerChoices,
  resolveTaskActivation,
  scanProjectRoots,
  sessionMatchesProject,
  sessionsForProject,
  visibleCreateFieldsFor,
  type CreateFormState,
  type CreateOptions,
} from "./task-create";
import { mockEnrichedSession, mockTask } from "../components/test-helpers";

function form(overrides: Partial<CreateFormState> = {}): CreateFormState {
  return {
    name: "",
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
  templates: ["review", "fix"],
  projects: ["/a", "/b"],
  sessions: [
    { pane: "%1", label: "%1 claude app", cwd: "/Users/test/app", project: "app" },
    { pane: "%2", label: "%2 codex api", cwd: "/Users/test/api", project: "api" },
  ],
  templateHasPrompt: { review: true, fix: false },
};

describe("buildCreateOptions", () => {
  it("merges built-in agents, config, task projects, and live cwds (de-duped)", () => {
    const sessions = [
      mockEnrichedSession({ id: "s1", cwd: "/Users/test/app", tmuxPane: "%1" }),
      mockEnrichedSession({ id: "s2", cwd: "/Users/test/app", tmuxPane: "%2" }),
      mockEnrichedSession({ id: "s3", cwd: "/Users/test/api", tmuxPane: "%3" }),
    ];
    const opts = buildCreateOptions(sessions, "/Users/test/app", [
      "/Users/test/legacy",
    ]);
    expect(opts.agents).toContain("claude");
    // Default project first, task project present, app not duplicated.
    expect(opts.projects[0]).toBe("/Users/test/app");
    expect(opts.projects.filter((p) => p === "/Users/test/app")).toHaveLength(1);
    expect(opts.projects).toContain("/Users/test/legacy");
    expect(opts.projects).toContain("/Users/test/api");
    // Sessions carry cwd/project for filtering.
    expect(opts.sessions).toHaveLength(3);
    expect(opts.sessions[0].cwd).toBe("/Users/test/app");
  });
});

describe("scanProjectRoots", () => {
  it("lists immediate subdirs, skipping files and hidden dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "ccmux-root-"));
    mkdirSync(join(root, "app"));
    mkdirSync(join(root, "api"));
    mkdirSync(join(root, ".hidden"));
    writeFileSync(join(root, "README.md"), "x");
    const found = scanProjectRoots(root);
    expect(found.sort()).toEqual([join(root, "api"), join(root, "app")]);
  });

  it("returns [] for undefined or a missing root, and merges multiple roots", () => {
    expect(scanProjectRoots(undefined)).toEqual([]);
    expect(scanProjectRoots("/no/such/dir/ccmux-x")).toEqual([]);
    const a = mkdtempSync(join(tmpdir(), "ccmux-a-"));
    const b = mkdtempSync(join(tmpdir(), "ccmux-b-"));
    mkdirSync(join(a, "one"));
    mkdirSync(join(b, "two"));
    const found = scanProjectRoots([a, b, "/missing/ccmux-y"]);
    expect(found).toContain(join(a, "one"));
    expect(found).toContain(join(b, "two"));
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

  it("passes a background target straight through", () => {
    const body = buildCreateBody(form({ target: "background", prompt: "x" }));
    expect(body.target).toBe("background");
    expect("targetRef" in body).toBe(false);
  });

  it("passes a new-session target without a target-ref", () => {
    const body = buildCreateBody(
      form({ target: "new-session", targetRef: "%1", prompt: "x" }),
    );
    expect(body.target).toBe("new-session");
    expect("targetRef" in body).toBe(false);
  });

  it("includes target-ref only for split/send-to-existing", () => {
    expect(
      buildCreateBody(form({ target: "split", targetRef: "%1", prompt: "x" }))
        .targetRef,
    ).toBe("%1");
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
  it("has no separate background field and hides target-ref by default", () => {
    const fields = visibleCreateFieldsFor(form());
    expect(fields).not.toContain("background");
    expect(fields).not.toContain("targetRef");
  });
  it("shows target-ref for split/send-to-existing", () => {
    expect(visibleCreateFieldsFor(form({ target: "split" }))).toContain(
      "targetRef",
    );
    expect(
      visibleCreateFieldsFor(form({ target: "send-to-existing" })),
    ).toContain("targetRef");
  });
  it("hides target-ref for background and new-session targets", () => {
    expect(visibleCreateFieldsFor(form({ target: "background" }))).not.toContain(
      "targetRef",
    );
    expect(
      visibleCreateFieldsFor(form({ target: "new-session" })),
    ).not.toContain("targetRef");
  });
});

describe("session/project filtering", () => {
  it("matches a session by cwd or derived project name", () => {
    expect(sessionMatchesProject(OPTIONS.sessions[0], "/Users/test/app")).toBe(
      true,
    );
    // Basename match against the project name.
    expect(sessionMatchesProject(OPTIONS.sessions[1], "/somewhere/api")).toBe(
      true,
    );
    expect(sessionMatchesProject(OPTIONS.sessions[0], "/Users/test/api")).toBe(
      false,
    );
  });
  it("sessionsForProject returns only the project's panes", () => {
    const panes = sessionsForProject(OPTIONS, "/Users/test/app").map(
      (s) => s.pane,
    );
    expect(panes).toEqual(["%1"]);
  });
});

describe("cycleOptionsFor", () => {
  it("cycles target through every placement incl. background and new-session", () => {
    expect(cycleOptionsFor("target", OPTIONS)).toEqual([
      "new-window",
      "split",
      "send-to-existing",
      "background",
      "new-session",
    ]);
  });
  it("prepends an empty (none) choice for template", () => {
    expect(cycleOptionsFor("template", OPTIONS)).toEqual(["", "review", "fix"]);
  });
  it("filters target-ref panes to the given project", () => {
    expect(cycleOptionsFor("targetRef", OPTIONS, "/Users/test/app")).toEqual([
      "%1",
    ]);
    expect(cycleOptionsFor("prompt", OPTIONS)).toEqual([]);
  });
});

describe("projectPickerChoices", () => {
  const projects = ["/Users/test/app", "/Users/test/api", "/work/thing"];
  it("returns all known projects for an empty query", () => {
    expect(projectPickerChoices(projects, "").map((c) => c.value)).toEqual(
      projects,
    );
  });
  it("filters by case-insensitive substring", () => {
    const values = projectPickerChoices(projects, "AP").map((c) => c.value);
    // Both known matches lead; a 'use typed path' hatch trails (query != exact).
    expect(values.slice(0, 2)).toEqual(["/Users/test/app", "/Users/test/api"]);
    expect(values[values.length - 1]).toBe("AP");
  });
  it("appends a 'use typed path' choice for a novel query", () => {
    const choices = projectPickerChoices(projects, "/brand/new");
    const last = choices[choices.length - 1];
    expect(last.value).toBe("/brand/new");
    expect(last.name).toContain("Use");
  });
  it("does not duplicate an exact known project as a typed path", () => {
    const choices = projectPickerChoices(projects, "/work/thing");
    expect(choices.filter((c) => c.value === "/work/thing")).toHaveLength(1);
  });
});

describe("name field + edit/clone helpers", () => {
  const OPTS: CreateOptions = {
    agents: ["claude", "codex"],
    templates: [],
    projects: ["/a/app"],
    sessions: [],
    templateHasPrompt: {},
  };

  it("buildCreateBody includes name only when non-blank", () => {
    expect(buildCreateBody(form({ name: "" })).name).toBeUndefined();
    expect(buildCreateBody(form({ name: "  Fix bug  " })).name).toBe("Fix bug");
  });

  it("buildEditBody sends the editable subset (name/prompt/agent/project/target)", () => {
    const body = buildEditBody(
      form({ name: "N", prompt: "P", agent: "codex", project: "/a/app", target: "new-window" }),
    );
    expect(body).toMatchObject({
      name: "N",
      prompt: "P",
      agent: "codex",
      project: "/a/app",
      target: "new-window",
    });
    expect("targetRef" in body).toBe(false); // new-window doesn't use it
  });

  it("buildEditBody includes targetRef for a pane placement", () => {
    const body = buildEditBody(form({ target: "split", targetRef: "%2" }));
    expect(body.targetRef).toBe("%2");
  });

  it("formFromTask pre-fills spec fields and defaults run-now off", () => {
    const f = formFromTask(
      {
        name: "Clone me",
        prompt: "do it",
        agent: "codex",
        project: "/a/app",
        target: "new-session",
        targetRef: "review",
      },
      OPTS,
    );
    expect(f).toMatchObject({
      name: "Clone me",
      prompt: "do it",
      agent: "codex",
      project: "/a/app",
      target: "new-session",
      targetRef: "review",
      runNow: false,
    });
  });

  it("visibleCreateFieldsFor leads with name and hides run-now when editing", () => {
    const fields = visibleCreateFieldsFor(form(), { editing: false });
    expect(fields[0]).toBe("name");
    expect(fields).toContain("runNow");
    expect(visibleCreateFieldsFor(form(), { editing: true })).not.toContain("runNow");
  });
});
