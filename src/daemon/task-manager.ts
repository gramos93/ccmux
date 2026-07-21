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
  patchTask,
  updateTaskStatus,
} from "../lib/task-store";
import {
  resolveTask,
  type TaskInstance,
  type TaskSpec,
  type TaskStatus,
} from "../lib/task";
import type { LaunchResult } from "./task-launcher";

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

/** Launches a task into a pane; injected so `run` is testable without tmux. */
export type TaskLaunchFn = (task: TaskInstance) => Promise<LaunchResult>;

export class TaskManager extends EventEmitter {
  private launch: TaskLaunchFn;
  /**
   * paneId → taskId for tasks launched-but-not-yet-correlated. Drained on the
   * first matching session event so the hot session path is a `Map.get`, never
   * a store scan.
   */
  private pendingCorrelation = new Map<string, string>();

  constructor(deps: { launch?: TaskLaunchFn } = {}) {
    super();
    this.launch =
      deps.launch ??
      (() => {
        throw new Error("TaskManager: launcher not configured");
      });
  }

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
   * Launch a task into a pane per its target, record the created pane id (for
   * `new-window`/`split`), set status `running`, and register the pane for
   * session correlation. Returns the updated instance, or undefined when the
   * task does not exist. Propagates the launcher's error (unsupported target,
   * missing `targetRef`, tmux failure) for the caller to map to `400`.
   */
  async run(id: string): Promise<TaskInstance | undefined> {
    const task = await this.get(id);
    if (!task) return undefined;

    const result = await this.launch(task);

    const updated = await patchTask(id, {
      status: "running",
      ...(result.paneId ? { paneId: result.paneId } : {}),
    });
    if (!updated) return undefined;

    // Register the pane whose session we await. For created panes that's the
    // new pane id; for send-to-existing it's the referenced pane (its session
    // links on that pane's next event).
    const correlationPane = result.paneId ?? task.targetRef;
    if (correlationPane) this.pendingCorrelation.set(correlationPane, id);

    this.safeEmit({ kind: "updated", task: updated });
    return updated;
  }

  /**
   * Link a session to a launched task when the session binds the pane the task
   * was launched into. Drains the pending entry on first match. No-op when the
   * pane matches no launched task. Called off the session-event path (see
   * `backfillTaskLink`), so the common case is a single `Map.get`.
   */
  async correlateSession(
    paneId: string | null,
    sessionId: string,
  ): Promise<void> {
    if (!paneId) return;
    const taskId = this.pendingCorrelation.get(paneId);
    if (!taskId) return;
    this.pendingCorrelation.delete(paneId);
    const updated = await patchTask(taskId, { sessionId });
    if (updated) this.safeEmit({ kind: "updated", task: updated });
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
