/**
 * Launch a task into a tmux pane, agent-adaptively. Pure command construction
 * plus an injectable tmux runner + clock, so `TaskManager.run` is testable
 * without a live tmux.
 *
 * Interactive pane launch mirrors `ClaudeInvoker`, generalized to any agent:
 * create a pane, launch the agent's interactive binary (`executable`, or
 * `prefs.command` for claude), wait for its `readyPattern` (bounded timeout,
 * or send immediately when it has none), then deliver the prompt via
 * `send-keys`. NO hardcoded `--prompt` flag (which matched no agent's real CLI).
 *
 * A task carrying a raw `command` argv bypasses the adapter: the argv is
 * launched verbatim (no separate prompt send). `send-to-existing` sends the
 * prompt (or `command`) into an existing pane. `background` is NOT handled here
 * — the manager routes it to the invoke subsystem.
 *
 * See `openspec/changes/add-agent-adaptive-launch`.
 */
import { existsSync, statSync } from "fs";
import { basename } from "path";
import { stripAnsi } from "../lib/strip-ansi";
import { getAgentExecutable, type AgentDef } from "../lib/agents";
import type { Preferences } from "../lib/preferences";
import { taskDisplayName, type TaskInstance } from "../lib/task";
import {
  deriveBranchName,
  resolveBareRepo,
  resolveBaseBranch,
  resolveWorktree,
  WorktreeError,
} from "../lib/worktree";
import { isPromptReady } from "./invokers/helpers";
import { sendLiteralToPane, sendPromptToPane } from "./pane-io";

const READY_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;
const READY_CAPTURE_LINES = 100;

/** Result of a launch: a created-pane id for window/split, empty otherwise.
 *  When the task launched into a worktree, the resolved `worktreePath` and
 *  `branch` are set so the manager can persist them. */
export interface LaunchResult {
  paneId?: string;
  worktreePath?: string;
  branch?: string;
}

/** Resolve a task's worktree to a concrete path + branch, or throw a
 *  {@link WorktreeError} (`not-wtm` blocks the run; `wtm-missing`/`wtm-failed`
 *  are environment faults). Injected so the launcher is testable without a live
 *  git/wtm. */
export type WorktreeResolver = (
  task: TaskInstance,
) => Promise<{ path: string; branch: string }>;

/**
 * Default {@link WorktreeResolver}: locate the wtm bare root for the task's
 * project (block with a `not-wtm` error when it is not wtm-managed), resolve the
 * branch (persisted `branch` or the intent's branch treated as explicit; else a
 * slug of the task name) and base, then provision-or-reuse the worktree. A
 * persisted `branch` (resume/re-run) is passed as explicit so the same worktree
 * is re-entered rather than a new one derived.
 */
export const realWorktreeResolver: WorktreeResolver = async (task) => {
  const bareRoot = await resolveBareRepo(task.project);
  if (!bareRoot) {
    throw new WorktreeError(
      "not-wtm",
      `${task.project} is not a wtm-managed (bare) repository — run \`wtm init\` there first, then run this task`,
    );
  }
  const intent = task.worktree;
  const explicitBranch =
    task.branch ?? (typeof intent === "object" ? intent.branch : undefined);
  const explicitBase = typeof intent === "object" ? intent.base : undefined;
  const branch = await deriveBranchName(bareRoot, {
    explicit: explicitBranch,
    taskName: taskDisplayName(task),
    taskId: task.id,
  });
  const base = await resolveBaseBranch(bareRoot, { explicit: explicitBase });
  const resolved = await resolveWorktree(bareRoot, { branch, base });
  return { path: resolved.path, branch: resolved.branch };
};

/** Runs `tmux <args>` and returns its exit code + captured output. Injected so
 *  tests can fake tmux. */
export type TmuxRunner = (
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Real tmux runner over `Bun.spawn`. */
export const realTmuxRunner: TmuxRunner = async (args) => {
  const proc = Bun.spawn(["tmux", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
};

export interface TaskLauncherDeps {
  getAgentByType: (name: string) => AgentDef | undefined;
  runTmux: TmuxRunner;
  prefs: Preferences;
  /** Clock + sleep, injected so the ready-wait loop is testable. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Delivery helpers, injected so tests don't drive real tmux. Default to the
   * proven pane-io helpers. `sendLiteral` types a command (`-l` + a delayed
   * separate Enter). `sendPrompt` uses a bracketed paste + delayed Enter — the
   * ONLY reliable way to submit into a TUI composer (a batched
   * `send-keys <text> Enter` leaves the text unsubmitted).
   */
  sendLiteral?: (pane: string, text: string, enter: boolean) => Promise<boolean>;
  sendPrompt?: (pane: string, text: string, enter: boolean) => Promise<boolean>;
  /** Resolves a worktree task to its path + branch. Defaults to
   *  {@link realWorktreeResolver}; injected so tests avoid a live git/wtm. */
  resolveWorktree?: WorktreeResolver;
}

/** Single-quote-escape one argv token for a POSIX shell. */
function shellQuote(token: string): string {
  return `'${token.replace(/'/g, "'\\''")}'`;
}

/**
 * Sanitize a raw string into a legal tmux session name: replace the characters
 * tmux forbids (`.` and `:`) with `-` and trim. Returns "" when nothing usable
 * remains (callers decide the fallback).
 */
export function sanitizeTmuxName(raw: string): string {
  return raw.replace(/[.:]/g, "-").trim();
}

/**
 * Derive a tmux session name for a `new-session` task from its project. Uses
 * the {@link sanitizeTmuxName sanitized} path basename, falling back to `task`
 * for an empty result.
 */
export function tmuxSessionName(project: string): string {
  const base = basename(project) || project;
  const sanitized = sanitizeTmuxName(base);
  return sanitized.length > 0 ? sanitized : "task";
}

/** Short, stable, path-derived suffix (FNV-1a 32-bit → 6 hex chars). Pure and
 *  deterministic — no `Date`/random — so the same project always hashes the
 *  same way, which is what keeps a disambiguated session stable across runs
 *  and resume. */
function pathHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * Disambiguated session name for a project whose primary {@link tmuxSessionName}
 * is already taken by a *different* project: the sanitized basename plus a
 * short suffix derived from the full path. Deterministic (same project → same
 * name every run and on resume).
 */
export function disambiguatedSessionName(project: string): string {
  return `${tmuxSessionName(project)}-${pathHash(project)}`;
}

/** Existence + ccmux ownership of a tmux session. Existence is probed with
 *  the exact-match `=name` form (only `has-session` accepts it) so a prefix
 *  can't false-hit; `show-option` does NOT accept `=`, so it uses the plain
 *  name — safe because it runs only after `has-session` confirmed the exact
 *  session exists, and tmux resolves a plain target to the exact match first.
 *  `owner` is the `@ccmux_project` user option ccmux stamps on sessions it
 *  creates ("" when unset or unreadable). */
async function sessionOwner(
  deps: Pick<TaskLauncherDeps, "runTmux">,
  name: string,
): Promise<{ exists: boolean; owner: string }> {
  const has = await deps.runTmux(["has-session", "-t", `=${name}`]);
  if (has.code !== 0) return { exists: false, owner: "" };
  const opt = await deps.runTmux([
    "show-option",
    "-v",
    "-t",
    name,
    "@ccmux_project",
  ]);
  return { exists: true, owner: opt.code === 0 ? opt.stdout.trim() : "" };
}

/**
 * Resolve which tmux session a `new-session` task should use. The primary name
 * is reused only when it exists AND was created by ccmux for this same project
 * (its `@ccmux_project` matches). Otherwise — a different project owns it, or
 * it is unstamped (e.g. a session the user made by hand) — the name falls to a
 * deterministic path-disambiguated alternative so the task never joins an
 * unrelated same-named session. Returns the chosen `name` and whether a session
 * of that name already `exists` (attach vs create-fresh).
 *
 * One disambiguation step: a further collision on the hashed alt name would
 * require two of the user's repos to share both a basename and a 24-bit path
 * hash — effectively impossible — so the alt is attached to when present.
 */
export async function resolveProjectSession(
  deps: Pick<TaskLauncherDeps, "runTmux">,
  project: string,
): Promise<{ name: string; exists: boolean }> {
  const primary = tmuxSessionName(project);
  const p = await sessionOwner(deps, primary);
  if (!p.exists) return { name: primary, exists: false };
  if (p.owner === project) return { name: primary, exists: true };
  const alt = disambiguatedSessionName(project);
  const a = await sessionOwner(deps, alt);
  return { name: alt, exists: a.exists };
}

/** Whether an agent can be resumed (claude, or one with a `resumeCommand`). */
export function isAgentResumable(agent: AgentDef | undefined): boolean {
  return !!agent && (agent.name === "claude" || !!agent.resumeCommand);
}

/**
 * Build the launch command for a task. With `opts.resume`, build the agent's
 * *resume* command against `task.nativeSessionId` (claude → `<binary> --resume
 * <id>`; else `resumeCommand` with `{id}` → native id). Otherwise: the raw
 * `command` argv (shell-quoted) when present, else the agent's interactive
 * binary with NO prompt flag (the prompt is delivered separately after ready).
 */
export function buildLaunchCommand(
  task: TaskInstance,
  deps: Pick<TaskLauncherDeps, "getAgentByType" | "prefs">,
  opts: { resume?: boolean } = {},
): string {
  if (opts.resume) {
    const native = task.nativeSessionId;
    if (!native) throw new Error("cannot resume: task has no nativeSessionId");
    if (task.agent === "claude") {
      const base = `${deps.prefs.command ?? "claude"} --resume ${native}`;
      return task.autoMode ? `${base} --permission-mode acceptEdits` : base;
    }
    const agent = deps.getAgentByType(task.agent);
    if (agent?.resumeCommand) return agent.resumeCommand.replace("{id}", native);
    throw new Error(`agent ${task.agent} does not support resume`);
  }
  if (task.command && task.command.length > 0) {
    return task.command.map(shellQuote).join(" ");
  }
  if (task.agent === "claude") {
    const base = deps.prefs.command ?? "claude";
    return task.autoMode ? `${base} --permission-mode acceptEdits` : base;
  }
  const agent = deps.getAgentByType(task.agent);
  return agent?.executable ?? getAgentExecutable(task.agent);
}

async function capture(deps: TaskLauncherDeps, paneId: string): Promise<string> {
  const res = await deps.runTmux([
    "capture-pane",
    "-p",
    "-t",
    paneId,
    "-S",
    `-${READY_CAPTURE_LINES}`,
  ]);
  return stripAnsi(res.stdout);
}

/** Options for {@link launchTask}. `resume` launches the agent's resume
 *  command into the task's project-named session (create-or-attach) — the
 *  original pane is gone by resume time — honoring an explicit `targetRef`
 *  session name only for a `new-session` task; `prompt` (when set) is submitted
 *  after the agent is ready (a follow-up turn). */
export interface LaunchOpts {
  resume?: boolean;
  prompt?: string;
}

/**
 * Launch a task into a pane. Without `opts`, launches per the task's target
 * (`new-window`/`split`, a project-named `new-session` created-or-attached, or
 * `send-to-existing`). With `opts.resume`, launches the agent's resume command
 * into the task's project-named session (create-or-attach, since the original
 * pane is gone) and submits `opts.prompt` only if one was given. Throws on an
 * unsupported target, a missing working directory, a missing `targetRef` for
 * `send-to-existing`, or a tmux failure.
 */
export async function launchTask(
  task: TaskInstance,
  deps: TaskLauncherDeps,
  opts: LaunchOpts = {},
): Promise<LaunchResult> {
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const sendLiteral = deps.sendLiteral ?? sendLiteralToPane;
  const sendPrompt = deps.sendPrompt ?? sendPromptToPane;
  const resolveWorktreeFn = deps.resolveWorktree ?? realWorktreeResolver;

  // Resolve the worktree FIRST (before any pane is created), so a non-wtm repo
  // throws `not-wtm` and short-circuits with nothing launched. The worktree
  // path becomes the effective working directory for every target; the branch
  // names the created window. A task without worktree intent keeps its project
  // root as the working directory, exactly as before.
  let effectiveCwd = task.project;
  let resolvedBranch: string | undefined;
  if (task.worktree) {
    const wt = await resolveWorktreeFn(task);
    effectiveCwd = wt.path;
    resolvedBranch = wt.branch;
  }
  // Worktree correlation to fold into every launch result so the manager can
  // persist it (empty for a non-worktree task).
  const wtFields: Pick<LaunchResult, "worktreePath" | "branch"> = resolvedBranch
    ? { worktreePath: effectiveCwd, branch: resolvedBranch }
    : {};
  // A branch-named window for worktree launches (one window per worktree);
  // omitted for a non-worktree task so window naming is unchanged.
  const windowNameArgv = resolvedBranch ? ["-n", resolvedBranch] : [];

  // Static create argv for the current-session pane targets (new-window/split).
  // `split-window` does not accept `-n`, so window naming applies to new-window
  // only.
  const paneCreateArgv = (tmuxCmd: "new-window" | "split-window"): string[] => [
    tmuxCmd,
    ...(tmuxCmd === "new-window" ? windowNameArgv : []),
    "-c",
    effectiveCwd,
    "-P",
    "-F",
    "#{pane_id}",
  ];

  // Launch into a dedicated session. With an explicit `targetRef` name the
  // user is naming a specific container: create-or-attach to exactly that
  // session with NO ownership/disambiguation (it may be another project's or a
  // hand-made session — that's the point). Without one, fall to the
  // project-derived resolver, which reuses a same-named session only when it
  // already belongs to this project, else picks a path-disambiguated name so a
  // foreign same-named session is never hijacked. Either way a freshly created
  // session is stamped with `@ccmux_project` (fire-and-forget) while attaching
  // never re-stamps. Shared by the fresh run and resume.
  const runNewSession = async (
    launchCommand: string,
    promptToSend: string | undefined,
    honorTargetRef = true,
  ): Promise<LaunchResult> => {
    // `honorTargetRef` is true for a fresh new-session run and a new-session
    // resume (the explicit `targetRef` names the session). It is false when
    // resuming a non-new-session task, whose `targetRef` (if any) is a pane id,
    // not a session name — such a resume lands in the project-derived session.
    const explicit = honorTargetRef && task.targetRef
      ? sanitizeTmuxName(task.targetRef)
      : "";
    const { name, exists } = explicit
      ? {
          name: explicit,
          exists:
            (await deps.runTmux(["has-session", "-t", `=${explicit}`])).code ===
            0,
        }
      : await resolveProjectSession(deps, task.project);
    // A worktree launch opens a branch-named window in the (project-keyed)
    // session — one project session, one window per worktree.
    const head = exists
      ? ["new-window", ...windowNameArgv, "-t", name]
      : ["new-session", "-d", "-s", name, ...windowNameArgv];
    const argv = [...head, "-c", effectiveCwd, "-P", "-F", "#{pane_id}"];
    const result = await runInPane(argv, launchCommand, promptToSend);
    if (!exists) {
      // `set-option` does NOT accept the `=name` exact-match form (only
      // `has-session` does); use the plain name. The name is exact (just
      // created), so it targets that session.
      await deps.runTmux([
        "set-option",
        "-t",
        name,
        "@ccmux_project",
        task.project,
      ]);
    }
    return result;
  };

  // Shared: create a pane from the given tmux create argv, send the launch
  // command, and — when a prompt is given — ready-wait then submit it
  // (bracketed paste + delayed Enter).
  const runInPane = async (
    createArgv: string[],
    launchCommand: string,
    promptToSend: string | undefined,
  ): Promise<LaunchResult> => {
    // Verify the working directory exists before spawning; it may have been
    // deleted between create and run (the CLI also fast-checks at create). For a
    // worktree task this is the resolved worktree path.
    if (!existsSync(effectiveCwd) || !statSync(effectiveCwd).isDirectory()) {
      throw new Error(`Working directory does not exist: ${effectiveCwd}`);
    }
    const create = await deps.runTmux(createArgv);
    if (create.code !== 0) {
      throw new Error(`tmux ${createArgv[0]} failed: ${create.stderr.trim()}`);
    }
    const paneId = create.stdout.trim();

    // Baseline the pre-launch pane (bare shell) so the ready check requires a
    // transition, not just a glyph the shell prompt already shows.
    const baseline = await capture(deps, paneId);
    if (!(await sendLiteral(paneId, launchCommand, true))) {
      throw new Error("failed to send launch command to pane");
    }

    if (promptToSend !== undefined) {
      const readyPattern = deps.getAgentByType(task.agent)?.readyPattern;
      if (readyPattern) {
        const start = now();
        while (now() - start < READY_TIMEOUT_MS) {
          if (
            isPromptReady(await capture(deps, paneId), baseline, readyPattern)
          ) {
            break;
          }
          await sleep(POLL_INTERVAL_MS);
        }
        // On timeout we send anyway (best effort) rather than failing.
      }
      if (!(await sendPrompt(paneId, promptToSend, true))) {
        throw new Error("failed to send prompt to pane");
      }
    }
    return { paneId, ...wtFields };
  };

  // Resume: resume command + optional follow-up prompt. A new-session task
  // resumes back into its project session (create-or-attach); every other
  // target resumes into the project-named session too (create-or-attach).
  if (opts.resume) {
    const launchCommand = buildLaunchCommand(task, deps, { resume: true });
    // The original pane/window is gone by resume time, so every target lands in
    // the project-named session (create-or-attach), never a new-window in the
    // currently-attached session. new-session honors its explicit targetRef
    // name; other targets use the project-derived name.
    return runNewSession(
      launchCommand,
      opts.prompt,
      task.target === "new-session",
    );
  }

  if (task.target === "new-window" || task.target === "split") {
    const tmuxCmd = task.target === "split" ? "split-window" : "new-window";
    // Passthrough: the raw command is the whole launch; no separate prompt.
    const promptToSend =
      task.command && task.command.length > 0 ? undefined : task.prompt;
    return runInPane(paneCreateArgv(tmuxCmd), buildLaunchCommand(task, deps), promptToSend);
  }

  if (task.target === "new-session") {
    // Passthrough: the raw command is the whole launch; no separate prompt.
    const promptToSend =
      task.command && task.command.length > 0 ? undefined : task.prompt;
    return runNewSession(buildLaunchCommand(task, deps), promptToSend);
  }

  if (task.target === "send-to-existing") {
    if (!task.targetRef) {
      throw new Error("send-to-existing requires targetRef");
    }
    // A command is a shell line (sendLiteral); a prompt goes into the existing
    // agent's composer (sendPrompt).
    const ok =
      task.command && task.command.length > 0
        ? await sendLiteral(task.targetRef, task.command.map(shellQuote).join(" "), true)
        : await sendPrompt(task.targetRef, task.prompt, true);
    if (!ok) throw new Error("failed to send to pane");
    return { ...wtFields };
  }

  if (task.target === "background") {
    throw new Error(
      "background tasks are not launched via the pane launcher (routed to invoke)",
    );
  }

  throw new Error(`Unsupported task target for run: ${String(task.target)}`);
}
