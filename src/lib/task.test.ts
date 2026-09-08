import { describe, expect, it } from "bun:test";
import {
  deriveTaskName,
  resolveTask,
  taskDisplayName,
  validateNewTask,
  type TaskSpec,
} from "./task";

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

  it("resolves autoMode through the same cascade, overridable by input", () => {
    const fromDefault = resolveTask(
      { defaults: { autoMode: true } },
      { project: "p" },
    );
    expect(fromDefault.autoMode).toBe(true);

    const overridden = resolveTask(
      { defaults: { autoMode: true } },
      { project: "p", input: { autoMode: false } },
    );
    expect(overridden.autoMode).toBe(false);

    const unset = resolveTask({}, { project: "p" });
    expect(unset.autoMode).toBeUndefined();
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

  it("falls back to the built-in agent default when nothing sets one", () => {
    const resolved = resolveTask({}, { project: "p", input: { prompt: "hi" } });
    expect(resolved.agent).toBe("claude");
  });

  it("a configured agent default beats the built-in fallback", () => {
    const resolved = resolveTask(
      { defaults: { agent: "codex" } },
      { project: "p", input: { prompt: "hi" } },
    );
    expect(resolved.agent).toBe("codex");
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

  it("accepts the new-session target", () => {
    const task = validateNewTask({ ...base, target: "new-session" });
    expect(task.target).toBe("new-session");
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
      autoMode: true,
    });
    expect(spec.targetRef).toBe("%3");
    expect(spec.command).toEqual(["claude", "-p", "hi"]);
    expect(spec.worktree).toEqual({ branch: "feat/x", base: "main" });
    expect(spec.autoMode).toBe(true);
  });

  it("accepts the background target", () => {
    const spec = validateNewTask({ ...base, target: "background" });
    expect(spec.target).toBe("background");
  });

  it("allows a missing prompt when a passthrough command is present", () => {
    const spec = validateNewTask({
      project: "p",
      target: "new-window",
      agent: "codex",
      command: ["codex", "exec", "hi"],
    });
    expect(spec.command).toEqual(["codex", "exec", "hi"]);
    expect(spec.prompt).toBe("");
  });

  it("preserves an explicit name", () => {
    const spec = validateNewTask({
      project: "p",
      target: "new-window",
      agent: "claude",
      prompt: "hi",
      name: "my task",
    });
    expect(spec.name).toBe("my task");
  });

  it("accepts new-session (no reserved target)", () => {
    const spec = validateNewTask({
      project: "p",
      target: "new-session",
      agent: "claude",
      prompt: "hi",
    });
    expect(spec.target).toBe("new-session");
  });
});

describe("deriveTaskName / taskDisplayName", () => {
  it("derives from the first non-empty prompt line", () => {
    expect(deriveTaskName({ prompt: "\n  Fix the login bug  \nmore" })).toBe(
      "Fix the login bug",
    );
  });

  it("collapses whitespace and caps long prompts with an ellipsis", () => {
    const long = "word ".repeat(30).trim();
    const name = deriveTaskName({ prompt: long });
    expect(name.length).toBeLessThanOrEqual(50);
    expect(name.endsWith("…")).toBe(true);
  });

  it("falls back to the command head, then to 'task'", () => {
    expect(deriveTaskName({ command: ["codex", "exec"] })).toBe("codex");
    expect(deriveTaskName({})).toBe("task");
    expect(deriveTaskName({ prompt: "   " })).toBe("task");
  });

  it("taskDisplayName prefers an explicit name, else derives", () => {
    expect(taskDisplayName({ name: "Named", prompt: "ignored" })).toBe("Named");
    expect(taskDisplayName({ prompt: "derive me" })).toBe("derive me");
    expect(taskDisplayName({ name: "  ", prompt: "derive me" })).toBe("derive me");
  });
});
