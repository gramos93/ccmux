import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getTasksDir } from "./config";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  patchTask,
  setNowForTests,
  updateTaskStatus,
} from "./task-store";

const savedStateHome = process.env.CCMUX_STATE_HOME;
const savedConfigHome = process.env.CCMUX_HOME;
let stateHome: string;
let configHome: string;

const spec = {
  project: "p",
  target: "new-window" as const,
  agent: "claude",
  prompt: "hi",
};

beforeEach(() => {
  stateHome = mkdtempSync(join(tmpdir(), "ccmux-state-"));
  configHome = mkdtempSync(join(tmpdir(), "ccmux-config-"));
  process.env.CCMUX_STATE_HOME = stateHome;
  process.env.CCMUX_HOME = configHome;
  setNowForTests(() => "2024-01-15T12:00:00Z");
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

describe("task-store CRUD", () => {
  it("creates then lists an instance with id and timestamps", async () => {
    const created = await createTask(spec);
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBe("2024-01-15T12:00:00Z");
    expect(created.status).toBe("pending");

    const all = await listTasks();
    expect(all.map((t) => t.id)).toEqual([created.id]);
  });

  it("gets by id, or undefined when absent", async () => {
    const created = await createTask(spec);
    expect((await getTask(created.id))?.id).toBe(created.id);
    expect(await getTask("nope")).toBeUndefined();
  });

  it("update-status refreshes updatedAt to the injected clock value", async () => {
    const created = await createTask(spec);
    setNowForTests(() => "2024-02-20T08:30:00Z");
    const updated = await updateTaskStatus(created.id, "running");
    expect(updated?.status).toBe("running");
    expect(updated?.updatedAt).toBe("2024-02-20T08:30:00Z");
    expect(updated?.createdAt).toBe("2024-01-15T12:00:00Z");
  });

  it("update-status on a missing task returns undefined", async () => {
    expect(await updateTaskStatus("nope", "done")).toBeUndefined();
  });

  it("delete removes the instance from listings", async () => {
    const created = await createTask({ ...spec });
    await deleteTask(created.id);
    expect(await getTask(created.id)).toBeUndefined();
    expect(await listTasks()).toEqual([]);
    // Deleting again is not an error.
    await deleteTask(created.id);
  });

  it("rejects the reserved new-session target", async () => {
    await expect(
      createTask({ ...spec, target: "new-session" as never }),
    ).rejects.toThrow(/new-session/);
  });
});

describe("task-store degrade-to-empty", () => {
  it("returns empty when the tasks dir does not exist", async () => {
    expect(await listTasks()).toEqual([]);
  });

  it("skips a malformed file while listing valid ones", async () => {
    const good = await createTask(spec);
    writeFileSync(join(getTasksDir(), "broken.json"), "{ not json");
    const all = await listTasks();
    expect(all.map((t) => t.id)).toEqual([good.id]);
  });
});

describe("task-store field shapes", () => {
  it("round-trips a worktree object through create -> get", async () => {
    const created = await createTask({
      ...spec,
      worktree: { branch: "feat/x", base: "main" },
    });
    const fetched = await getTask(created.id);
    expect(fetched?.worktree).toEqual({ branch: "feat/x", base: "main" });
  });

  it("persists targetRef for a send-to-existing task", async () => {
    const created = await createTask({
      ...spec,
      target: "send-to-existing",
      targetRef: "%3",
    });
    expect((await getTask(created.id))?.targetRef).toBe("%3");
  });
});

describe("task-store patchTask", () => {
  it("merges fields, refreshes updatedAt, and preserves others", async () => {
    const created = await createTask(spec);
    setNowForTests(() => "2024-02-20T08:30:00Z");
    const patched = await patchTask(created.id, {
      paneId: "%7",
      sessionId: "sess-1",
    });
    expect(patched?.paneId).toBe("%7");
    expect(patched?.sessionId).toBe("sess-1");
    expect(patched?.updatedAt).toBe("2024-02-20T08:30:00Z");
    // Untouched fields preserved.
    expect(patched?.agent).toBe(spec.agent);
    expect(patched?.status).toBe("pending");
    expect(patched?.createdAt).toBe("2024-01-15T12:00:00Z");
  });

  it("returns undefined and persists nothing for a missing id", async () => {
    expect(await patchTask("nope", { sessionId: "x" })).toBeUndefined();
    expect(await listTasks()).toEqual([]);
  });

  it("round-trips nativeSessionId and a stopped status", async () => {
    const created = await createTask(spec);
    const patched = await patchTask(created.id, {
      status: "stopped",
      nativeSessionId: "native-abc",
    });
    expect(patched?.status).toBe("stopped");
    expect(patched?.nativeSessionId).toBe("native-abc");
    expect((await getTask(created.id))?.nativeSessionId).toBe("native-abc");
  });

  it("updateTaskStatus still works (regression)", async () => {
    const created = await createTask(spec);
    const updated = await updateTaskStatus(created.id, "running");
    expect(updated?.status).toBe("running");
  });
});

describe("task-store isolation", () => {
  it("writing the task store leaves the config dir untouched", async () => {
    await createTask(spec);
    expect(existsSync(getTasksDir())).toBe(true);
    // The store must not create anything under the config home.
    expect(existsSync(join(configHome, "state.json"))).toBe(false);
    expect(existsSync(join(configHome, "session-pids"))).toBe(false);
  });
});
