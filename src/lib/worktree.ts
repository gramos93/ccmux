/**
 * wtm-backed worktree provisioning for tasks.
 *
 * ccmux does not create worktrees natively — it drives `wtm` (the bare-repo
 * worktree manager). This module is the single seam: locate the wtm bare root
 * from any cwd, and provision-or-reuse a worktree there. All external commands
 * go through an injectable {@link CommandRunner} so the logic is testable
 * without a live `git`/`wtm`.
 *
 * Non-wtm repos are NOT adopted here (`wtm init` restructures the repo in place
 * — that stays a manual dev step). A worktree request in a non-wtm repo throws
 * a {@link WorktreeError} of kind `not-wtm`, which the run path maps to a block
 * that leaves the task pending. See `openspec/changes/add-task-worktrees`.
 */
import { realpath } from "fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "path";

/** Distinct failure modes so callers can map them to the right outcome:
 *  `not-wtm` (repo not wtm-managed → block, keep task pending),
 *  `wtm-missing` (binary not on PATH → install wtm),
 *  `wtm-failed` (wtm/git ran but errored). */
export type WorktreeErrorKind = "not-wtm" | "wtm-missing" | "wtm-failed";

/** A typed worktree provisioning failure. */
export class WorktreeError extends Error {
  readonly kind: WorktreeErrorKind;
  constructor(kind: WorktreeErrorKind, message: string) {
    super(message);
    this.name = "WorktreeError";
    this.kind = kind;
  }
}

/** Runs a command and returns its exit code + captured output. Injected so
 *  tests can fake `git`/`wtm`. `cwd` defaults to the process cwd. */
export type CommandRunner = (
  cmd: string,
  args: string[],
  cwd?: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Real runner over `Bun.spawn`. A missing binary (spawn throws ENOENT) is
 *  reported as code 127 rather than throwing, so callers see a uniform result
 *  and can translate 127 → {@link WorktreeError} `wtm-missing`. */
export const realRunner: CommandRunner = async (cmd, args, cwd) => {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (err) {
    return { code: 127, stdout: "", stderr: (err as Error).message };
  }
};

/**
 * Locate the wtm root for `cwd` (the repo root, or any existing worktree within
 * it) — the directory `wtm create` runs from and under which worktrees live.
 * Runs `git rev-parse --git-common-dir` and confirms `core.bare` is `true`
 * there. In wtm's layout the common git dir is a `.git` subdirectory of the
 * root (`<root>/.git`, with worktrees at `<root>/<branch>`), so the root is that
 * dir's parent; a truly-bare dir (common dir not named `.git`) is its own root.
 * Returns the realpath'd root, or `null` when `cwd` is not inside a wtm-managed
 * (bare) repository.
 */
export async function resolveBareRepo(
  cwd: string,
  runner: CommandRunner = realRunner,
): Promise<string | null> {
  const rev = await runner("git", ["-C", cwd, "rev-parse", "--git-common-dir"]);
  if (rev.code !== 0) return null;
  const raw = rev.stdout.trim();
  if (!raw) return null;
  const commonDir = isAbsolute(raw) ? raw : resolve(cwd, raw);

  const bare = await runner("git", [
    "-C",
    commonDir,
    "config",
    "--get",
    "core.bare",
  ]);
  if (bare.code !== 0 || bare.stdout.trim() !== "true") return null;

  // The wtm root — where worktrees live and `wtm create` runs — is the parent
  // of the git dir when it's a `.git` subdir; otherwise the git dir itself.
  const root = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
  try {
    return await realpath(root);
  } catch {
    return null;
  }
}

/** A worktree as reported by `git worktree list --porcelain`. */
interface WorktreeEntry {
  path: string;
  branch: string | null;
}

/** Parse `git worktree list --porcelain`: records separated by blank lines,
 *  each with a `worktree <path>` line and (unless bare/detached) a
 *  `branch refs/heads/<name>` line. Strips the `refs/heads/` prefix. */
function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let path: string | null = null;
  let branch: string | null = null;
  const flush = () => {
    if (path) entries.push({ path, branch });
    path = null;
    branch = null;
  };
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      path = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch ")) {
      branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return entries;
}

/** The resolved worktree: its absolute `path`, the `branch` it checks out, and
 *  whether this call `created` it (vs. reused an existing one). */
export interface WorktreeResolution {
  path: string;
  branch: string;
  created: boolean;
}

/**
 * Provision (or reuse) a worktree for `branch` at `bareRoot`. Idempotent: an
 * existing worktree whose branch matches is reused (never recreated); otherwise
 * `wtm create <branch> --from <base> --no-shell` is run at the bare root,
 * producing `<bare>/<branch>`. Throws {@link WorktreeError} `wtm-missing` when
 * the `wtm` binary is absent, `wtm-failed` when it errors.
 */
export async function resolveWorktree(
  bareRoot: string,
  opts: { branch: string; base: string },
  runner: CommandRunner = realRunner,
): Promise<WorktreeResolution> {
  const list = await runner("git", [
    "-C",
    bareRoot,
    "worktree",
    "list",
    "--porcelain",
  ]);
  if (list.code === 0) {
    const match = parseWorktreeList(list.stdout).find(
      (w) => w.branch === opts.branch,
    );
    if (match) return { path: match.path, branch: opts.branch, created: false };
  }

  const create = await runner(
    "wtm",
    ["create", opts.branch, "--from", opts.base, "--no-shell"],
    bareRoot,
  );
  if (create.code === 127) {
    throw new WorktreeError(
      "wtm-missing",
      "wtm is not installed or not on PATH — install wtm to use worktree tasks",
    );
  }
  if (create.code !== 0) {
    throw new WorktreeError(
      "wtm-failed",
      `wtm create failed: ${create.stderr.trim() || create.stdout.trim()}`,
    );
  }
  return { path: join(bareRoot, opts.branch), branch: opts.branch, created: true };
}

/** Max length of a derived branch slug (before any collision suffix). */
const BRANCH_SLUG_MAX = 40;

/**
 * Slugify a task name into a legal, readable branch name: lowercased, non
 * alphanumerics collapsed to `-`, trimmed, capped. Falls back to `task` when
 * nothing usable remains. Pure and deterministic.
 */
export function slugifyBranch(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BRANCH_SLUG_MAX)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "task";
}

/** Collect the set of names already taken by a branch or a worktree at
 *  `bareRoot` (so a derived slug can avoid colliding). Missing/failed lookups
 *  contribute nothing rather than throwing. */
async function takenNames(
  bareRoot: string,
  runner: CommandRunner,
): Promise<Set<string>> {
  const taken = new Set<string>();
  const branches = await runner("git", [
    "-C",
    bareRoot,
    "branch",
    "--format=%(refname:short)",
  ]);
  if (branches.code === 0) {
    for (const b of branches.stdout.split("\n")) {
      const name = b.trim();
      if (name) taken.add(name);
    }
  }
  const list = await runner("git", [
    "-C",
    bareRoot,
    "worktree",
    "list",
    "--porcelain",
  ]);
  if (list.code === 0) {
    for (const w of parseWorktreeList(list.stdout)) {
      if (w.branch) taken.add(w.branch);
    }
  }
  return taken;
}

/**
 * Resolve the branch name for a worktree task. An `explicit` branch is used
 * verbatim (the dev deliberately named it — reuse/sharing is intended). A
 * derived branch is `slugifyBranch(taskName)`; if that slug already names a
 * branch/worktree, a short `taskId` suffix is appended so a fresh task never
 * silently shares another task's worktree.
 */
export async function deriveBranchName(
  bareRoot: string,
  input: { explicit?: string; taskName: string; taskId: string },
  runner: CommandRunner = realRunner,
): Promise<string> {
  const explicit = input.explicit?.trim();
  if (explicit) return explicit;

  const slug = slugifyBranch(input.taskName);
  const taken = await takenNames(bareRoot, runner);
  if (!taken.has(slug)) return slug;
  return `${slug}-${input.taskId.slice(0, 6)}`;
}

/**
 * Resolve the base branch a new worktree forks from. An `explicit` base is used
 * verbatim; otherwise the repo default is detected via `origin/HEAD`, falling
 * back to `main` then `master`.
 */
export async function resolveBaseBranch(
  bareRoot: string,
  input: { explicit?: string } = {},
  runner: CommandRunner = realRunner,
): Promise<string> {
  const explicit = input.explicit?.trim();
  if (explicit) return explicit;

  const head = await runner("git", [
    "-C",
    bareRoot,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
  ]);
  if (head.code === 0) {
    const ref = head.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
    if (ref) return ref;
  }

  const taken = await takenNames(bareRoot, runner);
  if (taken.has("main")) return "main";
  if (taken.has("master")) return "master";
  return "main";
}
