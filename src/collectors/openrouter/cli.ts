import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCuratedModelConfig } from "./curated";
import { computeAaListedParetoFrontier } from "../aa/frontier";
import { artificialAnalysisModelSchema } from "../../schemas";
import {
  collectOpenRouterPricing,
  formatReport,
  writeSnapshotPayload,
} from "./collect";

/**
 * CLI entry point: npx tsx src/collectors/openrouter/cli.ts --out <path>
 *
 * Exit codes: 0 = fully validated snapshot written (or printed);
 * nonzero = fail closed, nothing written.
 */
interface CliArgs {
  out?: string;
  aliasPath: string;
  concurrency: number;
  timeoutMs: number;
  retries: number;
  curatedConfigPath: string;
  frontierAaPath?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    aliasPath: "src/collectors/openrouter/openrouter-aliases.json",
    concurrency: 3,
    timeoutMs: 20_000,
    retries: 2,
    curatedConfigPath: fileURLToPath(new URL("./curated-models.json", import.meta.url)),
  };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case "--out":
        if (value === undefined) throw new UsageError("--out requires a path");
        args.out = value;
        i++;
        break;
      case "--mapping":
        if (value === undefined) throw new UsageError("--mapping requires a path");
        args.aliasPath = value;
        i++;
        break;
      case "--concurrency":
        args.concurrency = Number(value);
        if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
          throw new UsageError("--concurrency must be a positive integer");
        }
        i++;
        break;
      case "--timeout-ms":
        args.timeoutMs = Number(value);
        if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
          throw new UsageError("--timeout-ms must be a positive number");
        }
        i++;
        break;
      case "--frontier-aa":
        if (value === undefined) throw new UsageError("--frontier-aa requires a snapshot path");
        args.frontierAaPath = value;
        i++;
        break;
      case "--curated-config":
        if (value === undefined) throw new UsageError("--curated-config requires a path");
        args.curatedConfigPath = value;
        i++;
        break;
      case "--retries":
        args.retries = Number(value);
        if (!Number.isInteger(args.retries) || args.retries < 0) {
          throw new UsageError("--retries must be a non-negative integer");
        }
        i++;
        break;
      default:
        throw new UsageError(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

class UsageError extends Error {}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `usage: tsx src/collectors/openrouter/cli.ts [--out <path>] [--mapping <path>] [--frontier-aa <path>] [--curated-config <path>] [--concurrency N] [--timeout-ms N] [--retries N]\n${String(error)}`,
    );
    process.exitCode = 2;
    return;
  }

  try {
    let frontierModels = undefined;
    if (args.frontierAaPath !== undefined) {
      const raw = JSON.parse(readFileSync(args.frontierAaPath, "utf8")) as { records?: unknown[] };
      const records = (raw.records ?? []).map((record) => artificialAnalysisModelSchema.parse(record));
      frontierModels = computeAaListedParetoFrontier(records).map(({ slug, id }) => ({ slug, id }));
    }
    const report = await collectOpenRouterPricing({
      aliasPath: args.aliasPath,
      frontierModels,
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
      retries: args.retries,
      collectProviderDiscounts: true,
      curatedModels: parseCuratedModelConfig(readFileSync(args.curatedConfigPath, "utf8"), args.curatedConfigPath).models,
    });
    console.error(formatReport(report));
    if (args.out === undefined) {
      process.stdout.write(JSON.stringify(report.records, null, 2) + "\n");
    } else {
      await writeSnapshotPayload(report, args.out);
      console.error(`wrote validated snapshot to ${args.out}`);
    }
  } catch (error) {
    // Fail closed: any failure means no output file was written.
    if (error instanceof Error && "report" in error) {
      console.error(formatReport((error as { report: Parameters<typeof formatReport>[0] }).report));
    }
    console.error(`error: ${String(error)}`);
    process.exitCode = 1;
  }
}

// Run only when executed directly (not under vitest imports).
if (process.env["VITEST"] === undefined) {
  await main();
}
