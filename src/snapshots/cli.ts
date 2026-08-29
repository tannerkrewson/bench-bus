import { promises as fs } from "node:fs";
import {
  assertDataBranch,
  commitAll,
  execFileGitRunner,
} from "./git";
import { DataBranchStore } from "./store";
import { snapshotSourceSchema } from "../schemas";

/**
 * CLI for data-branch snapshot operations. Run with tsx, e.g.:
 *
 *   tsx src/snapshots/cli.ts init --dir <data-branch-root>
 *   tsx src/snapshots/cli.ts write --dir <data-branch-root> --input <envelope.json>
 *   tsx src/snapshots/cli.ts resolve --dir <data-branch-root> --source aa [--as-of <isoUtc>]
 *   tsx src/snapshots/cli.ts commit --repo <data-branch-checkout> --message "collect: aa ..."
 *
 * `--dir`/`--repo` point at a checked-out working tree of the bench-bus-data
 * branch. Git branch creation/checkouts are owned by the caller (Actions or
 * the developer); this CLI never switches branches itself.
 */

function usage(): never {
  console.error(
    [
      "Usage:",
      "  cli.ts init --dir <dataBranchRoot>",
      "  cli.ts write --dir <dataBranchRoot> --input <envelope.json> [--allow-empty]",
      "  cli.ts resolve --dir <dataBranchRoot> --source <aa|openrouter|cursor> [--as-of <isoUtc>]",
      "  cli.ts commit --repo <dataBranchCheckout> --message <message> [--any-branch]",
    ].join("\n"),
  );
  process.exit(2);
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command) usage();

  if (command === "init") {
    const dir = flag(rest, "--dir");
    if (!dir) usage();
    const store = new DataBranchStore(dir);
    await store.init();
    console.log(`initialized data-branch skeleton at ${dir}`);
    return;
  }

  if (command === "write") {
    const dir = flag(rest, "--dir");
    const input = flag(rest, "--input");
    if (!dir || !input) usage();
    const store = new DataBranchStore(dir);
    await store.init();
    const envelope = JSON.parse(await fs.readFile(input, "utf8")) as unknown;
    const stored = await store.writeSnapshot(envelope, {
      allowEmpty: rest.includes("--allow-empty"),
    });
    console.log(`wrote ${stored.path} (latestKnownGood=${stored.manifest.latestKnownGood})`);
    return;
  }

  if (command === "resolve") {
    const dir = flag(rest, "--dir");
    const source = flag(rest, "--source");
    if (!dir || !source) usage();
    const asOf = flag(rest, "--as-of") ?? new Date().toISOString();
    const store = new DataBranchStore(dir);
    const resolved = await store.resolveSnapshot(
      snapshotSourceSchema.parse(source),
      asOf,
    );
    if (!resolved) {
      console.log("none");
      return;
    }
    console.log(JSON.stringify({ path: resolved.entry.path, observedAt: resolved.entry.observedAt }));
    return;
  }

  if (command === "commit") {
    const repo = flag(rest, "--repo");
    const message = flag(rest, "--message");
    if (!repo || !message) usage();
    const git = execFileGitRunner(repo);
    if (!rest.includes("--any-branch")) {
      await assertDataBranch(git);
    }
    await commitAll(git, message);
    console.log(`committed data-branch changes in ${repo}`);
    return;
  }

  usage();
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
