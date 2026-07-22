import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { tmpdir } from "os";

// ensureDaemon must be a no-op in tests (don't spawn a daemon).
mock.module("./shared", () => ({ ensureDaemon: async () => {} }));

import { createTaskCommand } from "./task";

// A real, existing directory to pass to -d so the create-time existence check
// passes. Use the OS temp dir.
const DIR = tmpdir();

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
const realFetch = globalThis.fetch;

/** Stub fetch. `handler(url, method)` returns the JSON body to respond with. */
function stubFetch(handler: (url: string, method: string) => unknown) {
  globalThis.fetch = (async (
    input: string,
    init?: { method?: string; body?: string },
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(handler(url, method)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function runCli(...args: string[]): Promise<void> {
  await createTaskCommand().parseAsync(args, { from: "user" });
}

const createCall = () => calls.find((c) => c.url.endsWith("/tasks") && c.method === "POST");

describe("ccmux task create", () => {
  it("defaults the dir to process.cwd() when -d and CCMUX_CALLER_PWD are absent", async () => {
    const saved = process.env.CCMUX_CALLER_PWD;
    delete process.env.CCMUX_CALLER_PWD;
    stubFetch(() => ({ task: { id: "abcdef12", status: "pending" } }));
    await runCli("create", "--prompt", "hi");
    expect((createCall()!.body as { project: string }).project).toBe(process.cwd());
    if (saved !== undefined) process.env.CCMUX_CALLER_PWD = saved;
  });

  it("prefers CCMUX_CALLER_PWD over process.cwd() (bin/ccmux caller dir)", async () => {
    const saved = process.env.CCMUX_CALLER_PWD;
    process.env.CCMUX_CALLER_PWD = DIR;
    stubFetch(() => ({ task: { id: "abcdef12", status: "pending" } }));
    await runCli("create", "--prompt", "hi");
    expect((createCall()!.body as { project: string }).project).toBe(DIR);
    if (saved === undefined) delete process.env.CCMUX_CALLER_PWD;
    else process.env.CCMUX_CALLER_PWD = saved;
  });

  it("uses -d/--dir when given", async () => {
    stubFetch(() => ({ task: { id: "abcdef12", status: "pending" } }));
    await runCli("create", "-d", DIR, "--prompt", "hi");
    expect((createCall()!.body as { project: string }).project).toBe(DIR);
  });

  it("omits agent and target from the body when their flags are unset", async () => {
    stubFetch(() => ({ task: { id: "abcdef12", status: "pending" } }));
    await runCli("create", "-d", DIR);
    const body = createCall()!.body as Record<string, unknown>;
    expect("agent" in body).toBe(false);
    expect("target" in body).toBe(false);
  });

  it("sends agent/target when the flags are set", async () => {
    stubFetch(() => ({ task: { id: "abcdef12", status: "pending" } }));
    await runCli("create", "-d", DIR, "--agent", "codex", "--target", "split");
    const body = createCall()!.body as { agent: string; target: string };
    expect(body.agent).toBe("codex");
    expect(body.target).toBe("split");
  });

  it("errors (no create) when the dir does not exist", async () => {
    // process.exit is mocked to THROW so it halts like a real exit; otherwise
    // execution would fall through to the POST.
    const origExit = process.exit;
    process.exit = ((): never => {
      throw new Error("exit");
    }) as unknown as typeof process.exit;
    stubFetch(() => ({ task: { id: "abcdef12", status: "pending" } }));
    await expect(
      runCli("create", "-d", "/no/such/dir/really", "--prompt", "hi"),
    ).rejects.toThrow("exit");
    expect(createCall()).toBeUndefined(); // never POSTed
    process.exit = origExit;
  });

  it("--run creates then runs", async () => {
    stubFetch((url) =>
      url.endsWith("/run")
        ? { task: { id: "abcdef12", status: "running" } }
        : { task: { id: "abcdef12", status: "pending" } },
    );
    await runCli("create", "-d", DIR, "--run");
    expect(calls.map((c) => c.url.split("/").slice(-1)[0]).includes("run")).toBe(
      true,
    );
  });

  it("--bg sets target=background", async () => {
    stubFetch(() => ({ task: { id: "abcdef12", status: "pending" } }));
    await runCli("create", "-d", DIR, "--bg", "--prompt", "hi");
    expect((createCall()!.body as { target: string }).target).toBe("background");
  });

  it("captures the `-- <args>` tail as command", async () => {
    stubFetch(() => ({ task: { id: "abcdef12", status: "pending" } }));
    await runCli("create", "-d", DIR, "--agent", "codex", "--", "codex", "exec", "hi");
    const body = createCall()!.body as { command: string[]; agent: string };
    expect(body.command).toEqual(["codex", "exec", "hi"]);
    expect(body.agent).toBe("codex");
  });
});

describe("ccmux task run/rm prefix resolution", () => {
  const tasks = [
    { id: "aaaa1111-full", status: "pending" },
    { id: "bbbb2222-full", status: "pending" },
  ];

  it("resolves a unique prefix and runs the full id", async () => {
    stubFetch((url) =>
      url.endsWith("/run")
        ? { task: { id: "aaaa1111-full", status: "running" } }
        : { tasks },
    );
    await runCli("run", "aaaa");
    const run = calls.find((c) => c.url.endsWith("/run"));
    expect(run?.url.endsWith("/tasks/aaaa1111-full/run")).toBe(true);
  });

  it("errors (no run) on an ambiguous prefix", async () => {
    const exit = mock(() => undefined as never);
    const origExit = process.exit;
    process.exit = exit as unknown as typeof process.exit;
    stubFetch(() => ({ tasks: [{ id: "cc-1" }, { id: "cc-2" }] }));
    await runCli("run", "cc"); // prefix matches both
    expect(exit).toHaveBeenCalled();
    expect(calls.some((c) => c.url.endsWith("/run"))).toBe(false);
    process.exit = origExit;
  });

  it("rm resolves a prefix then DELETEs the full id", async () => {
    stubFetch(() => ({ tasks }));
    await runCli("rm", "bbbb");
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.url.endsWith("/tasks/bbbb2222-full")).toBe(true);
  });
});

describe("ccmux task list", () => {
  it("GETs /tasks", async () => {
    stubFetch(() => ({ tasks: [] }));
    await runCli("list");
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(calls[0].url.endsWith("/tasks")).toBe(true);
  });
});
