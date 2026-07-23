import { describe, expect, it } from "bun:test";
import { tmpdir } from "os";
import {
  buildLaunchCommand,
  isAgentResumable,
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

/** Fake tmux: pane id for creates, scripted captures. No send-keys here —
 *  delivery goes through the injected sendLiteral/sendPrompt. */
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
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runTmux, calls };
}

type Sent = { pane: string; text: string; enter: boolean };
function recorder(ok = true) {
  const literal: Sent[] = [];
  const prompt: Sent[] = [];
  return {
    literal,
    prompt,
    sendLiteral: async (pane: string, text: string, enter: boolean) => {
      literal.push({ pane, text, enter });
      return ok;
    },
    sendPrompt: async (pane: string, text: string, enter: boolean) => {
      prompt.push({ pane, text, enter });
      return ok;
    },
  };
}

function deps(
  runTmux: TmuxRunner,
  rec: ReturnType<typeof recorder>,
  over: Partial<TaskLauncherDeps> = {},
): TaskLauncherDeps {
  return {
    getAgentByType: () => undefined,
    runTmux,
    prefs: {},
    now: () => 0,
    sleep: async () => {},
    sendLiteral: rec.sendLiteral,
    sendPrompt: rec.sendPrompt,
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

  it("builds claude's resume command from nativeSessionId", () => {
    expect(
      buildLaunchCommand(
        makeTask({ nativeSessionId: "nat-1" }),
        { getAgentByType: () => undefined, prefs: {} },
        { resume: true },
      ),
    ).toBe("claude --resume nat-1");
  });

  it("builds a resumeCommand agent's resume command ({id} substitution)", () => {
    expect(
      buildLaunchCommand(
        makeTask({ agent: "codex", nativeSessionId: "nat-2" }),
        {
          getAgentByType: () =>
            ({ resumeCommand: "codex resume {id}" }) as unknown as AgentDef,
          prefs: {},
        },
        { resume: true },
      ),
    ).toBe("codex resume nat-2");
  });

  it("throws resuming an agent with no resume support", () => {
    expect(() =>
      buildLaunchCommand(
        makeTask({ agent: "gemini", nativeSessionId: "nat" }),
        { getAgentByType: () => ({}) as unknown as AgentDef, prefs: {} },
        { resume: true },
      ),
    ).toThrow(/does not support resume/);
  });

  it("throws resuming a task with no nativeSessionId", () => {
    expect(() =>
      buildLaunchCommand(
        makeTask(),
        { getAgentByType: () => undefined, prefs: {} },
        { resume: true },
      ),
    ).toThrow(/no nativeSessionId/);
  });
});

describe("isAgentResumable", () => {
  it("claude and resumeCommand agents are resumable; others are not", () => {
    expect(isAgentResumable({ name: "claude" } as AgentDef)).toBe(true);
    expect(
      isAgentResumable({ resumeCommand: "x {id}" } as unknown as AgentDef),
    ).toBe(true);
    expect(isAgentResumable({ name: "gemini" } as unknown as AgentDef)).toBe(
      false,
    );
    expect(isAgentResumable(undefined)).toBe(false);
  });
});

describe("launchTask resume", () => {
  it("resumes into a fresh new-window with no prompt (re-attach)", async () => {
    const { runTmux, calls } = fakeTmux({ paneId: "%7", captures: ["$ "] });
    const rec = recorder();
    const result = await launchTask(
      makeTask({ target: "split", nativeSessionId: "nat-1" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
      { resume: true },
    );
    expect(result.paneId).toBe("%7");
    expect(calls[0][0]).toBe("new-window"); // forced, not split
    expect(rec.literal).toEqual([
      { pane: "%7", text: "claude --resume nat-1", enter: true },
    ]);
    expect(rec.prompt).toHaveLength(0); // no follow-up
  });

  it("resumes and submits a follow-up prompt after ready", async () => {
    const { runTmux } = fakeTmux({ paneId: "%7", captures: ["$ ", "❯ "] });
    const rec = recorder();
    let t = 0;
    await launchTask(
      makeTask({ nativeSessionId: "nat-1" }),
      deps(runTmux, rec, {
        getAgentByType: () => claudeAgent,
        now: () => (t += 100),
      }),
      { resume: true, prompt: "keep going" },
    );
    expect(rec.literal[0].text).toBe("claude --resume nat-1");
    expect(rec.prompt).toEqual([{ pane: "%7", text: "keep going", enter: true }]);
  });
});

describe("launchTask interactive (adaptive)", () => {
  it("launches the binary (sendLiteral) then submits the prompt (sendPrompt)", async () => {
    const { runTmux } = fakeTmux({ paneId: "%12", captures: ["$ ", "❯ "] });
    const rec = recorder();
    let t = 0;
    const result = await launchTask(
      makeTask(),
      deps(runTmux, rec, {
        getAgentByType: () => claudeAgent,
        now: () => (t += 100),
      }),
    );
    expect(result.paneId).toBe("%12");
    // launch via sendLiteral, prompt via sendPrompt — both with Enter.
    expect(rec.literal).toEqual([{ pane: "%12", text: "claude", enter: true }]);
    expect(rec.prompt).toEqual([{ pane: "%12", text: "do it", enter: true }]);
  });

  it("submits the prompt immediately when the agent has no readyPattern", async () => {
    const { runTmux } = fakeTmux({ captures: ["$ "] });
    const rec = recorder();
    await launchTask(
      makeTask({ agent: "codex" }),
      deps(runTmux, rec, { getAgentByType: () => ({}) as unknown as AgentDef }),
    );
    expect(rec.literal[0].text).toBe("codex");
    expect(rec.prompt[0].text).toBe("do it");
  });

  it("submits after timeout when ready never matches", async () => {
    const { runTmux } = fakeTmux({ captures: ["$ "] });
    const rec = recorder();
    let t = 0;
    await launchTask(
      makeTask(),
      deps(runTmux, rec, {
        getAgentByType: () => claudeAgent,
        now: () => (t += 20_000),
      }),
    );
    expect(rec.prompt).toEqual([{ pane: "%9", text: "do it", enter: true }]);
  });

  it("passthrough command is launched verbatim with no prompt submit", async () => {
    const { runTmux } = fakeTmux({});
    const rec = recorder();
    await launchTask(makeTask({ command: ["claude", "-p", "x"] }), deps(runTmux, rec));
    expect(rec.literal).toEqual([
      { pane: "%9", text: "'claude' '-p' 'x'", enter: true },
    ]);
    expect(rec.prompt).toHaveLength(0);
  });

  it("uses split-window for a split target", async () => {
    const { runTmux, calls } = fakeTmux({ captures: ["$ "] });
    const rec = recorder();
    await launchTask(
      makeTask({ target: "split", agent: "codex" }),
      deps(runTmux, rec, { getAgentByType: () => ({}) as unknown as AgentDef }),
    );
    expect(calls[0][0]).toBe("split-window");
  });

  it("throws before any tmux call when the working dir is missing", async () => {
    const { runTmux, calls } = fakeTmux({});
    const rec = recorder();
    await expect(
      launchTask(makeTask({ project: "/no/such/dir" }), deps(runTmux, rec)),
    ).rejects.toThrow(/Working directory does not exist/);
    expect(calls).toHaveLength(0);
    expect(rec.literal).toHaveLength(0);
  });

  it("throws when the prompt fails to send", async () => {
    const { runTmux } = fakeTmux({ captures: ["$ "] });
    const rec = recorder(false); // sends fail
    await expect(
      launchTask(
        makeTask({ agent: "codex" }),
        deps(runTmux, rec, {
          getAgentByType: () => ({}) as unknown as AgentDef,
        }),
      ),
    ).rejects.toThrow(/failed to send/);
  });
});

describe("launchTask other targets", () => {
  it("send-to-existing requires targetRef", async () => {
    const { runTmux } = fakeTmux({});
    await expect(
      launchTask(makeTask({ target: "send-to-existing" }), deps(runTmux, recorder())),
    ).rejects.toThrow(/targetRef/);
  });

  it("send-to-existing submits the prompt into the referenced pane", async () => {
    const { runTmux } = fakeTmux({});
    const rec = recorder();
    const result = await launchTask(
      makeTask({ target: "send-to-existing", targetRef: "%3" }),
      deps(runTmux, rec),
    );
    expect(result.paneId).toBeUndefined();
    expect(rec.prompt).toEqual([{ pane: "%3", text: "do it", enter: true }]);
  });

  it("background is rejected by the pane launcher", async () => {
    const { runTmux } = fakeTmux({});
    await expect(
      launchTask(makeTask({ target: "background" }), deps(runTmux, recorder())),
    ).rejects.toThrow(/background/);
  });

  it("new-session is rejected", async () => {
    const { runTmux } = fakeTmux({});
    await expect(
      launchTask(makeTask({ target: "new-session" as never }), deps(runTmux, recorder())),
    ).rejects.toThrow(/Unsupported task target/);
  });
});
