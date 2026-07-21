import { describe, expect, it } from "bun:test";
import {
  buildTaskCommand,
  launchTask,
  type TaskLauncherDeps,
  type TmuxRunner,
} from "./task-launcher";
import type { TaskInstance } from "../lib/task";

function makeTask(over: Partial<TaskInstance> = {}): TaskInstance {
  return {
    id: "t1",
    project: "/repo",
    target: "new-window",
    agent: "claude",
    prompt: "do it",
    status: "pending",
    createdAt: "2024-01-15T12:00:00Z",
    updatedAt: "2024-01-15T12:00:00Z",
    ...over,
  };
}

/** Records tmux calls; returns canned pane id for pane-creating commands. */
function recordingRunner(paneId = "%9"): {
  runTmux: TmuxRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runTmux: TmuxRunner = async (args) => {
    calls.push(args);
    const creates = args[0] === "new-window" || args[0] === "split-window";
    return { code: 0, stdout: creates ? paneId + "\n" : "", stderr: "" };
  };
  return { runTmux, calls };
}

const deps = (runTmux: TmuxRunner): TaskLauncherDeps => ({
  getAgentByType: () => undefined,
  runTmux,
  prefs: {},
});

describe("buildTaskCommand", () => {
  it("inlines an escaped --prompt", () => {
    const cmd = buildTaskCommand(makeTask({ prompt: "it's a test" }), {
      getAgentByType: () => undefined,
      prefs: {},
    });
    expect(cmd).toBe("claude --prompt 'it'\\''s a test'");
  });

  it("uses preferences.command for claude", () => {
    const cmd = buildTaskCommand(makeTask(), {
      getAgentByType: () => undefined,
      prefs: { command: "claude-beta" },
    });
    expect(cmd.startsWith("claude-beta ")).toBe(true);
  });
});

describe("launchTask", () => {
  it("new-window creates a pane and sends the command", async () => {
    const { runTmux, calls } = recordingRunner("%12");
    const result = await launchTask(makeTask(), deps(runTmux));
    expect(result.paneId).toBe("%12");
    expect(calls[0]).toEqual([
      "new-window",
      "-c",
      "/repo",
      "-P",
      "-F",
      "#{pane_id}",
    ]);
    expect(calls[1].slice(0, 3)).toEqual(["send-keys", "-t", "%12"]);
  });

  it("split uses split-window", async () => {
    const { runTmux, calls } = recordingRunner();
    await launchTask(makeTask({ target: "split" }), deps(runTmux));
    expect(calls[0][0]).toBe("split-window");
  });

  it("send-to-existing sends the raw prompt to targetRef, no pane created", async () => {
    const { runTmux, calls } = recordingRunner();
    const result = await launchTask(
      makeTask({ target: "send-to-existing", targetRef: "%3" }),
      deps(runTmux),
    );
    expect(result.paneId).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["send-keys", "-t", "%3", "do it", "Enter"]);
  });

  it("send-to-existing without targetRef throws", async () => {
    const { runTmux } = recordingRunner();
    await expect(
      launchTask(makeTask({ target: "send-to-existing" }), deps(runTmux)),
    ).rejects.toThrow(/targetRef/);
  });

  it("new-session is rejected", async () => {
    const { runTmux } = recordingRunner();
    await expect(
      launchTask(makeTask({ target: "new-session" as never }), deps(runTmux)),
    ).rejects.toThrow(/Unsupported task target/);
  });

  it("propagates a tmux failure", async () => {
    const failing: TmuxRunner = async () => ({
      code: 1,
      stdout: "",
      stderr: "no server",
    });
    await expect(launchTask(makeTask(), deps(failing))).rejects.toThrow(
      /new-window failed/,
    );
  });
});
