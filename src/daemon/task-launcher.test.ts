import { describe, expect, it } from "bun:test";
import { tmpdir } from "os";
import {
  buildLaunchCommand,
  launchTask,
  type TaskLauncherDeps,
  type TmuxRunner,
} from "./task-launcher";
import type { AgentDef } from "../lib/agents";
import type { TaskInstance } from "../lib/task";

const CWD = tmpdir(); // a real, existing directory so the cwd check passes

function makeTask(over: Partial<TaskInstance> = {}): TaskInstance {
  return {
    id: "t1",
    project: CWD,
    target: "new-window",
    agent: "claude",
    prompt: "do it",
    status: "pending",
    createdAt: "2024-01-15T12:00:00Z",
    updatedAt: "2024-01-15T12:00:00Z",
    ...over,
  };
}

/** Fake tmux: pane id for creates, scripted captures, records send-keys. */
function fakeTmux(opts: { paneId?: string; captures?: string[] } = {}) {
  const paneId = opts.paneId ?? "%9";
  const captures = opts.captures ?? [""];
  const calls: string[][] = [];
  let capIdx = 0;
  const runTmux: TmuxRunner = async (args) => {
    calls.push(args);
    const cmd = args[0];
    if (cmd === "new-window" || cmd === "split-window") {
      return { code: 0, stdout: `${paneId}\n`, stderr: "" };
    }
    if (cmd === "capture-pane") {
      const out = captures[Math.min(capIdx, captures.length - 1)] ?? "";
      capIdx++;
      return { code: 0, stdout: out, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" }; // send-keys
  };
  return { runTmux, calls };
}

/** Send-keys payloads (the text arg), in order. */
const sentTexts = (calls: string[][]) =>
  calls.filter((a) => a[0] === "send-keys").map((a) => a[3]);

function deps(
  runTmux: TmuxRunner,
  over: Partial<TaskLauncherDeps> = {},
): TaskLauncherDeps {
  return {
    getAgentByType: () => undefined,
    runTmux,
    prefs: {},
    now: () => 0,
    sleep: async () => {},
    ...over,
  };
}

const claudeAgent = { readyPattern: /^[>❯]\s*$/ } as unknown as AgentDef;

describe("buildLaunchCommand", () => {
  it("uses prefs.command for claude (no --prompt)", () => {
    expect(
      buildLaunchCommand(makeTask(), {
        getAgentByType: () => undefined,
        prefs: { command: "claude-beta" },
      }),
    ).toBe("claude-beta");
  });

  it("uses the agent executable for non-claude", () => {
    expect(
      buildLaunchCommand(makeTask({ agent: "codex" }), {
        getAgentByType: () =>
          ({ executable: "codex-bin" }) as unknown as AgentDef,
        prefs: {},
      }),
    ).toBe("codex-bin");
  });

  it("shell-quotes a passthrough command argv", () => {
    expect(
      buildLaunchCommand(makeTask({ command: ["claude", "-p", "hi there"] }), {
        getAgentByType: () => undefined,
        prefs: {},
      }),
    ).toBe("'claude' '-p' 'hi there'");
  });
});

describe("launchTask interactive (adaptive)", () => {
  it("launches the binary, waits for ready, then sends the prompt", async () => {
    const { runTmux, calls } = fakeTmux({
      paneId: "%12",
      captures: ["$ ", "❯ "], // baseline (shell), then ready
    });
    const now = (() => {
      let t = 0;
      return () => (t += 100);
    })();
    const result = await launchTask(
      makeTask(),
      deps(runTmux, { getAgentByType: () => claudeAgent, now }),
    );
    expect(result.paneId).toBe("%12");
    // launch command then the prompt — never a --prompt flag.
    expect(sentTexts(calls)).toEqual(["claude", "do it"]);
    expect(JSON.stringify(calls)).not.toContain("--prompt");
  });

  it("sends the prompt immediately when the agent has no readyPattern", async () => {
    const { runTmux, calls } = fakeTmux({ captures: ["$ "] });
    await launchTask(
      makeTask({ agent: "codex" }),
      deps(runTmux, {
        getAgentByType: () => ({}) as unknown as AgentDef,
      }),
    );
    expect(sentTexts(calls)).toEqual(["codex", "do it"]);
    // Only the pre-launch baseline capture; no ready polling.
    expect(calls.filter((a) => a[0] === "capture-pane")).toHaveLength(1);
  });

  it("sends the prompt after timeout when ready never matches", async () => {
    const { runTmux, calls } = fakeTmux({ captures: ["$ "] }); // never ready
    let t = 0;
    const now = () => (t += 20_000); // jump past the timeout each check
    await launchTask(
      makeTask(),
      deps(runTmux, { getAgentByType: () => claudeAgent, now }),
    );
    expect(sentTexts(calls)).toEqual(["claude", "do it"]);
  });

  it("passthrough command is launched verbatim with no prompt send", async () => {
    const { runTmux, calls } = fakeTmux({});
    await launchTask(
      makeTask({ command: ["claude", "-p", "x"] }),
      deps(runTmux),
    );
    expect(sentTexts(calls)).toEqual(["'claude' '-p' 'x'"]); // no second send
  });

  it("uses split-window for a split target", async () => {
    const { runTmux, calls } = fakeTmux({ captures: ["$ "] });
    await launchTask(
      makeTask({ target: "split", agent: "codex" }),
      deps(runTmux, { getAgentByType: () => ({}) as unknown as AgentDef }),
    );
    expect(calls[0][0]).toBe("split-window");
  });

  it("throws before any tmux call when the working dir is missing", async () => {
    const { runTmux, calls } = fakeTmux({});
    await expect(
      launchTask(makeTask({ project: "/no/such/dir" }), deps(runTmux)),
    ).rejects.toThrow(/Working directory does not exist/);
    expect(calls).toHaveLength(0);
  });
});

describe("launchTask other targets", () => {
  it("send-to-existing requires targetRef", async () => {
    const { runTmux } = fakeTmux({});
    await expect(
      launchTask(makeTask({ target: "send-to-existing" }), deps(runTmux)),
    ).rejects.toThrow(/targetRef/);
  });

  it("send-to-existing sends the prompt to the referenced pane", async () => {
    const { runTmux, calls } = fakeTmux({});
    const result = await launchTask(
      makeTask({ target: "send-to-existing", targetRef: "%3" }),
      deps(runTmux),
    );
    expect(result.paneId).toBeUndefined();
    expect(calls).toEqual([["send-keys", "-t", "%3", "do it", "Enter"]]);
  });

  it("background is rejected by the pane launcher", async () => {
    const { runTmux } = fakeTmux({});
    await expect(
      launchTask(makeTask({ target: "background" }), deps(runTmux)),
    ).rejects.toThrow(/background/);
  });

  it("new-session is rejected", async () => {
    const { runTmux } = fakeTmux({});
    await expect(
      launchTask(makeTask({ target: "new-session" as never }), deps(runTmux)),
    ).rejects.toThrow(/Unsupported task target/);
  });
});
