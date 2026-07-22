import { describe, expect, it } from "bun:test";
import { resolveTask, validateNewTask, type TaskSpec } from "./task";

describe("resolveTask (default cascade)", () => {
  it("creation input wins over global defaults", () => {
    const resolved = resolveTask(
      { defaults: { agent: "claude" } },
      { project: "p", input: { agent: "codex" } },
    );
    expect(resolved.agent).toBe("codex");
  });

  it("project override beats global default", () => {
    const resolved = resolveTask(
      { defaults: { worktree: false }, projects: { myrepo: { worktree: true } } },
      { project: "myrepo" },
    );
    expect(resolved.worktree).toBe(true);
  });

  it("template fills gaps left by defaults/project/input", () => {
    const resolved = resolveTask(
      { templates: { rev: { target: "split" } } },
      { project: "p", template: "rev" },
    );
    expect(resolved.target).toBe("split");
  });

  it("no config succeeds with the built-in target default", () => {
    const resolved = resolveTask(
      {},
      { project: "p", input: { agent: "claude", prompt: "hi" } },
    );
    expect(resolved.project).toBe("p");
    expect(resolved.agent).toBe("claude");
    expect(resolved.prompt).toBe("hi");
    expect(resolved.target).toBe("new-window");
  });

  it("layers later than a set field do not clobber with undefined", () => {
    const resolved = resolveTask(
      { defaults: { agent: "claude" } },
      { project: "p", input: { prompt: "go" } },
    );
    expect(resolved.agent).toBe("claude");
  });

  it("resolves with a config carrying no task keys (§6.3)", () => {
    // A Preferences object with none of templates/projects/defaults set — the
    // shape of an existing ccmux.json — still resolves a task.
    const resolved = resolveTask(
      {},
      { project: "p", input: { agent: "claude", prompt: "hi" } },
    );
    expect(resolved.target).toBe("new-window");
  });
});

describe("validateNewTask", () => {
  const base: Partial<TaskSpec> = {
    project: "p",
    target: "new-window",
    agent: "claude",
    prompt: "hi",
  };

  it("rejects the reserved new-session target", () => {
    expect(() =>
      validateNewTask({ ...base, target: "new-session" as never }),
    ).toThrow(/new-session/);
  });

  it("rejects an unknown target", () => {
    expect(() =>
      validateNewTask({ ...base, target: "nope" as never }),
    ).toThrow(/Unknown task target/);
  });

  it("requires project, agent, and prompt", () => {
    expect(() => validateNewTask({ ...base, project: "" })).toThrow(/project/);
    expect(() => validateNewTask({ ...base, agent: "" })).toThrow(/agent/);
    expect(() => validateNewTask({ ...base, prompt: "" })).toThrow(/prompt/);
  });

  it("returns a narrowed spec preserving optional fields", () => {
    const spec = validateNewTask({
      ...base,
      target: "send-to-existing",
      targetRef: "%3",
      command: ["claude", "-p", "hi"],
      worktree: { branch: "feat/x", base: "main" },
    });
    expect(spec.targetRef).toBe("%3");
    expect(spec.command).toEqual(["claude", "-p", "hi"]);
    expect(spec.worktree).toEqual({ branch: "feat/x", base: "main" });
  });

  it("accepts the background target", () => {
    const spec = validateNewTask({ ...base, target: "background" });
    expect(spec.target).toBe("background");
  });
});
