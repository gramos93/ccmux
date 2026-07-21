import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setNowForTests } from "../lib/task-store";
import { TaskManager, type TaskManagerEvent } from "./task-manager";
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
  // built-in target default and new-session rejection — which holds for any
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

  it("rejects a resolved new-session target", async () => {
    const tm = new TaskManager();
    await expect(
      tm.create({ ...body, target: "new-session" as never }),
    ).rejects.toThrow(/new-session/);
    expect(await tm.list()).toEqual([]);
  });

  it("applies the built-in target default via the cascade", async () => {
    const tm = new TaskManager();
    const task = await tm.create(body);
    // No config/template: resolveTask fills target with the built-in default.
    expect(task.target).toBe("new-window");
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
