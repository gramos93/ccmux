/**
 * Persistence for task instances: one JSON file per instance under the state
 * home (`~/.ccmux/tasks/<id>.json`). Per-file layout isolates every write (no
 * whole-map read-modify-write clobber when the daemon becomes a frequent
 * per-task status writer next slice) and mirrors ccmux's marker/job idioms.
 *
 * Reads degrade to empty: a missing dir or a malformed file never throws — a
 * bad file is skipped so the rest of the listing survives. Pure data; no
 * daemon/HTTP/TUI here. See `openspec/changes/add-task-store`.
 */
import { mkdirSync, readdirSync } from "fs";
import { unlink } from "fs/promises";
import { getTasksDir, taskFilePath } from "./config";
import {
  DEFAULT_TASK_STATUS,
  deriveTaskName,
  validateNewTask,
  type TaskInstance,
  type TaskSpec,
  type TaskStatus,
} from "./task";

/** Spec fields editable after creation (everything except identity, status,
 *  timestamps, and the correlation link fields). */
export type EditableTaskFields = Pick<
  TaskSpec,
  "name" | "prompt" | "agent" | "project" | "target" | "targetRef" | "worktree" | "command"
>;

const EDITABLE_FIELDS: (keyof EditableTaskFields)[] = [
  "name",
  "prompt",
  "agent",
  "project",
  "target",
  "targetRef",
  "worktree",
  "command",
];

/**
 * Injectable clock for `createdAt`/`updatedAt`. Tests override it via
 * {@link setNowForTests} so timestamps are deterministic; production uses the
 * default. See design D7.
 */
let now: () => string = () => new Date().toISOString();

/** Override the timestamp clock (tests only). Pass no arg to reset. */
export function setNowForTests(fn?: () => string): void {
  now = fn ?? (() => new Date().toISOString());
}

/** Generate a task instance id. */
function newTaskId(): string {
  return crypto.randomUUID();
}

/** List all persisted task instances. Missing dir → empty; a malformed file is
 *  skipped rather than failing the whole listing. */
export async function listTasks(): Promise<TaskInstance[]> {
  let entries: string[];
  try {
    entries = readdirSync(getTasksDir());
  } catch {
    return [];
  }

  const tasks: TaskInstance[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const file = Bun.file(taskFilePath(entry.slice(0, -".json".length)));
      if (await file.exists()) tasks.push(await file.json());
    } catch {
      // Skip a malformed/partially-written file; the rest still list.
    }
  }
  return tasks;
}

/** Get a single instance by id, or undefined if absent/malformed. */
export async function getTask(id: string): Promise<TaskInstance | undefined> {
  try {
    const file = Bun.file(taskFilePath(id));
    if (await file.exists()) return await file.json();
  } catch {
    // Absent or malformed → undefined.
  }
  return undefined;
}

/** Persist a task instance file (lazy dir create). */
async function writeTask(task: TaskInstance): Promise<void> {
  mkdirSync(getTasksDir(), { recursive: true });
  await Bun.write(taskFilePath(task.id), JSON.stringify(task, null, 2) + "\n");
}

/**
 * Create and persist a new task instance from a resolved spec. Validates the
 * spec, assigns an id and timestamps, and starts it in the default status.
 * When the spec carries no `name`, a friendly default is derived from its
 * content so a task is never surfaced by raw id.
 */
export async function createTask(spec: Partial<TaskSpec>): Promise<TaskInstance> {
  const validated = validateNewTask(spec);
  const stamp = now();
  const task: TaskInstance = {
    ...validated,
    name: validated.name?.trim() || deriveTaskName(validated),
    id: newTaskId(),
    createdAt: stamp,
    updatedAt: stamp,
    status: DEFAULT_TASK_STATUS,
  };
  await writeTask(task);
  return task;
}

/** Outcome of {@link editTask}: the updated instance, or a typed failure so
 *  callers (the manager/HTTP layer) can map to the right status code. */
export type EditTaskResult =
  | { ok: true; task: TaskInstance }
  | { ok: false; reason: "not-found" | "invalid" };

/**
 * Edit an existing task's spec fields. Picks only the {@link EDITABLE_FIELDS}
 * from `patch`, merges them onto the stored spec, re-validates the merged
 * result with the same rules applied at creation, bumps `updatedAt`, and
 * persists. Non-spec fields (id, status, timestamps, link fields) are ignored.
 * Does NOT gate on lifecycle status — that is the task-api layer's concern.
 */
export async function editTask(
  id: string,
  patch: Partial<EditableTaskFields>,
): Promise<EditTaskResult> {
  const task = await getTask(id);
  if (!task) return { ok: false, reason: "not-found" };

  const picked: Partial<EditableTaskFields> = {};
  for (const key of EDITABLE_FIELDS) {
    if (patch[key] !== undefined) {
      (picked as Record<string, unknown>)[key] = patch[key];
    }
  }

  let validated: TaskSpec;
  try {
    validated = validateNewTask({ ...task, ...picked });
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const updated: TaskInstance = { ...task, ...validated, updatedAt: now() };
  await writeTask(updated);
  return { ok: true, task: updated };
}

/**
 * Merge a partial set of mutable instance fields into an existing task and
 * refresh `updatedAt`. Single-file read-modify-write. Returns the updated
 * instance, or undefined if it doesn't exist. All other fields are preserved.
 */
export async function patchTask(
  id: string,
  patch: Partial<
    Pick<
      TaskInstance,
      "status" | "paneId" | "sessionId" | "nativeSessionId" | "invocationId"
    >
  >,
): Promise<TaskInstance | undefined> {
  const task = await getTask(id);
  if (!task) return undefined;
  const updated: TaskInstance = { ...task, ...patch, updatedAt: now() };
  await writeTask(updated);
  return updated;
}

/**
 * Update an instance's status, refreshing `updatedAt`. Returns the updated
 * instance, or undefined if it doesn't exist. Thin wrapper over {@link patchTask}.
 */
export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<TaskInstance | undefined> {
  return patchTask(id, { status });
}

/** Delete an instance. A missing file is not an error. */
export async function deleteTask(id: string): Promise<void> {
  try {
    await unlink(taskFilePath(id));
  } catch {
    // Already gone → nothing to do.
  }
}
