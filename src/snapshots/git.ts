import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DATA_BRANCH_NAME } from "./paths";

/**
 * Minimal injectable git command runner so the git-integration behavior can
 * be unit-tested without a real repository. Returns stdout.
 */
export type GitRunner = (args: string[]) => Promise<string>;

/** Real runner backed by the `git` CLI executed in `cwd`. */
export function execFileGitRunner(cwd: string): GitRunner {
  return async (args: string[]) => {
    const { stdout } = await promisify(execFile)("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  };
}

/** The currently checked-out branch name in the runner's cwd. */
export async function currentBranch(git: GitRunner): Promise<string> {
  return (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

/** True when the runner's cwd has the data branch checked out. */
export async function isDataBranch(
  git: GitRunner,
  branchName: string = DATA_BRANCH_NAME,
): Promise<boolean> {
  return (await currentBranch(git)) === branchName;
}

/**
 * Stage everything in the data-branch working tree and commit. Used by the
 * GitHub Actions collection workflows to land a validated snapshot atomically
 * on the data branch. A no-op commit ("nothing to commit") is not an error.
 */
export async function commitAll(git: GitRunner, message: string): Promise<void> {
  await git(["add", "-A"]);
  try {
    await git(["commit", "-m", message]);
  } catch (error) {
    const text = String((error as { message?: unknown })?.message ?? error);
    if (/nothing to commit/.test(text)) {
      return;
    }
    throw error;
  }
}

/**
 * Guard for Actions workflows: refuse to commit generated data unless the
 * data branch is checked out, so a misconfigured checkout can never scatter
 * machine-generated snapshots onto the source branch.
 */
export async function assertDataBranch(
  git: GitRunner,
  branchName: string = DATA_BRANCH_NAME,
): Promise<void> {
  if (!(await isDataBranch(git, branchName))) {
    throw new Error(
      `Refusing to write generated data: expected branch "${branchName}" but found "${await currentBranch(git)}"`,
    );
  }
}
