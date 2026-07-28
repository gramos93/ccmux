import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import {
  buildLaunchCommand,
  disambiguatedSessionName,
  isAgentResumable,
  launchTask,
  resolveProjectSession,
  sanitizeTmuxName,
  tmuxSessionName,
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
 *  delivery goes through the injected sendLiteral/sendPrompt.
 *
 *  Session existence/ownership: `sessions` maps a session name → its
 *  `@ccmux_project` owner ("" = unstamped) and drives both `has-session` and
 *  `show-option`. The older `sessionExists` boolean is still honored (every
 *  name exists, owned by `sessionProject`) for tests that don't care about the
 *  name. */
function fakeTmux(
  opts: {
    paneId?: string;
    captures?: string[];
    sessionExists?: boolean;
    sessionProject?: string;
    sessions?: Record<string, string>;
  } = {},
) {
  const paneId = opts.paneId ?? "%9";
  const captures = opts.captures ?? [""];
  const calls: string[][] = [];
  let capIdx = 0;
  const nameOf = (tok: string | undefined) => (tok ?? "").replace(/^=/, "");
  const lookup = (
    name: string,
  ): { exists: boolean; owner: string } => {
    if (opts.sessions) {
      return name in opts.sessions
        ? { exists: true, owner: opts.sessions[name] }
        : { exists: false, owner: "" };
    }
    return {
      exists: !!opts.sessionExists,
      owner: opts.sessionProject ?? "",
    };
  };
  const runTmux: TmuxRunner = async (args) => {
    calls.push(args);
    const cmd = args[0];
    if (
      cmd === "new-window" ||
      cmd === "split-window" ||
      cmd === "new-session"
    ) {
      return { code: 0, stdout: `${paneId}\n`, stderr: "" };
    }
    if (cmd === "has-session") {
      return { code: lookup(nameOf(args[2])).exists ? 0 : 1, stdout: "", stderr: "" };
    }
    if (cmd === "show-option") {
      // ["show-option","-v","-t","=name","@ccmux_project"]
      return { code: 0, stdout: `${lookup(nameOf(args[3])).owner}\n`, stderr: "" };
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

describe("session name disambiguation", () => {
  it("sanitizeTmuxName replaces forbidden chars and trims; tmuxSessionName keeps its fallbacks", () => {
    expect(sanitizeTmuxName("a.b:c")).toBe("a-b-c");
    expect(sanitizeTmuxName("  spaced  ")).toBe("spaced");
    expect(sanitizeTmuxName("   ")).toBe("");
    // tmuxSessionName is basename-derived with a `task` fallback when the
    // basename sanitizes to empty (e.g. a whitespace-only path).
    expect(tmuxSessionName("/x/y/my.proj")).toBe("my-proj");
    expect(tmuxSessionName("   ")).toBe("task");
  });

  it("disambiguatedSessionName is deterministic and path-derived", () => {
    const p = "/Users/x/work/api";
    expect(disambiguatedSessionName(p)).toBe(disambiguatedSessionName(p));
    // Same basename, different parent → same primary name, different alt.
    expect(tmuxSessionName("/a/api")).toBe(tmuxSessionName("/b/api"));
    expect(disambiguatedSessionName("/a/api")).not.toBe(
      disambiguatedSessionName("/b/api"),
    );
    // Alt is the primary name plus a short hex suffix.
    expect(disambiguatedSessionName(p)).toMatch(/^api-[0-9a-f]{6}$/);
  });

  it("resolveProjectSession: fresh name when nothing exists", async () => {
    const { runTmux } = fakeTmux({ sessionExists: false });
    const r = await resolveProjectSession({ runTmux }, "/a/api");
    expect(r).toEqual({ name: "api", exists: false });
  });

  it("resolveProjectSession: reuse when the same project owns the name", async () => {
    const { runTmux } = fakeTmux({ sessions: { api: "/a/api" } });
    const r = await resolveProjectSession({ runTmux }, "/a/api");
    expect(r).toEqual({ name: "api", exists: true });
  });

  it("resolveProjectSession: disambiguate when a different project owns the name", async () => {
    const { runTmux } = fakeTmux({ sessions: { api: "/b/api" } });
    const r = await resolveProjectSession({ runTmux }, "/a/api");
    expect(r).toEqual({ name: disambiguatedSessionName("/a/api"), exists: false });
  });

  it("resolveProjectSession: attach to the disambiguated name when it is already ours", async () => {
    const alt = disambiguatedSessionName("/a/api");
    const { runTmux } = fakeTmux({ sessions: { api: "/b/api", [alt]: "/a/api" } });
    const r = await resolveProjectSession({ runTmux }, "/a/api");
    expect(r).toEqual({ name: alt, exists: true });
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
  it("resumes a non-new-session task into the project session (create-or-attach), not the current session", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const name = basename(proj);
    const { runTmux, calls } = fakeTmux({
      paneId: "%7",
      captures: ["$ "],
      sessionExists: false,
    });
    const rec = recorder();
    const result = await launchTask(
      // A split task with a pane-id targetRef — the resume must NOT use it as a
      // session name, and must NOT open a bare new-window in the current session.
      makeTask({
        target: "split",
        project: proj,
        targetRef: "%3",
        nativeSessionId: "nat-1",
      }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
      { resume: true },
    );
    expect(result.paneId).toBe("%7");
    expect(calls.some((c) => c[0] === "has-session")).toBe(true); // project-session probe
    const create = calls.find((c) => c[0] === "new-session");
    expect(create).toBeDefined();
    expect(create).toContain("-s");
    expect(create).toContain(name); // project-derived name
    expect(create).not.toContain("%3"); // pane-id targetRef not used as a name
    expect(calls.some((c) => c[0] === "new-window")).toBe(false); // no current-session window
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

  it("new-session with no existing session creates a detached project session and stamps @ccmux_project", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const name = basename(proj);
    const { runTmux, calls } = fakeTmux({
      paneId: "%20",
      captures: ["$ ", "❯ "],
      sessionExists: false,
    });
    const rec = recorder();
    const res = await launchTask(
      makeTask({ target: "new-session", project: proj, prompt: "go" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
    );
    // Gated on has-session, then created detached with the sanitized name.
    expect(calls.some((c) => c[0] === "has-session")).toBe(true);
    const create = calls.find((c) => c[0] === "new-session");
    expect(create).toBeDefined();
    expect(create).toContain("-d");
    expect(create).toContain("-s");
    expect(create).toContain(name); // project basename as the session name
    expect(create).toContain(proj); // -c cwd
    // Fresh session is stamped with its owning project.
    const stamp = calls.find(
      (c) => c[0] === "set-option" && c.includes("@ccmux_project"),
    );
    expect(stamp).toBeDefined();
    expect(stamp).toContain(name);
    expect(stamp).toContain(proj);
    expect(res.paneId).toBe("%20");
    expect(rec.prompt.at(-1)?.text).toBe("go");
  });

  it("new-session reuses a same-named session owned by the same project (new-window -t, no stamp)", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const name = basename(proj);
    const { runTmux, calls } = fakeTmux({
      paneId: "%21",
      captures: ["$ ", "❯ "],
      sessions: { [name]: proj }, // exists AND owned by this project
    });
    const rec = recorder();
    await launchTask(
      makeTask({ target: "new-session", project: proj, prompt: "go" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
    );
    // No duplicate session: a window is opened in the existing one instead.
    expect(calls.some((c) => c[0] === "new-session")).toBe(false);
    const win = calls.find((c) => c[0] === "new-window");
    expect(win).toBeDefined();
    expect(win).toContain("-t");
    expect(win).toContain(name);
    // Attach path does not re-stamp.
    expect(calls.some((c) => c[0] === "set-option")).toBe(false);
  });

  it("new-session disambiguates when the same name belongs to a different project", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const name = basename(proj);
    const alt = disambiguatedSessionName(proj);
    const { runTmux, calls } = fakeTmux({
      paneId: "%22",
      captures: ["$ ", "❯ "],
      sessions: { [name]: "/some/other/project" }, // taken by a different repo
    });
    const rec = recorder();
    await launchTask(
      makeTask({ target: "new-session", project: proj, prompt: "go" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
    );
    // A fresh session is created under the disambiguated name — never the
    // primary name that belongs to the other project.
    const create = calls.find((c) => c[0] === "new-session");
    expect(create).toBeDefined();
    expect(create).toContain(alt);
    expect(create).not.toContain(name);
    // And it is stamped for this project.
    const stamp = calls.find(
      (c) => c[0] === "set-option" && c.includes("@ccmux_project"),
    );
    expect(stamp).toContain(alt);
    expect(stamp).toContain(proj);
  });

  it("new-session disambiguates rather than hijacking an unstamped (hand-made) session", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const name = basename(proj);
    const alt = disambiguatedSessionName(proj);
    const { runTmux, calls } = fakeTmux({
      paneId: "%23",
      captures: ["$ ", "❯ "],
      sessions: { [name]: "" }, // exists but no @ccmux_project stamp
    });
    const rec = recorder();
    await launchTask(
      makeTask({ target: "new-session", project: proj, prompt: "go" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
    );
    // Does not open a window in the user's own same-named session.
    expect(calls.some((c) => c[0] === "new-window" && c.includes(name))).toBe(
      false,
    );
    const create = calls.find((c) => c[0] === "new-session");
    expect(create).toContain(alt);
  });

  it("new-session with an explicit targetRef creates a session of that exact name", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const name = basename(proj);
    const { runTmux, calls } = fakeTmux({
      paneId: "%24",
      captures: ["$ ", "❯ "],
      sessions: {}, // "review" does not exist yet
    });
    const rec = recorder();
    await launchTask(
      makeTask({ target: "new-session", project: proj, targetRef: "review", prompt: "go" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
    );
    const create = calls.find((c) => c[0] === "new-session");
    expect(create).toBeDefined();
    expect(create).toContain("review");
    expect(create).not.toContain(name); // project-derived name is not used
    // Fresh explicit session is stamped for the project.
    const stamp = calls.find(
      (c) => c[0] === "set-option" && c.includes("@ccmux_project"),
    );
    expect(stamp).toContain("review");
    expect(stamp).toContain(proj);
  });

  it("explicit targetRef attaches to a pre-existing session without disambiguation or re-stamp", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const { runTmux, calls } = fakeTmux({
      paneId: "%25",
      captures: ["$ ", "❯ "],
      // "review" exists and belongs to a different project — attach anyway.
      sessions: { review: "/some/other/project" },
    });
    const rec = recorder();
    await launchTask(
      makeTask({ target: "new-session", project: proj, targetRef: "review", prompt: "go" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
    );
    // Opens a window in the named session; no new session, no disambiguation.
    expect(calls.some((c) => c[0] === "new-session")).toBe(false);
    const win = calls.find((c) => c[0] === "new-window");
    expect(win).toContain("review");
    // Attaching never re-stamps a pre-existing session.
    expect(calls.some((c) => c[0] === "set-option")).toBe(false);
  });

  it("explicit targetRef is NOT disambiguated even when a different project owns the name", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const { runTmux, calls } = fakeTmux({
      paneId: "%26",
      captures: ["$ ", "❯ "],
      sessions: { review: "/some/other/project" },
    });
    const rec = recorder();
    await launchTask(
      makeTask({ target: "new-session", project: proj, targetRef: "review", prompt: "go" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
    );
    // No hashed alt name anywhere in the tmux calls.
    const alt = disambiguatedSessionName("review");
    expect(calls.flat().some((tok) => tok === alt)).toBe(false);
    // has-session was probed for the plain explicit name, not a resolved one.
    const probe = calls.find((c) => c[0] === "has-session");
    expect(probe).toContain("=review");
  });

  it("empty/all-illegal targetRef falls back to the project-derived name", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const name = basename(proj);
    const { runTmux, calls } = fakeTmux({
      paneId: "%27",
      captures: ["$ ", "❯ "],
      sessionExists: false,
    });
    const rec = recorder();
    await launchTask(
      // "." sanitizes to "-" then trims... "." -> "-", but "  " -> "" ; use whitespace.
      makeTask({ target: "new-session", project: proj, targetRef: "   ", prompt: "go" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
    );
    const create = calls.find((c) => c[0] === "new-session");
    expect(create).toContain(name); // project-derived, not the blank ref
  });

  it("resume of a new-session task with a targetRef resolves to the same explicit name", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ccmux-ns-"));
    const { runTmux, calls } = fakeTmux({
      paneId: "%28",
      captures: ["$ ", "❯ "],
      sessions: {},
    });
    const rec = recorder();
    await launchTask(
      makeTask({
        target: "new-session",
        project: proj,
        targetRef: "review",
        nativeSessionId: "nat-9",
      }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
      { resume: true },
    );
    const create = calls.find((c) => c[0] === "new-session");
    expect(create).toContain("review");
    expect(rec.literal[0]?.text).toContain("--resume");
  });

  it("resume of a new-session task uses the create-or-attach path", async () => {
    const { runTmux, calls } = fakeTmux({
      paneId: "%22",
      captures: ["$ ", "❯ "],
      sessionExists: false,
    });
    const rec = recorder();
    await launchTask(
      makeTask({ target: "new-session", nativeSessionId: "nat-9" }),
      deps(runTmux, rec, { getAgentByType: () => claudeAgent }),
      { resume: true },
    );
    // Resume re-creates the project session rather than a bare new-window.
    expect(calls.some((c) => c[0] === "has-session")).toBe(true);
    expect(calls.some((c) => c[0] === "new-session")).toBe(true);
    // The launch command is the resume command.
    expect(rec.literal[0]?.text).toContain("--resume");
    expect(rec.literal[0]?.text).toContain("nat-9");
  });
});
