import { basename } from "path";
import type { EnrichedSession } from "../../types";
import type { TaskInstance, TaskTarget } from "../../lib/task";
import { DEFAULT_TASK_TARGET, resolveTask } from "../../lib/task";
import { getPreferencesSync } from "../../lib/preferences";
import { getAgents } from "../../lib/agents";

/**
 * The pane-placement targets offered by the create form's `target` cycle.
 * `background` is not in this list — it is expressed by the separate
 * `background` toggle (sugar for the CLI's `--bg`), so the effective target
 * sent to the daemon is `background ? "background" : target`.
 */
export const PANE_TARGETS: TaskTarget[] = [
  "new-window",
  "split",
  "send-to-existing",
];

/** A focusable field in the create form, in display order (target-ref is
 *  conditionally present — see {@link visibleCreateFieldsFor}). */
export type CreateField =
  | "agent"
  | "project"
  | "target"
  | "targetRef"
  | "template"
  | "prompt"
  | "background"
  | "runNow";

/** The editable state of the create form. */
export interface CreateFormState {
  agent: string;
  project: string;
  /** One of {@link PANE_TARGETS}; the headless case is carried by `background`. */
  target: TaskTarget;
  /** tmux pane for split/send-to-existing; "" when none/not applicable. */
  targetRef: string;
  /** Template name, or "" for none. */
  template: string;
  prompt: string;
  /** Headless invoke (maps to effective target `background`). */
  background: boolean;
  /** Run the task immediately after creating it. */
  runNow: boolean;
}

/** A live session offered as a target-ref choice. */
export interface CreateSessionOption {
  pane: string;
  label: string;
}

/** The choice lists a form is built from, sourced from local config + live
 *  sessions at open time (no daemon round-trip). */
export interface CreateOptions {
  agents: string[];
  templates: string[];
  projects: string[];
  sessions: CreateSessionOption[];
  /** Whether each template supplies a prompt (so the form can be valid with
   *  an empty prompt when such a template is selected). */
  templateHasPrompt: Record<string, boolean>;
}

/** De-dupe while preserving first-seen order. */
function uniq(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

/**
 * Build the create form's choice lists from local preferences, the built-in
 * agent registry, and the current live sessions. Reads `getPreferencesSync()`
 * (no async, cheap) so the modal can open synchronously.
 */
export function buildCreateOptions(
  liveSessions: EnrichedSession[],
  defaultProject: string,
): CreateOptions {
  const prefs = getPreferencesSync();
  const agents = getAgents(prefs).map((a) => a.name);
  const templates = Object.keys(prefs.templates ?? {});
  const templateHasPrompt: Record<string, boolean> = {};
  for (const [name, tpl] of Object.entries(prefs.templates ?? {})) {
    templateHasPrompt[name] = Boolean(tpl.prompt && tpl.prompt.length > 0);
  }

  // Project candidates: the contextual default first, then config projects,
  // then the distinct cwds of live sessions.
  const projects = uniq([
    defaultProject,
    ...Object.keys(prefs.projects ?? {}),
    ...liveSessions.map((s) => s.cwd),
  ]);

  const sessions: CreateSessionOption[] = liveSessions
    .filter((s) => s.tmuxPane)
    .map((s) => ({
      pane: s.tmuxPane!,
      label: `${s.tmuxPane} ${s.agentType} ${basename(s.cwd)}`,
    }));

  return { agents, templates, projects, sessions, templateHasPrompt };
}

/**
 * Seed the initial form for a project via the same default cascade the daemon
 * resolves (`defaults → projects[project] → templates`). A config default of
 * `target: "background"` is expressed as `background: true` with a pane-target
 * fallback, since the form's `target` cycle covers only the pane placements.
 */
export function buildInitialForm(
  options: CreateOptions,
  defaultProject: string,
): CreateFormState {
  const prefs = getPreferencesSync();
  const resolved = resolveTask(
    {
      defaults: prefs.defaults,
      projects: prefs.projects,
      templates: prefs.templates,
    },
    { project: defaultProject, input: {} },
  );

  const resolvedTarget = resolved.target ?? DEFAULT_TASK_TARGET;
  const background = resolvedTarget === "background";
  const target: TaskTarget = background ? DEFAULT_TASK_TARGET : resolvedTarget;

  return {
    agent: resolved.agent ?? options.agents[0] ?? "claude",
    project: defaultProject || options.projects[0] || "",
    target,
    targetRef: "",
    template: "",
    prompt: resolved.prompt ?? "",
    background,
    runNow: true,
  };
}

/** The visible, focusable fields for a form state (target-ref only shows for
 *  pane split/send-to-existing and never in background mode). */
export function visibleCreateFieldsFor(form: CreateFormState): CreateField[] {
  const fields: CreateField[] = ["agent", "project", "target"];
  if (
    !form.background &&
    (form.target === "split" || form.target === "send-to-existing")
  ) {
    fields.push("targetRef");
  }
  fields.push("template", "prompt", "background", "runNow");
  return fields;
}

/** The request body a create form submits to `POST /tasks`. Unset fields are
 *  omitted so the daemon's default cascade still applies. `background` collapses
 *  into `target`; `runNow` is handled by the caller (a follow-up run), not here. */
export interface CreateBody {
  project: string;
  agent?: string;
  prompt?: string;
  template?: string;
  target: TaskTarget;
  targetRef?: string;
}

/** Shape a create form into the `POST /tasks` body (pure). */
export function buildCreateBody(form: CreateFormState): CreateBody {
  const target: TaskTarget = form.background ? "background" : form.target;
  const needsRef = target === "split" || target === "send-to-existing";
  const body: CreateBody = { project: form.project, target };
  if (form.agent) body.agent = form.agent;
  if (form.prompt.trim()) body.prompt = form.prompt;
  if (form.template) body.template = form.template;
  if (needsRef && form.targetRef) body.targetRef = form.targetRef;
  return body;
}

/** What activating (Enter on) a task row should do. `run` starts a pending
 *  task, `resume` re-attaches a stopped one, `jump` switches to a running
 *  task's linked session, `none` is a no-op (e.g. done/failed, or running with
 *  no session). Pure so the decision is unit-testable apart from the fetch. */
export type TaskActivation =
  | { kind: "run"; id: string }
  | { kind: "resume"; id: string }
  | { kind: "jump"; sessionId: string }
  | { kind: "none" };

export function resolveTaskActivation(task: TaskInstance): TaskActivation {
  if (task.status === "pending") return { kind: "run", id: task.id };
  if (task.status === "stopped") return { kind: "resume", id: task.id };
  if (task.status === "running" && task.sessionId) {
    return { kind: "jump", sessionId: task.sessionId };
  }
  return { kind: "none" };
}

/** The option list a cyclable field cycles through (empty for text/toggle
 *  fields, which are handled separately). */
export function cycleOptionsFor(
  field: CreateField,
  options: CreateOptions,
): string[] {
  switch (field) {
    case "agent":
      return options.agents;
    case "project":
      return options.projects;
    case "target":
      return PANE_TARGETS;
    case "targetRef":
      return options.sessions.map((s) => s.pane);
    case "template":
      return ["", ...options.templates];
    default:
      return [];
  }
}
