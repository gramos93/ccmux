import { readdirSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import type { EnrichedSession } from "../../types";
import type { TaskInstance, TaskTarget } from "../../lib/task";
import { DEFAULT_TASK_TARGET, resolveTask } from "../../lib/task";
import { getPreferencesSync } from "../../lib/preferences";
import { getAgents } from "../../lib/agents";

/**
 * The values the create form's `Target` field cycles through. `background`
 * is one of them (headless invoke) — it is NOT a separate toggle, so a task
 * is exactly one of these placements (mutually exclusive by construction).
 */
export const TARGET_CYCLE: TaskTarget[] = [
  "new-window",
  "split",
  "send-to-existing",
  "background",
  "new-session",
];

/** Whether a target needs a pane reference (the `Pane` field / target-ref). */
export function targetNeedsRef(target: TaskTarget): boolean {
  return target === "split" || target === "send-to-existing";
}

/** A focusable field in the create form, in display order (target-ref is
 *  conditionally present — see {@link visibleCreateFieldsFor}). */
export type CreateField =
  | "name"
  | "agent"
  | "project"
  | "target"
  | "targetRef"
  | "template"
  | "prompt"
  | "runNow";

/** The editable state of the create form. */
export interface CreateFormState {
  /** Human-readable task name; "" lets the daemon derive one from the prompt. */
  name: string;
  agent: string;
  project: string;
  /** One of {@link TARGET_CYCLE}, including the headless `background`. */
  target: TaskTarget;
  /** tmux pane for split/send-to-existing; "" when none/not applicable. */
  targetRef: string;
  /** Template name, or "" for none. */
  template: string;
  prompt: string;
  /** Run the task immediately after creating it (off = backlog/pending). */
  runNow: boolean;
}

/** A live session offered as a target-ref choice, carrying enough to filter
 *  it by project. */
export interface CreateSessionOption {
  pane: string;
  label: string;
  cwd: string;
  project: string;
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

/** De-dupe while preserving first-seen order, dropping empties. */
function uniq(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

/** Expand a leading `~` to the home directory. */
function expandTilde(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

/**
 * List the immediate subdirectories of each project root (one level, `~`
 * expanded), skipping hidden dirs. A missing/unreadable root is skipped. Pure
 * given its argument (exported for testing).
 */
export function scanProjectRoots(
  roots: string | string[] | undefined,
): string[] {
  if (!roots) return [];
  const list = Array.isArray(roots) ? roots : [roots];
  const out: string[] = [];
  for (const raw of list) {
    const root = expandTilde(raw);
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          out.push(join(root, entry.name));
        }
      }
    } catch {
      // Root doesn't exist or isn't readable — skip it.
    }
  }
  return out;
}

/**
 * Build the create form's choice lists from local preferences, the built-in
 * agent registry, the current live sessions, and the projects that already
 * have tasks. Reads `getPreferencesSync()` (no async, cheap) so the modal can
 * open synchronously.
 */
export function buildCreateOptions(
  liveSessions: EnrichedSession[],
  defaultProject: string,
  taskProjects: string[] = [],
): CreateOptions {
  const prefs = getPreferencesSync();
  const agents = getAgents(prefs).map((a) => a.name);
  const templates = Object.keys(prefs.templates ?? {});
  const templateHasPrompt: Record<string, boolean> = {};
  for (const [name, tpl] of Object.entries(prefs.templates ?? {})) {
    templateHasPrompt[name] = Boolean(tpl.prompt && tpl.prompt.length > 0);
  }

  // Project candidates, de-duped in first-seen (relevance) order: the
  // contextual default and other "recently active" hints first (config
  // projects, existing-task projects, live-session cwds), then the bulk of
  // folders scanned from the configured project root(s).
  const projects = uniq([
    defaultProject,
    ...Object.keys(prefs.projects ?? {}),
    ...taskProjects,
    ...liveSessions.map((s) => s.cwd),
    ...scanProjectRoots(prefs.projectsRoot),
  ]);

  const sessions: CreateSessionOption[] = liveSessions
    .filter((s) => s.tmuxPane)
    .map((s) => ({
      pane: s.tmuxPane!,
      label: `${s.tmuxPane} ${s.agentType} ${basename(s.cwd)}`,
      cwd: s.cwd,
      project: s.project,
    }));

  return { agents, templates, projects, sessions, templateHasPrompt };
}

/**
 * Seed the initial form for a project via the same default cascade the daemon
 * resolves (`defaults → projects[project] → templates`). `target` is kept as
 * resolved — including `background` — since the form's `Target` cycle covers
 * every placement.
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

  return {
    name: resolved.name ?? "",
    agent: resolved.agent ?? options.agents[0] ?? "claude",
    project: defaultProject || options.projects[0] || "",
    target: resolved.target ?? DEFAULT_TASK_TARGET,
    targetRef: "",
    template: "",
    prompt: resolved.prompt ?? "",
    runNow: true,
  };
}

/** The visible, focusable fields for a form state. `name` leads; `target-ref`
 *  only shows for the pane split/send-to-existing placements; `runNow` is
 *  hidden when editing (an edit never launches). */
export function visibleCreateFieldsFor(
  form: CreateFormState,
  opts: { editing?: boolean } = {},
): CreateField[] {
  const fields: CreateField[] = ["name", "agent", "project", "target"];
  if (targetNeedsRef(form.target)) fields.push("targetRef");
  fields.push("template", "prompt");
  if (!opts.editing) fields.push("runNow");
  return fields;
}

/** Whether a live session belongs to the given project (matches its cwd, or
 *  its derived project name against the project path's basename). An empty
 *  project matches everything. */
export function sessionMatchesProject(
  session: CreateSessionOption,
  project: string,
): boolean {
  if (!project) return true;
  return session.cwd === project || session.project === basename(project);
}

/** The live sessions in a given project — the target-ref candidates. */
export function sessionsForProject(
  options: CreateOptions,
  project: string,
): CreateSessionOption[] {
  return options.sessions.filter((s) => sessionMatchesProject(s, project));
}

/** The request body a create form submits to `POST /tasks`. Unset fields are
 *  omitted so the daemon's default cascade still applies. */
export interface CreateBody {
  project: string;
  name?: string;
  agent?: string;
  prompt?: string;
  template?: string;
  target: TaskTarget;
  targetRef?: string;
}

/** Shape a create form into the `POST /tasks` body (pure). `name` is sent only
 *  when non-blank so the daemon derives a default otherwise. */
export function buildCreateBody(form: CreateFormState): CreateBody {
  const body: CreateBody = { project: form.project, target: form.target };
  if (form.name.trim()) body.name = form.name.trim();
  if (form.agent) body.agent = form.agent;
  if (form.prompt.trim()) body.prompt = form.prompt;
  if (form.template) body.template = form.template;
  if (targetNeedsRef(form.target) && form.targetRef) {
    body.targetRef = form.targetRef;
  }
  return body;
}

/** The editable-field subset a form submits to `POST /tasks/{id}/edit`. */
export interface EditBody {
  name?: string;
  prompt?: string;
  agent?: string;
  project: string;
  target: TaskTarget;
  targetRef?: string;
}

/** Shape a form into the `POST /tasks/{id}/edit` body (pure). Sends the
 *  editable spec fields; `name` is sent as-is (blank clears it, so the daemon
 *  re-derives). `targetRef` only for the pane placements that use it. */
export function buildEditBody(form: CreateFormState): EditBody {
  const body: EditBody = {
    name: form.name.trim(),
    project: form.project,
    target: form.target,
    agent: form.agent,
    prompt: form.prompt,
  };
  if (targetNeedsRef(form.target) && form.targetRef) {
    body.targetRef = form.targetRef;
  }
  return body;
}

/** Pre-fill a create/edit form from an existing task instance. Copies only
 *  spec fields (so a clone starts fresh — no id/status/link fields) and
 *  defaults run-now off (you review before launching). */
export function formFromTask(
  task: {
    name?: string;
    prompt: string;
    agent: string;
    project: string;
    target: TaskTarget;
    targetRef?: string;
  },
  options: CreateOptions,
): CreateFormState {
  return {
    name: task.name ?? "",
    agent: task.agent || options.agents[0] || "claude",
    project: task.project,
    target: task.target,
    targetRef: task.targetRef ?? "",
    template: "",
    prompt: task.prompt,
    runNow: false,
  };
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
  // A `done` task is revivable: resume when it retains a conversation to
  // re-attach, else relaunch fresh (e.g. a headless done with no session).
  if (task.status === "done") {
    return task.nativeSessionId
      ? { kind: "resume", id: task.id }
      : { kind: "run", id: task.id };
  }
  if (task.status === "running" && task.sessionId) {
    return { kind: "jump", sessionId: task.sessionId };
  }
  return { kind: "none" };
}

/** The option list a cyclable field cycles through (empty for text/toggle
 *  fields, which are handled separately). `targetRef` is filtered to the
 *  selected project's live sessions. */
export function cycleOptionsFor(
  field: CreateField,
  options: CreateOptions,
  project = "",
): string[] {
  switch (field) {
    case "agent":
      return options.agents;
    case "project":
      return options.projects;
    case "target":
      return TARGET_CYCLE;
    case "targetRef":
      return sessionsForProject(options, project).map((s) => s.pane);
    case "template":
      return ["", ...options.templates];
    default:
      return [];
  }
}

/** A choice shown in the searchable project picker. A synthetic "use typed
 *  path" entry is included when the query is a new value. */
export interface ProjectChoice {
  name: string;
  value: string;
}

/**
 * Filter the known projects by a query (case-insensitive substring). When the
 * query is non-empty and not already an exact known project, append a synthetic
 * "Use "<query>"" choice so an arbitrary path can be launched too.
 */
export function projectPickerChoices(
  projects: string[],
  query: string,
): ProjectChoice[] {
  const q = query.trim();
  const lower = q.toLowerCase();
  const matches = (q ? projects.filter((p) => p.toLowerCase().includes(lower)) : projects).map(
    (p) => ({ name: p, value: p }),
  );
  if (q.length > 0 && !projects.some((p) => p === q)) {
    matches.push({ name: `Use "${q}"`, value: q });
  }
  return matches;
}
