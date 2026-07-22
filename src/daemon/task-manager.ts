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
import type { InvokeResult } from "./invokers/types";

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

/**
 * Dispatches a `background` task to the invoke subsystem. Returns the minted
 * `invocationId` synchronously (well, once the input is built) and a `result`
 * promise that resolves when the invocation completes. Throws for a
 * non-invokable agent so `run` can surface a 400 without marking the task
 * running. Injected so `run` is testable without the invoke subsystem.
 */
export type TaskInvokeFn = (
  task: TaskInstance,
) => Promise<{ invocationId: string; result: Promise<InvokeResult> }>;

export class TaskManager extends EventEmitter {
  private launch: TaskLaunchFn;
  private invoke: TaskInvokeFn;
  /**
   * paneId → taskId for tasks launched-but-not-yet-correlated. Drained on the
   * first matching session event so the hot session path is a `Map.get`, never
   * a store scan.
   */
  private pendingCorrelation = new Map<string, string>();

  constructor(deps: { launch?: TaskLaunchFn; invoke?: TaskInvokeFn } = {}) {
    super();
    this.launch =
      deps.launch ??
      (() => {
        throw new Error("TaskManager: launcher not configured");
      });
    this.invoke =
      deps.invoke ??
      (() => {
        throw new Error("TaskManager: invoke bridge not configured");
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
    if (task.target === "background") return this.runBackground(id, task);
    return this.runInteractive(id, task);
  }

  /** Launch into a pane and register the pane for session correlation. */
  private async runInteractive(
    id: string,
    task: TaskInstance,
  ): Promise<TaskInstance | undefined> {
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
   * Dispatch a headless task to the invoke subsystem. Records the
   * `invocationId`, stays `running`, and patches `done`/`failed` when the
   * invocation resolves (asynchronously — the run response doesn't block on
   * completion). A non-invokable agent throws before anything is marked running.
   */
  private async runBackground(
    id: string,
    task: TaskInstance,
  ): Promise<TaskInstance | undefined> {
    const handle = await this.invoke(task); // throws for non-invokable → 400

    const updated = await patchTask(id, {
      status: "running",
      invocationId: handle.invocationId,
    });
    if (!updated) return undefined;

    // Settle status when the invocation completes, without blocking the run.
    void handle.result
      .then((res) => this.finishBackground(id, res.success ? "done" : "failed"))
      .catch(() => this.finishBackground(id, "failed"));

    this.safeEmit({ kind: "updated", task: updated });
    return updated;
  }

  private async finishBackground(
    id: string,
    status: TaskStatus,
  ): Promise<void> {
    const t = await patchTask(id, { status });
    if (t) this.safeEmit({ kind: "updated", task: t });
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
