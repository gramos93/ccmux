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
import { stripAnsi } from "../lib/strip-ansi";
import { getAgentExecutable, type AgentDef } from "../lib/agents";
import type { Preferences } from "../lib/preferences";
import type { TaskInstance } from "../lib/task";
import { isPromptReady } from "./invokers/helpers";
import { sendLiteralToPane, sendPromptToPane } from "./pane-io";

const READY_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;
const READY_CAPTURE_LINES = 100;

/** Result of a launch: a created-pane id for window/split, empty otherwise. */
export interface LaunchResult {
  paneId?: string;
}

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
}

/** Single-quote-escape one argv token for a POSIX shell. */
function shellQuote(token: string): string {
  return `'${token.replace(/'/g, "'\\''")}'`;
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
      return `${deps.prefs.command ?? "claude"} --resume ${native}`;
    }
    const agent = deps.getAgentByType(task.agent);
    if (agent?.resumeCommand) return agent.resumeCommand.replace("{id}", native);
    throw new Error(`agent ${task.agent} does not support resume`);
  }
  if (task.command && task.command.length > 0) {
    return task.command.map(shellQuote).join(" ");
  }
  if (task.agent === "claude") {
    return deps.prefs.command ?? "claude";
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
 *  command into a fresh window; `prompt` (when set) is submitted after the
 *  agent is ready (a follow-up turn). */
export interface LaunchOpts {
  resume?: boolean;
  prompt?: string;
}

/**
 * Launch a task into a pane. Without `opts`, launches per the task's target.
 * With `opts.resume`, always opens a fresh `new-window`, launches the agent's
 * resume command, and submits `opts.prompt` only if one was given. Throws on
 * an unsupported target, a missing working directory, a missing `targetRef`
 * for `send-to-existing`, or a tmux failure.
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

  // Shared: create a pane, send the launch command, and — when a prompt is
  // given — ready-wait then submit it (bracketed paste + delayed Enter).
  const runInPane = async (
    tmuxCmd: "new-window" | "split-window",
    launchCommand: string,
    promptToSend: string | undefined,
  ): Promise<LaunchResult> => {
    // Verify the working directory exists before spawning; it may have been
    // deleted between create and run (the CLI also fast-checks at create).
    if (!existsSync(task.project) || !statSync(task.project).isDirectory()) {
      throw new Error(`Working directory does not exist: ${task.project}`);
    }
    const create = await deps.runTmux([
      tmuxCmd,
      "-c",
      task.project,
      "-P",
      "-F",
      "#{pane_id}",
    ]);
    if (create.code !== 0) {
      throw new Error(`tmux ${tmuxCmd} failed: ${create.stderr.trim()}`);
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
    return { paneId };
  };

  // Resume: fresh window, resume command, optional follow-up prompt.
  if (opts.resume) {
    return runInPane(
      "new-window",
      buildLaunchCommand(task, deps, { resume: true }),
      opts.prompt,
    );
  }

  if (task.target === "new-window" || task.target === "split") {
    const tmuxCmd = task.target === "split" ? "split-window" : "new-window";
    // Passthrough: the raw command is the whole launch; no separate prompt.
    const promptToSend =
      task.command && task.command.length > 0 ? undefined : task.prompt;
    return runInPane(tmuxCmd, buildLaunchCommand(task, deps), promptToSend);
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
    return {};
  }

  if (task.target === "background") {
    throw new Error(
      "background tasks are not launched via the pane launcher (routed to invoke)",
    );
  }

  throw new Error(`Unsupported task target for run: ${String(task.target)}`);
}
