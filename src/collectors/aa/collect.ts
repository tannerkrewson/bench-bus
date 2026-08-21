/**
 * CLI entry point for the Artificial Analysis collector.
 *
 * Suggested package.json scripts (wired centrally by the orchestrator):
 *   "collect:aa": "tsx src/collectors/aa/collect.ts"
 *
 * Usage:
 *   tsx src/collectors/aa/collect.ts [modelSlug] [--out <path>] [--url <startUrl>]
 *
 * Emits a deterministic normalized full-model JSON dataset to --out (or
 * stdout). Exits nonzero with diagnostics on any failure; never emits
 * partial or corrupt data.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { collectAa } from "./collector";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let slug: string | undefined;
  let out: string | undefined;
  let url: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--out") {
      out = args[++i];
      if (!out) throw new Error("--out requires a path argument");
    } else if (arg === "--url") {
      url = args[++i];
      if (!url) throw new Error("--url requires a URL argument");
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: tsx src/collectors/aa/collect.ts [modelSlug] [--out <path>] [--url <startUrl>]\n",
      );
      return;
    } else if (!arg.startsWith("--")) {
      slug = arg;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const result = await collectAa({ slug, startUrl: url });
  const json = JSON.stringify(result.payload, null, 2) + "\n";

  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, json, "utf8");
  } else {
    process.stdout.write(json);
  }

  const { source, records } = result.payload;
  process.stderr.write(
    `[aa-collector] startUrl=${source.startUrl}\n` +
      `[aa-collector] rscEndpoint=${source.rscEndpoint}\n` +
      `[aa-collector] models=${records.length} ` +
      `raw=${result.stats.rawCount} ` +
      `incompleteDiscarded=${result.stats.incompleteCount} ` +
      `duplicatesDropped=${result.stats.duplicateCount} ` +
      `frontier=${result.frontier.map((model) => model.slug).join(",")}\n` +
      `[aa-collector] observedAt=${result.payload.observedAt}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[aa-collector] FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
