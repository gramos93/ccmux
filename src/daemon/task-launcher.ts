/**
 * Launch a task into a tmux pane. Pure command construction plus an injectable
 * tmux runner, so `TaskManager.run` can be unit-tested without a live tmux.
 *
 * Two launch shapes:
 * - `new-window` / `split`: create a pane (`-P -F '#{pane_id}'`), capture its
 *   id, and send a *fresh agent launch* command into it (the `handleSpawn`
 *   idiom).
 * - `send-to-existing`: the referenced pane already runs an agent, so send the
 *   raw prompt text into it (no new process, no pane created).
 *
 * See `openspec/changes/add-task-spawn` (D3, D4).
 */
import type { AgentDef } from "../lib/agents";
import type { Preferences } from "../lib/preferences";
import type { TaskInstance } from "../lib/task";

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
}

/**
 * Resolve the agent binary and build the fresh-launch command with the task's
 * prompt inlined (single-quote-escaped, matching `handleSpawn`). Used for
 * `new-window` / `split`.
 */
export function buildTaskCommand(
  task: TaskInstance,
  deps: Pick<TaskLauncherDeps, "getAgentByType" | "prefs">,
): string {
  const agent = deps.getAgentByType(task.agent);
  const binary =
    task.agent === "claude"
      ? (deps.prefs.command ?? "claude")
      : (agent?.executable ?? task.agent);
  const escaped = task.prompt.replace(/'/g, "'\\''");
  return `${binary} --prompt '${escaped}'`;
}

/**
 * Launch a task into a pane per its target. Throws on an unsupported target,
 * a missing `targetRef` for `send-to-existing`, or a tmux failure.
 */
export async function launchTask(
  task: TaskInstance,
  deps: TaskLauncherDeps,
): Promise<LaunchResult> {
  if (task.target === "new-window" || task.target === "split") {
    const tmuxCmd = task.target === "split" ? "split-window" : "new-window";
    // `project` doubles as the working directory (the project's root folder).
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
    const command = buildTaskCommand(task, deps);
    const send = await deps.runTmux([
      "send-keys",
      "-t",
      paneId,
      command,
      "Enter",
    ]);
    if (send.code !== 0) {
      throw new Error(`tmux send-keys failed: ${send.stderr.trim()}`);
    }
    return { paneId };
  }

  if (task.target === "send-to-existing") {
    if (!task.targetRef) {
      throw new Error("send-to-existing requires targetRef");
    }
    // The referenced pane already runs an agent: send the raw prompt text.
    const send = await deps.runTmux([
      "send-keys",
      "-t",
      task.targetRef,
      task.prompt,
      "Enter",
    ]);
    if (send.code !== 0) {
      throw new Error(`tmux send-keys failed: ${send.stderr.trim()}`);
    }
    return {};
  }

  throw new Error(`Unsupported task target for run: ${String(task.target)}`);
}
