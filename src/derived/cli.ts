import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataBranchStore } from "../snapshots/store";
import { loadAliasFile } from "../collectors/openrouter/mapping";
import { parseCuratedModelConfig } from "../collectors/openrouter/curated";
import { NoDataAtTimeError, compileBundle, parseDerivedIndex, upsertDerivedIndexEntry } from "./compile";

/**
 * Build-time CLI: compile compact point-in-time chart datasets from a
 * bench-bus-data checkout.
 *
 * Usage:
 *   tsx src/derived/cli.ts --data-dir <dataBranchRoot> --out-dir <outputDir>
 *     [--as-of <isoUtc>] [--name <fileSlug>] [--aliases <aliasJsonPath>]
 *
 * Defaults: as-of = latest known-good of every source; name = "latest";
 * aliases = src/collectors/openrouter/openrouter-aliases.json in this repo.
 *
 * Writes `<out-dir>/<name>.json` (compact bundle) and rewrites
 * `<out-dir>/index.json` (deterministic index of compiled views). Fails
 * nonzero without writing anything when no eligible snapshots exist.
 */

interface CliArgs {
  dataDir: string;
  outDir: string;
  asOf?: string;
  name: string;
  aliasesPath: string;
  curatedConfigPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dataDir: "",
    outDir: "",
    name: "latest",
    aliasesPath: fileURLToPath(new URL("../collectors/openrouter/openrouter-aliases.json", import.meta.url)),
    curatedConfigPath: fileURLToPath(new URL("../collectors/openrouter/curated-models.json", import.meta.url)),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--data-dir") args.dataDir = next();
    else if (arg === "--out-dir") args.outDir = next();
    else if (arg === "--as-of") args.asOf = next();
    else if (arg === "--name") args.name = next();
    else if (arg === "--aliases") args.aliasesPath = next();
    else if (arg === "--curated-config") args.curatedConfigPath = next();
    else if (arg === "--help" || arg === "-h") {
      console.log("See header comment in src/derived/cli.ts for usage.");
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!args.dataDir) throw new Error("--data-dir is required (bench-bus-data checkout root)");
  if (!args.outDir) throw new Error("--out-dir is required (derived output directory)");
  if (!/^[\w.-]+$/.test(args.name)) throw new Error("--name must be a simple file slug (letters, digits, ., _, -)");
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const aliases = loadAliasFile(args.aliasesPath, (p) => readFileSync(p, "utf8"));
  const curatedModels = parseCuratedModelConfig(
    readFileSync(args.curatedConfigPath, "utf8"),
    args.curatedConfigPath,
  ).models;

  const store = new DataBranchStore(args.dataDir);
  const compiled = await compileBundle(store, { asOf: args.asOf, aliases, curatedModels });

  await fs.mkdir(args.outDir, { recursive: true });
  const bundleFile = path.join(args.outDir, `${args.name}.json`);
  await fs.writeFile(bundleFile, compiled.json, "utf8");

  const indexFile = path.join(args.outDir, "index.json");
  let rawIndex: string | undefined;
  try {
    rawIndex = await fs.readFile(indexFile, "utf8");
  } catch {
    rawIndex = undefined;
  }
  const index = parseDerivedIndex(rawIndex);
  const indexJson = upsertDerivedIndexEntry(index, {
    asOf: compiled.asOf,
    path: `${args.name}.json`,
    aa: compiled.bundle.aa !== null,
    cursor: compiled.bundle.cursor !== null,
  });
  await fs.writeFile(indexFile, indexJson, "utf8");

  const inBytes = compiled.json.length;
  console.log(
    `compiled ${bundleFile} (${inBytes} bytes, asOf=${compiled.asOf}) ` +
      `aa=${compiled.bundle.aa ? `${compiled.stats.aaMatched} models` : "unavailable"} ` +
      `(${compiled.stats.aaUnmatched} unmatched AA, ${compiled.stats.openrouterUnmatched} unmatched OR pricing, ` +
      `${compiled.stats.provisionalAliasesUsed} provisional aliases) ` +
      `cursor=${compiled.bundle.cursor ? `${compiled.stats.cursorRecords} rows` : "unavailable"}`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof NoDataAtTimeError) {
      console.error(`[derived] FAILED: ${error.message}`);
    } else {
      console.error(`[derived] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  });
