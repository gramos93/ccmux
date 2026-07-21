/**
 * Daemon-side lifecycle wrapper over the task store (`src/lib/task-store.ts`).
 *
 * The store stays the sole persistence layer; this manager adds the one thing
 * SSE needs — a discriminated `"change"` event emitted after every successful
 * mutation — so the server can stay dumb transport that maps the event to an
 * `SSEEvent` and broadcasts it. Modeled on `InvocationManager`: manager owns
 * the lifecycle event, server owns the wire.
 *
 * No in-memory index: the per-file store is the source of truth and reads are
 * cheap at this scale. See `openspec/changes/add-daemon-tasks-api` (D1).
 */
import { EventEmitter } from "events";
import { getPreferences } from "../lib/preferences";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTaskStatus,
} from "../lib/task-store";
import {
  resolveTask,
  type TaskInstance,
  type TaskSpec,
  type TaskStatus,
} from "../lib/task";

/** Discriminated lifecycle event emitted on `"change"` after each mutation. */
export type TaskManagerEvent =
  | { kind: "created"; task: TaskInstance }
  | { kind: "updated"; task: TaskInstance }
  | { kind: "removed"; id: string };

/** Body accepted by {@link TaskManager.create}: the project + optional template
 *  select the cascade layers; remaining fields are the creation-time input. */
export type CreateTaskBody = { project: string; template?: string } & Partial<
  Omit<TaskSpec, "project">
>;

export class TaskManager extends EventEmitter {
  /** All persisted task instances. */
  list(): Promise<TaskInstance[]> {
    return listTasks();
  }

  /** A single instance by id, or undefined. */
  get(id: string): Promise<TaskInstance | undefined> {
    return getTask(id);
  }

  /**
   * Resolve the default cascade server-side (global defaults → per-project
   * override → named template → request input) from the daemon's loaded
   * preferences, persist the validated task, and emit `created`.
   *
   * @throws Error from `validateNewTask` (e.g. reserved `new-session` target).
   */
  async create(body: CreateTaskBody): Promise<TaskInstance> {
    const { project, template, ...input } = body;
    const prefs = await getPreferences();
    const resolved = resolveTask(
      {
        defaults: prefs.defaults,
        projects: prefs.projects,
        templates: prefs.templates,
      },
      { project, template, input },
    );
    const task = await createTask(resolved);
    this.safeEmit({ kind: "created", task });
    return task;
  }

  /**
   * Update an instance's status. Emits `updated` and returns the instance when
   * it exists; returns undefined (and emits nothing) when it does not.
   */
  async updateStatus(
    id: string,
    status: TaskStatus,
  ): Promise<TaskInstance | undefined> {
    const task = await updateTaskStatus(id, status);
    if (task) this.safeEmit({ kind: "updated", task });
    return task;
  }

  /** Delete an instance (idempotent) and emit `removed`. */
  async delete(id: string): Promise<void> {
    await deleteTask(id);
    this.safeEmit({ kind: "removed", id });
  }

  /**
   * Emit `"change"` without letting a throwing subscriber (e.g. the SSE
   * broadcast handler) escape the mutation — persistence has already
   * completed by the time we emit. Mirrors `InvocationManager.safeEmit`.
   */
  private safeEmit(event: TaskManagerEvent): void {
    try {
      this.emit("change", event);
    } catch (err) {
      console.error("[task-manager] change listener threw:", err);
    }
  }
}
