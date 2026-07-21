import { Command } from "commander";
import { getDaemonUrl } from "../lib/config";
import type { TaskInstance } from "../lib/task";
import { ensureDaemon } from "./shared";

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${getDaemonUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
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
  const task = new Command("task").description("Create, run, and track tasks");

  task
    .command("list")
    .description("List tasks")
    .action(async () => {
      await ensureDaemon();
      const res = await fetch(`${getDaemonUrl()}/tasks`);
      if (!res.ok) {
        console.error(`Failed to list tasks: HTTP ${res.status}`);
        process.exit(1);
      }
      const { tasks } = (await res.json()) as { tasks: TaskInstance[] };
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
          `${t.id}  ${t.status.padEnd(8)} ${t.agent}  ${t.project}  ${where}`,
        );
      }
    });

  task
    .command("create")
    .description("Create a task (optionally run it immediately)")
    .argument("<project>", "Project root/key the task runs in")
    .option("--agent <name>", "Agent to run", "claude")
    .option("--prompt <text>", "Prompt to send")
    .option("--template <name>", "Named template to apply")
    .option(
      "--target <target>",
      "new-window | split | send-to-existing",
      "new-window",
    )
    .option("--target-ref <pane>", "Pane/session for split/send-to-existing")
    .option("--run", "Run the task immediately after creating it")
    .action(
      async (
        project: string,
        options: {
          agent: string;
          prompt?: string;
          template?: string;
          target: string;
          targetRef?: string;
          run?: boolean;
        },
      ) => {
        await ensureDaemon();
        const res = await post("/tasks", {
          project,
          agent: options.agent,
          prompt: options.prompt,
          template: options.template,
          target: options.target,
          targetRef: options.targetRef,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          console.error(`Failed to create task: ${data.message ?? res.status}`);
          process.exit(1);
        }
        const { task: created } = (await res.json()) as { task: TaskInstance };
        console.log(`Created task ${created.id}`);

        if (options.run) {
          try {
            const ran = await runTask(created.id);
            console.log(`Running task ${ran.id} (${ran.status})`);
          } catch (err) {
            console.error(`Failed to run task: ${(err as Error).message}`);
            process.exit(1);
          }
        }
      },
    );

  task
    .command("run")
    .description("Run an existing task")
    .argument("<id>", "Task id")
    .action(async (id: string) => {
      await ensureDaemon();
      try {
        const ran = await runTask(id);
        console.log(`Running task ${ran.id} (${ran.status})`);
      } catch (err) {
        console.error(`Failed to run task: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("rm")
    .description("Delete a task")
    .argument("<id>", "Task id")
    .action(async (id: string) => {
      await ensureDaemon();
      const res = await fetch(`${getDaemonUrl()}/tasks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.error(`Failed to delete task: HTTP ${res.status}`);
        process.exit(1);
      }
      console.log(`Deleted task ${id}`);
    });

  return task;
}
