import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setNowForTests } from "../lib/task-store";
import { TaskManager, type TaskManagerEvent } from "./task-manager";
import type { TaskInstance } from "../lib/task";
import { WorktreeError } from "../lib/worktree";
import { taskEventToSSE } from "./server";

const savedStateHome = process.env.CCMUX_STATE_HOME;
const savedConfigHome = process.env.CCMUX_HOME;
let stateHome: string;
let configHome: string;

beforeEach(() => {
  stateHome = mkdtempSync(join(tmpdir(), "ccmux-tm-state-"));
  configHome = mkdtempSync(join(tmpdir(), "ccmux-tm-config-"));
  process.env.CCMUX_STATE_HOME = stateHome;
  process.env.CCMUX_HOME = configHome;
  setNowForTests(() => "2024-01-15T12:00:00Z");
  // Note: getPreferences() reads PREFS_FILE, frozen at import to the real
  // config dir (the CCMUX_HOME override above only affects call-time state
  // paths). These tests assert the manager *routes through* resolveTask — the
  // built-in target default and target validation — which holds for any
  // config without task keys. The full multi-layer cascade fold is unit-tested
  // in task.test.ts against explicit inputs.
});

afterEach(() => {
  setNowForTests();
  rmSync(stateHome, { recursive: true, force: true });
  rmSync(configHome, { recursive: true, force: true });
  if (savedStateHome === undefined) delete process.env.CCMUX_STATE_HOME;
  else process.env.CCMUX_STATE_HOME = savedStateHome;
  if (savedConfigHome === undefined) delete process.env.CCMUX_HOME;
  else process.env.CCMUX_HOME = savedConfigHome;
});

const body = { project: "p", agent: "claude", prompt: "hi" };

describe("TaskManager lifecycle events", () => {
  it("emits created on create", async () => {
    const tm = new TaskManager();
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    const task = await tm.create(body);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "created", task });
  });

  it("emits updated on status change and returns the instance", async () => {
    const tm = new TaskManager();
    const created = await tm.create(body);
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    const updated = await tm.updateStatus(created.id, "running");
    expect(updated?.status).toBe("running");
    expect(events).toEqual([{ kind: "updated", task: updated! }]);
  });

  it("update-missing returns undefined and emits nothing", async () => {
    const tm = new TaskManager();
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    expect(await tm.updateStatus("nope", "done")).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  it("emits removed on delete", async () => {
    const tm = new TaskManager();
    const created = await tm.create(body);
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    await tm.delete(created.id);
    expect(events).toEqual([{ kind: "removed", id: created.id }]);
    expect(await tm.get(created.id)).toBeUndefined();
  });

  it("a throwing subscriber does not break the mutation", async () => {
    const tm = new TaskManager();
    tm.on("change", () => {
      throw new Error("subscriber boom");
    });

    const task = await tm.create(body);
    // Persistence completed despite the throwing listener.
    expect(await tm.get(task.id)).toEqual(task);
  });

  it("accepts a resolved new-session target", async () => {
    const tm = new TaskManager();
    const task = await tm.create({ ...body, target: "new-session" });
    expect(task.target).toBe("new-session");
    expect(await tm.list()).toHaveLength(1);
  });

  it("applies the built-in target default via the cascade", async () => {
    const tm = new TaskManager();
    const task = await tm.create(body);
    // No config/template: resolveTask fills target with the built-in default.
    expect(task.target).toBe("new-window");
  });
});

describe("TaskManager.run + correlation", () => {
  it("run records paneId + status running and emits updated", async () => {
    const tm = new TaskManager({ launch: async () => ({ paneId: "%42" }) });
    const created = await tm.create(body);
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    const ran = await tm.run(created.id);
    expect(ran?.status).toBe("running");
    expect(ran?.paneId).toBe("%42");
    expect(events).toEqual([{ kind: "updated", task: ran! }]);
  });

  it("correlateSession links the pending pane and emits updated", async () => {
    const tm = new TaskManager({ launch: async () => ({ paneId: "%42" }) });
    const created = await tm.create(body);
    await tm.run(created.id);
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    await tm.correlateSession("%42", "sess-9");
    const linked = await tm.get(created.id);
    expect(linked?.sessionId).toBe("sess-9");
    expect(events).toEqual([{ kind: "updated", task: linked! }]);
  });

  it("correlateSession is a no-op for an unrelated pane", async () => {
    const tm = new TaskManager({ launch: async () => ({ paneId: "%42" }) });
    const created = await tm.create(body);
    await tm.run(created.id);
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    await tm.correlateSession("%99", "sess-x");
    expect(events).toHaveLength(0);
    expect((await tm.get(created.id))?.sessionId).toBeUndefined();
  });

  it("correlateSession drains the pending entry (only links once)", async () => {
    const tm = new TaskManager({ launch: async () => ({ paneId: "%42" }) });
    const created = await tm.create(body);
    await tm.run(created.id);

    await tm.correlateSession("%42", "sess-a");
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));
    await tm.correlateSession("%42", "sess-b"); // pane already drained
    expect(events).toHaveLength(0);
    expect((await tm.get(created.id))?.sessionId).toBe("sess-a");
  });

  it("run of a missing id returns undefined", async () => {
    const tm = new TaskManager({ launch: async () => ({ paneId: "%1" }) });
    expect(await tm.run("nope")).toBeUndefined();
  });

  it("send-to-existing registers targetRef for correlation", async () => {
    const tm = new TaskManager({ launch: async () => ({}) });
    const created = await tm.create({
      ...body,
      target: "send-to-existing",
      targetRef: "%5",
    });
    await tm.run(created.id);
    await tm.correlateSession("%5", "sess-t");
    expect((await tm.get(created.id))?.sessionId).toBe("sess-t");
  });
});

describe("TaskManager nativeSessionId capture + teardown", () => {
  async function linkedTask() {
    const tm = new TaskManager({ launch: async () => ({ paneId: "%1" }) });
    const created = await tm.create(body);
    await tm.run(created.id);
    return { tm, id: created.id };
  }

  it("captures nativeSessionId at first bind", async () => {
    const { tm, id } = await linkedTask();
    await tm.correlateSession("%1", "sess", "native-abc");
    const t = await tm.get(id);
    expect(t?.sessionId).toBe("sess");
    expect(t?.nativeSessionId).toBe("native-abc");
  });

  it("refreshes nativeSessionId on a later update when it changed (emit once)", async () => {
    const { tm, id } = await linkedTask();
    await tm.correlateSession("%1", "sess"); // bind, native not yet known
    expect((await tm.get(id))?.nativeSessionId).toBeUndefined();

    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));
    await tm.correlateSession("%1", "sess", "native-late"); // arrives later
    expect((await tm.get(id))?.nativeSessionId).toBe("native-late");
    expect(events).toHaveLength(1);

    // No change → no emit.
    events.length = 0;
    await tm.correlateSession("%1", "sess", "native-late");
    expect(events).toHaveLength(0);
  });

  it("onSessionRemoved stops a linked running task, keeping nativeSessionId", async () => {
    const { tm, id } = await linkedTask();
    await tm.correlateSession("%1", "sess", "native-abc");
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    await tm.onSessionRemoved("sess");
    const t = await tm.get(id);
    expect(t?.status).toBe("stopped");
    expect(t?.nativeSessionId).toBe("native-abc");
    expect(events).toEqual([{ kind: "updated", task: t! }]);
  });

  it("onSessionRemoved is a no-op for an unlinked session", async () => {
    const { tm, id } = await linkedTask();
    await tm.correlateSession("%1", "sess", "native-abc");
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));
    await tm.onSessionRemoved("other-sess");
    expect(events).toHaveLength(0);
    expect((await tm.get(id))?.status).toBe("running");
  });

  it("onSessionRemoved does not override a non-running (done) task", async () => {
    const { tm, id } = await linkedTask();
    await tm.correlateSession("%1", "sess", "native-abc");
    await tm.updateStatus(id, "done");
    await tm.onSessionRemoved("sess");
    expect((await tm.get(id))?.status).toBe("done");
  });
});

describe("TaskManager.resume", () => {
  // Build a stopped, correlated task ready to resume.
  async function stoppedTask(
    launch: (
      t: TaskInstance,
      opts?: { resume?: boolean; prompt?: string },
    ) => Promise<{ paneId?: string }>,
  ) {
    const tm = new TaskManager({ launch });
    const created = await tm.create(body);
    await tm.run(created.id);
    await tm.correlateSession("%42", "sess", "nat-1");
    await tm.onSessionRemoved("sess");
    return { tm, id: created.id };
  }

  it("resumes a stopped task → running with the new pane, threading the follow-up", async () => {
    const calls: Array<{ resume?: boolean; prompt?: string } | undefined> = [];
    const launch = async (_t: unknown, opts?: { resume?: boolean; prompt?: string }) => {
      calls.push(opts);
      return { paneId: opts?.resume ? "%99" : "%42" };
    };
    const { tm, id } = await stoppedTask(launch);
    expect((await tm.get(id))?.status).toBe("stopped");

    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));
    const resumed = await tm.resume(id, "keep going");

    expect(resumed?.status).toBe("running");
    expect(resumed?.paneId).toBe("%99");
    expect(resumed?.nativeSessionId).toBe("nat-1"); // preserved
    expect(calls.at(-1)).toEqual({ resume: true, prompt: "keep going" });
    expect(events).toEqual([{ kind: "updated", task: resumed! }]);
  });

  it("resumes a done task that retains a nativeSessionId → running", async () => {
    const launch = async (_t: unknown, opts?: { resume?: boolean }) => ({
      paneId: opts?.resume ? "%99" : "%42",
    });
    const { tm, id } = await stoppedTask(launch);
    await tm.updateStatus(id, "done"); // mark it done (keeps nativeSessionId)
    expect((await tm.get(id))?.status).toBe("done");

    const resumed = await tm.resume(id);
    expect(resumed?.status).toBe("running");
    expect(resumed?.paneId).toBe("%99");
    expect(resumed?.nativeSessionId).toBe("nat-1");
  });

  it("rejects resuming a task that is neither stopped nor done", async () => {
    const tm = new TaskManager({ launch: async () => ({ paneId: "%42" }) });
    const created = await tm.create(body);
    await tm.run(created.id); // running, not stopped/done
    await expect(tm.resume(created.id)).rejects.toThrow(/not stopped or done/);
  });

  it("returns undefined for an unknown id", async () => {
    const tm = new TaskManager({ launch: async () => ({ paneId: "%1" }) });
    expect(await tm.resume("nope")).toBeUndefined();
  });

  it("propagates a launcher rejection (non-resumable / no native id)", async () => {
    const launch = async (_t: unknown, opts?: { resume?: boolean }) => {
      if (opts?.resume) throw new Error("agent does not support resume");
      return { paneId: "%42" };
    };
    const { tm, id } = await stoppedTask(launch);
    await expect(tm.resume(id)).rejects.toThrow(/does not support resume/);
  });
});

describe("TaskManager.run background", () => {
  const bgBody = {
    project: "p",
    agent: "claude",
    prompt: "hi",
    target: "background" as const,
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("dispatches to the invoke bridge, records invocationId, and stays running", async () => {
    const invoke = async () => ({
      invocationId: "inv_abc",
      result: Promise.resolve({
        success: true as const,
        invocationId: "inv_abc",
        text: "",
        durationMs: 1,
      }),
    });
    const tm = new TaskManager({ invoke });
    const created = await tm.create(bgBody);
    const ran = await tm.run(created.id);
    expect(ran?.status).toBe("running");
    expect(ran?.invocationId).toBe("inv_abc");
    expect(ran?.paneId).toBeUndefined();
  });

  it("patches done when the invocation resolves successfully", async () => {
    const invoke = async () => ({
      invocationId: "inv_ok",
      result: Promise.resolve({
        success: true as const,
        invocationId: "inv_ok",
        text: "",
        durationMs: 1,
      }),
    });
    const tm = new TaskManager({ invoke });
    const created = await tm.create(bgBody);
    await tm.run(created.id);
    await flush();
    expect((await tm.get(created.id))?.status).toBe("done");
  });

  it("patches failed when the invocation resolves with failure", async () => {
    const invoke = async () => ({
      invocationId: "inv_bad",
      result: Promise.resolve({
        success: false as const,
        invocationId: "inv_bad",
        kind: "agent_error" as const,
        message: "boom",
      }),
    });
    const tm = new TaskManager({ invoke });
    const created = await tm.create(bgBody);
    await tm.run(created.id);
    await flush();
    expect((await tm.get(created.id))?.status).toBe("failed");
  });

  it("a non-invokable agent throws and leaves the task not-running", async () => {
    const invoke = async () => {
      throw new Error("agent does not support invoke (no invokeMode)");
    };
    const tm = new TaskManager({ invoke });
    const created = await tm.create(bgBody);
    await expect(tm.run(created.id)).rejects.toThrow(/invokeMode/);
    expect((await tm.get(created.id))?.status).toBe("pending");
  });
});

describe("taskEventToSSE mapper", () => {
  const task = {
    id: "t1",
    project: "p",
    target: "new-window" as const,
    agent: "claude",
    prompt: "hi",
    status: "pending" as const,
    createdAt: "2024-01-15T12:00:00Z",
    updatedAt: "2024-01-15T12:00:00Z",
  };

  it("maps created -> task_created carrying the task", () => {
    const sse = taskEventToSSE({ kind: "created", task });
    expect(sse.type).toBe("task_created");
    expect(sse).toMatchObject({ type: "task_created", task });
  });

  it("maps updated -> task_updated carrying the task", () => {
    const sse = taskEventToSSE({ kind: "updated", task });
    expect(sse).toMatchObject({ type: "task_updated", task });
  });

  it("maps removed -> task_removed carrying the id", () => {
    const sse = taskEventToSSE({ kind: "removed", id: "t1" });
    expect(sse).toMatchObject({ type: "task_removed", id: "t1" });
  });
});

describe("TaskManager.edit", () => {
  it("edits a pending task and emits updated", async () => {
    const tm = new TaskManager();
    const created = await tm.create(body);
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    const res = await tm.edit(created.id, { name: "renamed" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.task.name).toBe("renamed");
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("updated");
  });

  it("rejects editing a non-pending task with not-pending (no event)", async () => {
    const tm = new TaskManager();
    const created = await tm.create(body);
    await tm.updateStatus(created.id, "running");
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    const res = await tm.edit(created.id, { name: "nope" });
    expect(res).toEqual({ ok: false, reason: "not-pending" });
    expect(events).toHaveLength(0);
  });

  it("rejects an invalid merge with invalid", async () => {
    const tm = new TaskManager();
    const created = await tm.create(body);
    const res = await tm.edit(created.id, { target: "bogus" as never });
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("returns not-found for an unknown id", async () => {
    const tm = new TaskManager();
    const res = await tm.edit("nope", { name: "x" });
    expect(res).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("TaskManager worktree persistence + block gate", () => {
  it("persists resolved worktreePath/branch from the launch result on run", async () => {
    const tm = new TaskManager({
      launch: async () => ({
        paneId: "%7",
        worktreePath: "/bare/feature-x",
        branch: "feature-x",
      }),
    });
    const created = await tm.create({ ...body, worktree: true });
    const ran = await tm.run(created.id);
    expect(ran?.status).toBe("running");
    expect(ran?.worktreePath).toBe("/bare/feature-x");
    expect(ran?.branch).toBe("feature-x");
  });

  it("a non-wtm block leaves the task pending and emits no running/failed", async () => {
    const tm = new TaskManager({
      launch: async () => {
        throw new WorktreeError("not-wtm", "not wtm-managed — run wtm-init");
      },
    });
    const created = await tm.create({ ...body, worktree: true });
    const events: TaskManagerEvent[] = [];
    tm.on("change", (e: TaskManagerEvent) => events.push(e));

    const err = await tm.run(created.id).catch((e) => e);
    expect(err).toBeInstanceOf(WorktreeError);
    // Status untouched — still pending, never running/failed.
    expect((await tm.get(created.id))?.status).toBe("pending");
    expect(events).toHaveLength(0);
  });

  it("the same task runs after the repo becomes wtm-managed", async () => {
    let blocked = true;
    const tm = new TaskManager({
      launch: async () => {
        if (blocked) throw new WorktreeError("not-wtm", "run wtm-init");
        return { paneId: "%9", worktreePath: "/bare/x", branch: "x" };
      },
    });
    const created = await tm.create({ ...body, worktree: true });
    await tm.run(created.id).catch(() => {});
    expect((await tm.get(created.id))?.status).toBe("pending");

    blocked = false; // dev ran wtm-init
    const ran = await tm.run(created.id);
    expect(ran?.status).toBe("running");
    expect(ran?.worktreePath).toBe("/bare/x");
  });
});
