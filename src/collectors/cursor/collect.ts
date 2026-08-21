import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseCursorEvalsPage } from "./parse";
import { buildSnapshotPayload } from "./normalize";

/**
 * CLI collector for the CursorBench table at https://cursor.com/evals.
 *
 * Fail-closed contract: any fetch, parse, or validation failure exits nonzero
 * with diagnostics and never writes output, so last-known-good data on the
 * data branch is never replaced by a partial or corrupt run.
 *
 * Run with: npx tsx src/collectors/cursor/collect.ts --out <file> [--observed-at <iso>] [--url <url>] [--fixture <file>]
 */

export const CURSOR_EVALS_URL = "https://cursor.com/evals";
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;

export interface CollectOptions {
  url?: string;
  fixturePath?: string;
  outPath?: string;
  observedAt?: string;
}

function usage(): string {
  return [
    "Usage: npx tsx src/collectors/cursor/collect.ts [options]",
    "",
    "Options:",
    "  --out <file>        Write normalized JSON snapshot to <file> (required unless --fixture dry-run)",
    "  --observed-at <iso> Observation timestamp (ISO UTC); defaults to current time",
    "  --url <url>         Page URL (default: " + CURSOR_EVALS_URL + ")",
    "  --fixture <file>    Read HTML from a local fixture instead of fetching (offline/testing)",
    "  --help              Show this help",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CollectOptions {
  const options: CollectOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--out":
        options.outPath = argv[++i];
        break;
      case "--observed-at":
        options.observedAt = argv[++i];
        break;
      case "--url":
        options.url = argv[++i];
        break;
      case "--fixture":
        options.fixturePath = argv[++i];
        break;
      case "--help":
        throw new HelpRequested();
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  return options;
}

export class HelpRequested extends Error {
  constructor() {
    super(usage());
  }
}

async function fetchWithRetries(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 BenchBusCollector/1.0",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        const backoffMs = 2_000 * attempt;
        console.error(`[cursor-collector] fetch attempt ${attempt} failed (${String(error)}); retrying in ${backoffMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw new Error(`Fetching ${url} failed after ${FETCH_ATTEMPTS} attempts: ${String(lastError)}`);
}

function resolveObservedAt(requested: string | undefined): string {
  if (requested === undefined) {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  const parsed = Date.parse(requested);
  if (Number.isNaN(parsed)) {
    throw new Error(`--observed-at must be an ISO UTC timestamp, got "${requested}"`);
  }
  return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Write atomically: temp file in the same directory, then rename over the target. */
async function writeAtomic(outPath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  const tempPath = path.join(
    path.dirname(path.resolve(outPath)),
    `.${path.basename(outPath)}.tmp-${process.pid}`,
  );
  try {
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, path.resolve(outPath));
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export interface CollectResult {
  payloadJson: string;
  rowCount: number;
  observedAt: string;
}

/** Core collection pipeline. Throws on any failure; callers decide about output. */
export async function collectCursorEvals(options: CollectOptions): Promise<CollectResult> {
  const observedAt = resolveObservedAt(options.observedAt);
  const html = options.fixturePath
    ? await fs.readFile(options.fixturePath, "utf8")
    : await fetchWithRetries(options.url ?? CURSOR_EVALS_URL);

  const { rows } = parseCursorEvalsPage(html);
  const payload = buildSnapshotPayload(rows, observedAt);

  // Deterministic serialization: records are schema-sorted, field order fixed, UTC timestamps.
  const payloadJson = JSON.stringify(payload, null, 2) + "\n";
  return { payloadJson, rowCount: payload.records.length, observedAt };
}

/**
 * CLI entry point. Returns the process exit code: 0 on success, nonzero on
 * any failure (nothing is written unless the full pipeline succeeded).
 */
export async function runCollectorCli(argv: readonly string[]): Promise<number> {
  let options: CollectOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof HelpRequested) {
      console.log(error.message);
      return 0;
    }
    console.error(`[cursor-collector] ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  try {
    const result = await collectCursorEvals(options);
    if (options.outPath) {
      await writeAtomic(options.outPath, result.payloadJson);
      console.log(
        `[cursor-collector] wrote ${result.rowCount} CursorBench records (observedAt ${result.observedAt}) to ${options.outPath}`,
      );
    } else {
      process.stdout.write(result.payloadJson);
    }
    return 0;
  } catch (error) {
    console.error(
      `[cursor-collector] collection FAILED; no output written (last-known-good data untouched): ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCollectorCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  });
}
