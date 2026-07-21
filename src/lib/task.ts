/**
 * The `Task` primitive: one schema, two lifecycles.
 *
 * A **template** is a `Task`-shaped preset stored in config
 * (`Preferences.templates[name]`) with the instance-only fields (`id`,
 * timestamps, `status`) absent — modeled as `TaskTemplate`.
 * An **instance** is the same field set with those fields required, persisted
 * in the state home (`~/.ccmux/tasks/<id>.json`) — modeled as `TaskInstance`.
 *
 * This slice is pure data: types, validation, and the default-cascade
 * resolver. No daemon, HTTP/SSE, TUI, or tmux spawning. See
 * `openspec/changes/add-task-store`.
 */

/** Where a launched task's agent runs. `new-session` is reserved for a later
 *  slice and is intentionally NOT part of the accepted set yet. */
export type TaskTarget = "new-window" | "split" | "send-to-existing";

/** Lifecycle status of a task instance. */
export type TaskStatus = "pending" | "running" | "done" | "failed";

export const VALID_TASK_TARGETS: TaskTarget[] = [
  "new-window",
  "split",
  "send-to-existing",
];

export const VALID_TASK_STATUSES: TaskStatus[] = [
  "pending",
  "running",
  "done",
  "failed",
];

/** Built-in fallback applied when the cascade leaves `target` unset. */
export const DEFAULT_TASK_TARGET: TaskTarget = "new-window";

/** Built-in status a freshly created instance starts in. */
export const DEFAULT_TASK_STATUS: TaskStatus = "pending";

/**
 * Worktree intent for a task. `false`/absent = no worktree; `true` = a
 * worktree with defaulted naming; the object form names the branch and/or
 * base for the worktree created in a later slice. Actual worktree creation is
 * out of scope for this change — this only carries the intent.
 */
export type TaskWorktree = boolean | { branch?: string; base?: string };

/**
 * The field set shared by templates and instances. A slash-command, when
 * present, lives inside `prompt` — it is not a separate field.
 */
export interface TaskSpec {
  /** Project the task runs in (repo root / project key). */
  project: string;
  /** Where the agent runs. */
  target: TaskTarget;
  /** Agent name (e.g. `claude`, `codex`). */
  agent: string;
  /** The prompt handed to the agent (may embed a leading slash-command). */
  prompt: string;
  /**
   * The tmux pane/session a `split` or `send-to-existing` target acts on.
   * Modeled and persisted now; behavior is enforced by the later spawn slice,
   * where `send-to-existing` will require it. `new-window` ignores it.
   */
  targetRef?: string;
  /** Worktree intent; see {@link TaskWorktree}. */
  worktree?: TaskWorktree;
}

/** A persistent preset: every field optional. */
export type TaskTemplate = Partial<TaskSpec>;

/** An ephemeral, persisted task with identity, timestamps, and status. */
export interface TaskInstance extends TaskSpec {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: TaskStatus;
}

/**
 * Validate a resolved spec at creation time and narrow it to a full
 * {@link TaskSpec}. Rejects the reserved `new-session` target, any unknown
 * target, and missing required fields. Validation is deliberately minimal
 * (consistent with ccmux treating config as loosely validated); it does not
 * police `targetRef`/`worktree` shapes.
 *
 * @throws Error when the spec is not a valid new task.
 */
export function validateNewTask(spec: Partial<TaskSpec>): TaskSpec {
  const { project, target, agent, prompt } = spec;

  if (target === undefined) {
    throw new Error("Task target is required");
  }
  if ((target as string) === "new-session") {
    throw new Error(
      "Task target 'new-session' is reserved and not yet supported",
    );
  }
  if (!VALID_TASK_TARGETS.includes(target)) {
    throw new Error(`Unknown task target: ${String(target)}`);
  }
  if (!project) throw new Error("Task project is required");
  if (!agent) throw new Error("Task agent is required");
  if (!prompt) throw new Error("Task prompt is required");

  return {
    project,
    target,
    agent,
    prompt,
    ...(spec.targetRef !== undefined ? { targetRef: spec.targetRef } : {}),
    ...(spec.worktree !== undefined ? { worktree: spec.worktree } : {}),
  };
}

/** Sources for the default cascade. Structurally a subset of `Preferences`. */
export interface TaskResolveConfig {
  /** Global task defaults. */
  defaults?: Partial<TaskSpec>;
  /** Per-project overrides, keyed by project. */
  projects?: Record<string, Partial<TaskSpec>>;
  /** Named templates. */
  templates?: Record<string, TaskTemplate>;
}

export interface TaskResolveInput {
  /** Project the task is for; selects the per-project override layer. */
  project: string;
  /** Optional named template to apply. */
  template?: string;
  /** Creation-time input; the highest-priority layer. */
  input?: Partial<TaskSpec>;
}

/**
 * Resolve a concrete task spec from the ordered layers, later layers
 * overriding earlier ones per-field:
 *
 *   global `defaults` → `projects[project]` → `templates[template]` → `input`
 *
 * Pure (no I/O). The built-in `target` fallback applies only when the fold
 * leaves it unset. No per-project or template configuration is required —
 * sensible defaults suffice.
 */
export function resolveTask(
  config: TaskResolveConfig,
  { project, template, input }: TaskResolveInput,
): Partial<TaskSpec> {
  const layers: Array<Partial<TaskSpec> | undefined> = [
    config.defaults,
    config.projects?.[project],
    template ? config.templates?.[template] : undefined,
    { project },
    input,
  ];

  const merged: Partial<TaskSpec> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }

  if (merged.target === undefined) merged.target = DEFAULT_TASK_TARGET;

  return merged;
}
