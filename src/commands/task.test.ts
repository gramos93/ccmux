import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ensureDaemon must be a no-op in tests (don't spawn a daemon).
mock.module("./shared", () => ({ ensureDaemon: async () => {} }));

import { createTaskCommand } from "./task";

type Call = { url: string; method: string };
let calls: Call[];
const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string, method: string) => unknown) {
  globalThis.fetch = (async (input: string, init?: { method?: string }) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
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

describe("ccmux task CLI", () => {
  it("create --run posts create then run", async () => {
    stubFetch((url) =>
      url.endsWith("/run")
        ? { task: { id: "abc", status: "running" } }
        : { task: { id: "abc", status: "pending" } },
    );
    await runCli("create", "/repo", "--agent", "claude", "--prompt", "hi", "--run");

    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.endsWith("/tasks")).toBe(true);
    expect(calls[1].method).toBe("POST");
    expect(calls[1].url.endsWith("/tasks/abc/run")).toBe(true);
  });

  it("create without --run posts only create", async () => {
    stubFetch(() => ({ task: { id: "abc", status: "pending" } }));
    await runCli("create", "/repo");
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith("/tasks")).toBe(true);
  });

  it("list GETs /tasks", async () => {
    stubFetch(() => ({ tasks: [] }));
    await runCli("list");
    expect(calls[0]).toEqual({
      url: expect.stringContaining("/tasks") as unknown as string,
      method: "GET",
    });
  });

  it("run POSTs the run endpoint", async () => {
    stubFetch(() => ({ task: { id: "xyz", status: "running" } }));
    await runCli("run", "xyz");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.endsWith("/tasks/xyz/run")).toBe(true);
  });

  it("rm DELETEs the task", async () => {
    stubFetch(() => ({ success: true }));
    await runCli("rm", "xyz");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.endsWith("/tasks/xyz")).toBe(true);
  });
});
