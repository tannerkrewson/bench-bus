import { collectDeepSwe, writeSnapshotPayload } from "./collect";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let out: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--out") {
      out = args[++i];
      if (!out) throw new Error("--out requires a path argument");
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: tsx src/collectors/deepswe/cli.ts [--out <path>]\n");
      return;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const { payload } = await collectDeepSwe();
  if (out) await writeSnapshotPayload(payload, out);
  else process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.stderr.write(
    `[deepswe-collector] endpoint=${payload.source.endpointUrl} ` +
      `generatedAt=${payload.source.generatedAt} records=${payload.records.length} ` +
      `observedAt=${payload.observedAt}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`[deepswe-collector] FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
