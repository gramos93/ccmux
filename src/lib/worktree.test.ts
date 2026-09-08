import { describe, it, expect } from "bun:test";
import {
  deriveBranchName,
  resolveBareRepo,
  resolveBaseBranch,
  resolveWorktree,
  slugifyBranch,
  WorktreeError,
  type CommandRunner,
} from "./worktree";

/** Build a fake CommandRunner from a table of (cmd + args-prefix) → result,
 *  recording every call. A handler is matched by the longest arg-prefix that
 *  matches; unmatched calls return code 1. */
function fakeRunner(
  handlers: Array<{
    cmd: string;
    args?: string[];
    result: { code: number; stdout?: string; stderr?: string };
  }>,
): { runner: CommandRunner; calls: Array<{ cmd: string; args: string[]; cwd?: string }> } {
  const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
  const runner: CommandRunner = async (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd });
    const match = handlers.find(
      (h) =>
        h.cmd === cmd &&
        (h.args ?? []).every((a, i) => args[i] === a),
    );
    if (!match) return { code: 1, stdout: "", stderr: "no handler" };
    return {
      code: match.result.code,
      stdout: match.result.stdout ?? "",
      stderr: match.result.stderr ?? "",
    };
  };
  return { runner, calls };
}

describe("resolveBareRepo", () => {
  it("resolves the bare root from the bare dir itself (relative common dir)", async () => {
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/tmp", "rev-parse", "--git-common-dir"], result: { code: 0, stdout: ".\n" } },
      { cmd: "git", args: ["-C", "/tmp", "config", "--get", "core.bare"], result: { code: 0, stdout: "true\n" } },
    ]);
    // resolve(".", "/tmp") → "/tmp"; realpath("/tmp") → "/private/tmp" on macOS,
    // so assert it ends with the resolved dir rather than an exact string.
    const root = await resolveBareRepo("/tmp", runner);
    expect(root).not.toBeNull();
    expect(root!.endsWith("/tmp")).toBe(true);
  });

  it("resolves the bare root from within a worktree (absolute common dir)", async () => {
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/tmp/wt", "rev-parse", "--git-common-dir"], result: { code: 0, stdout: "/tmp\n" } },
      { cmd: "git", args: ["-C", "/tmp", "config", "--get", "core.bare"], result: { code: 0, stdout: "true\n" } },
    ]);
    const root = await resolveBareRepo("/tmp/wt", runner);
    expect(root!.endsWith("/tmp")).toBe(true);
  });

  it("strips a trailing `.git` so the wtm root is the worktree container (real wtm clone layout)", async () => {
    // Real wtm layout: the bare repo is <root>/.git and worktrees are <root>/<name>.
    // `wtm create` must run from <root>, not <root>/.git.
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/tmp/main", "rev-parse", "--git-common-dir"], result: { code: 0, stdout: "/tmp/.git\n" } },
      { cmd: "git", args: ["-C", "/tmp/.git", "config", "--get", "core.bare"], result: { code: 0, stdout: "true\n" } },
    ]);
    const root = await resolveBareRepo("/tmp/main", runner);
    expect(root!.endsWith("/tmp")).toBe(true);
    expect(root!.endsWith("/.git")).toBe(false);
  });

  it("returns null for a non-bare repo", async () => {
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/tmp", "rev-parse", "--git-common-dir"], result: { code: 0, stdout: ".git\n" } },
      { cmd: "git", args: ["-C", "/tmp/.git", "config", "--get", "core.bare"], result: { code: 0, stdout: "false\n" } },
    ]);
    expect(await resolveBareRepo("/tmp", runner)).toBeNull();
  });

  it("returns null when not a git repo", async () => {
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/tmp", "rev-parse", "--git-common-dir"], result: { code: 128, stderr: "not a git repo" } },
    ]);
    expect(await resolveBareRepo("/tmp", runner)).toBeNull();
  });
});

describe("resolveWorktree", () => {
  const porcelain =
    "worktree /bare\nbare\n\nworktree /bare/main\nHEAD abc\nbranch refs/heads/main\n\n";

  it("reuses an existing worktree whose branch matches", async () => {
    const { runner, calls } = fakeRunner([
      { cmd: "git", args: ["-C", "/bare", "worktree", "list", "--porcelain"], result: { code: 0, stdout: porcelain } },
    ]);
    const res = await resolveWorktree("/bare", { branch: "main", base: "main" }, runner);
    expect(res).toEqual({ path: "/bare/main", branch: "main", created: false });
    // No wtm call when reusing.
    expect(calls.some((c) => c.cmd === "wtm")).toBe(false);
  });

  it("creates a new worktree via wtm when the branch is absent", async () => {
    const { runner, calls } = fakeRunner([
      { cmd: "git", args: ["-C", "/bare", "worktree", "list", "--porcelain"], result: { code: 0, stdout: porcelain } },
      { cmd: "wtm", args: ["create", "feature-x", "--from", "main", "--no-shell"], result: { code: 0 } },
    ]);
    const res = await resolveWorktree("/bare", { branch: "feature-x", base: "main" }, runner);
    expect(res).toEqual({ path: "/bare/feature-x", branch: "feature-x", created: true });
    const wtmCall = calls.find((c) => c.cmd === "wtm");
    expect(wtmCall?.cwd).toBe("/bare");
  });

  it("throws wtm-missing when the wtm binary is absent (code 127)", async () => {
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/bare", "worktree", "list", "--porcelain"], result: { code: 0, stdout: "" } },
      { cmd: "wtm", result: { code: 127, stderr: "spawn wtm ENOENT" } },
    ]);
    const err = await resolveWorktree("/bare", { branch: "x", base: "main" }, runner).catch((e) => e);
    expect(err).toBeInstanceOf(WorktreeError);
    expect((err as WorktreeError).kind).toBe("wtm-missing");
  });

  it("throws wtm-failed when wtm errors", async () => {
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/bare", "worktree", "list", "--porcelain"], result: { code: 0, stdout: "" } },
      { cmd: "wtm", result: { code: 1, stderr: "boom" } },
    ]);
    const err = await resolveWorktree("/bare", { branch: "x", base: "main" }, runner).catch((e) => e);
    expect(err).toBeInstanceOf(WorktreeError);
    expect((err as WorktreeError).kind).toBe("wtm-failed");
  });
});

describe("slugifyBranch", () => {
  it("slugifies a task name", () => {
    expect(slugifyBranch("Add dry-run flag")).toBe("add-dry-run-flag");
  });
  it("falls back to 'task' for an empty slug", () => {
    expect(slugifyBranch("!!!")).toBe("task");
  });
});

describe("deriveBranchName", () => {
  const noNames = [
    { cmd: "git", args: ["-C", "/bare", "branch"], result: { code: 0, stdout: "" } },
    { cmd: "git", args: ["-C", "/bare", "worktree", "list", "--porcelain"], result: { code: 0, stdout: "" } },
  ];

  it("uses an explicit branch verbatim", async () => {
    const { runner } = fakeRunner(noNames);
    expect(
      await deriveBranchName("/bare", { explicit: "feature-x", taskName: "n", taskId: "abcdef123" }, runner),
    ).toBe("feature-x");
  });

  it("derives a slug from the task name when free", async () => {
    const { runner } = fakeRunner(noNames);
    expect(
      await deriveBranchName("/bare", { taskName: "Add dry-run flag", taskId: "abcdef123" }, runner),
    ).toBe("add-dry-run-flag");
  });

  it("appends a short task-id suffix on collision", async () => {
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/bare", "branch"], result: { code: 0, stdout: "add-dry-run-flag\nmain\n" } },
      { cmd: "git", args: ["-C", "/bare", "worktree", "list", "--porcelain"], result: { code: 0, stdout: "" } },
    ]);
    expect(
      await deriveBranchName("/bare", { taskName: "Add dry-run flag", taskId: "abcdef123456" }, runner),
    ).toBe("add-dry-run-flag-abcdef");
  });
});

describe("resolveBaseBranch", () => {
  it("uses an explicit base verbatim", async () => {
    const { runner } = fakeRunner([]);
    expect(await resolveBaseBranch("/bare", { explicit: "develop" }, runner)).toBe("develop");
  });

  it("detects the default branch from origin/HEAD", async () => {
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/bare", "symbolic-ref", "refs/remotes/origin/HEAD"], result: { code: 0, stdout: "refs/remotes/origin/main\n" } },
    ]);
    expect(await resolveBaseBranch("/bare", {}, runner)).toBe("main");
  });

  it("falls back to master when origin/HEAD is absent but master exists", async () => {
    const { runner } = fakeRunner([
      { cmd: "git", args: ["-C", "/bare", "symbolic-ref", "refs/remotes/origin/HEAD"], result: { code: 1, stderr: "no HEAD" } },
      { cmd: "git", args: ["-C", "/bare", "branch"], result: { code: 0, stdout: "master\n" } },
      { cmd: "git", args: ["-C", "/bare", "worktree", "list", "--porcelain"], result: { code: 0, stdout: "" } },
    ]);
    expect(await resolveBaseBranch("/bare", {}, runner)).toBe("master");
  });
});
