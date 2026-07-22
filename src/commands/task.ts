import { existsSync, statSync } from "fs";
import { Command } from "commander";
import { getDaemonUrl } from "../lib/config";
import type { TaskInstance } from "../lib/task";
import { ensureDaemon } from "./shared";

/** Short handle shown in `list` and the minimum a user needs to type. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${getDaemonUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function listTasks(): Promise<TaskInstance[]> {
  const res = await fetch(`${getDaemonUrl()}/tasks`);
  if (!res.ok) throw new Error(`Failed to list tasks: HTTP ${res.status}`);
  return ((await res.json()) as { tasks: TaskInstance[] }).tasks;
}

/**
 * Resolve a task reference (full id or unique id prefix) to a full id.
 * Exact id wins; otherwise a prefix must match exactly one task. Ambiguous
 * or empty matches throw. The daemon endpoints only take full ids.
 */
async function resolveTaskRef(ref: string): Promise<string> {
  const tasks = await listTasks();
  if (tasks.some((t) => t.id === ref)) return ref;
  const matches = tasks.filter((t) => t.id.startsWith(ref));
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) {
    throw new Error(`No task matches "${ref}"`);
  }
  throw new Error(
    `Ambiguous task "${ref}" — matches: ${matches.map((t) => shortId(t.id)).join(", ")}`,
  );
}

async function runTask(id: string): Promise<TaskInstance> {
  const res = await post(`/tasks/${id}/run`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(data.message ?? `HTTP ${res.status}`);
  }
  return ((await res.json()) as { task: TaskInstance }).task;
}

export function createTaskCommand(): Command {
  // Required so `create` can use passThroughOptions for the `-- <raw>` tail.
  const task = new Command("task")
    .description("Create, run, and track tasks")
    .enablePositionalOptions();

  task
    .command("list")
    .description("List tasks")
    .action(async () => {
      await ensureDaemon();
      let tasks: TaskInstance[];
      try {
        tasks = await listTasks();
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
      if (tasks.length === 0) {
        console.log("No tasks.");
        return;
      }
      for (const t of tasks) {
        const where = t.sessionId
          ? `→ ${t.sessionId}`
          : t.paneId
            ? `pane ${t.paneId}`
            : "";
        console.log(
          `${shortId(t.id)}  ${t.status.padEnd(8)} ${t.agent}  ${t.project}  ${where}`,
        );
      }
    });

  task
    .command("create")
    .description("Create a task (optionally run it immediately)")
    // Pass raw agent args after `--`; `passThroughOptions` stops create from
    // parsing them as its own flags (needs enablePositionalOptions on `task`).
    .passThroughOptions()
    .argument("[cmd...]", "raw agent command after `--` (passthrough)")
    .option(
      "-d, --dir <path>",
      "Working directory / project (default: current dir)",
    )
    .option("--agent <name>", "Agent to run (default: config default)")
    .option("--prompt <text>", "Prompt to send")
    .option("--template <name>", "Named template to apply")
    .option(
      "--target <target>",
      "new-window | split | send-to-existing | background",
    )
    .option("--target-ref <pane>", "Pane/session for split/send-to-existing")
    .option("--bg", "Run headless via the invoke subsystem (target=background)")
    .option("--run", "Run the task immediately after creating it")
    .action(
      async (
        cmd: string[],
        options: {
          dir?: string;
          agent?: string;
          prompt?: string;
          template?: string;
          target?: string;
          targetRef?: string;
          bg?: boolean;
          run?: boolean;
        },
      ) => {
        // `bin/ccmux` cd's into the repo before running, so process.cwd() is
        // the install dir; it preserves the real caller dir in
        // CCMUX_CALLER_PWD. Prefer that for the default working directory.
        const project =
          options.dir ?? process.env.CCMUX_CALLER_PWD ?? process.cwd();
        // Fast fail BEFORE starting the daemon: the working dir must exist (the
        // daemon re-checks at launch in case it's deleted between create/run).
        if (!existsSync(project) || !statSync(project).isDirectory()) {
          console.error(`Directory does not exist: ${project}`);
          process.exit(1);
        }
        await ensureDaemon();
        // Omit unset agent/target so the daemon's default cascade (config
        // `defaults` → project → template → built-in) applies. JSON.stringify
        // drops `undefined` keys. `--bg` is sugar for target=background.
        const res = await post("/tasks", {
          project,
          agent: options.agent,
          prompt: options.prompt,
          template: options.template,
          target: options.bg ? "background" : options.target,
          targetRef: options.targetRef,
          command: cmd.length > 0 ? cmd : undefined,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          console.error(`Failed to create task: ${data.message ?? res.status}`);
          process.exit(1);
        }
        const { task: created } = (await res.json()) as { task: TaskInstance };
        console.log(`Created task ${shortId(created.id)}`);

        if (options.run) {
          try {
            const ran = await runTask(created.id);
            console.log(`Running task ${shortId(ran.id)} (${ran.status})`);
          } catch (err) {
            console.error(`Failed to run task: ${(err as Error).message}`);
            process.exit(1);
          }
        }
      },
    );

  task
    .command("run")
    .description("Run an existing task (full id or unique prefix)")
    .argument("<ref>", "Task id or unique id prefix")
    .action(async (ref: string) => {
      await ensureDaemon();
      try {
        const id = await resolveTaskRef(ref);
        const ran = await runTask(id);
        console.log(`Running task ${shortId(ran.id)} (${ran.status})`);
      } catch (err) {
        console.error(`Failed to run task: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("rm")
    .description("Delete a task (full id or unique prefix)")
    .argument("<ref>", "Task id or unique id prefix")
    .action(async (ref: string) => {
      await ensureDaemon();
      let id: string;
      try {
        id = await resolveTaskRef(ref);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
      const res = await fetch(`${getDaemonUrl()}/tasks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.error(`Failed to delete task: HTTP ${res.status}`);
        process.exit(1);
      }
      console.log(`Deleted task ${shortId(id)}`);
    });

  return task;
}
