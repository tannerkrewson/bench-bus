import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectCursorEvals, runCollectorCli } from "./collect";
import { cursorSnapshotPayloadSchema } from "../../schemas";
import fixtureHtml from "./fixtures/cursor-evals-trimmed.html?raw";

let workDir: string;
let fixturePath: string;

beforeEach(() => {
  workDir = path.join(tmpdir(), `bench-bus-cursor-collector-test-${process.pid}-${Date.now()}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  fixturePath = path.join(workDir, "cursor-evals-trimmed.html");
  writeFileSync(fixturePath, fixtureHtml);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("collectCursorEvals", () => {
  const OBSERVED_AT = "2026-08-21T03:04:05Z";

  it("emits a schema-valid deterministic payload from a fixture", async () => {
    const result = await collectCursorEvals({ fixturePath, observedAt: OBSERVED_AT });
    const payload = cursorSnapshotPayloadSchema.parse(JSON.parse(result.payloadJson));
    expect(payload.records).toHaveLength(56);
    expect(result.rowCount).toBe(56);
    expect(result.observedAt).toBe(OBSERVED_AT);

    const repeat = await collectCursorEvals({ fixturePath, observedAt: OBSERVED_AT });
    expect(repeat.payloadJson).toBe(result.payloadJson);
  });

  it("rejects an unparseable observedAt", async () => {
    await expect(
      collectCursorEvals({ fixturePath, observedAt: "yesterday" }),
    ).rejects.toThrow(/--observed-at/);
  });

  it("fails loudly on structurally changed HTML and writes nothing", async () => {
    const brokenPath = path.join(workDir, "broken.html");
    writeFileSync(brokenPath, "<html><body>redesigned page</body></html>");
    await expect(collectCursorEvals({ fixturePath: brokenPath, observedAt: OBSERVED_AT })).rejects.toThrow();
  });
});

describe("runCollectorCli", () => {
  it("writes normalized JSON to --out and exits 0", async () => {
    const outPath = path.join(workDir, "snapshots", "cursor.json");
    const code = await runCollectorCli([
      "--fixture",
      fixturePath,
      "--out",
      outPath,
      "--observed-at",
      "2026-08-21T03:04:05Z",
    ]);
    expect(code).toBe(0);
    const payload = cursorSnapshotPayloadSchema.parse(JSON.parse(readFileSync(outPath, "utf8")));
    expect(payload.records).toHaveLength(56);
  }, 15_000);

  it("is byte-deterministic across runs with the same observedAt", async () => {
    const out1 = path.join(workDir, "a.json");
    const out2 = path.join(workDir, "b.json");
    await runCollectorCli(["--fixture", fixturePath, "--out", out1, "--observed-at", "2026-08-21T03:04:05Z"]);
    await runCollectorCli(["--fixture", fixturePath, "--out", out2, "--observed-at", "2026-08-21T03:04:05Z"]);
    expect(readFileSync(out1, "utf8")).toBe(readFileSync(out2, "utf8"));
  }, 15_000);

  it("exits nonzero and writes no output when the page structure changed (fail closed)", async () => {
    const brokenPath = path.join(workDir, "broken.html");
    writeFileSync(brokenPath, "<html><body>redesigned page</body></html>");
    const outPath = path.join(workDir, "should-not-exist.json");
    const code = await runCollectorCli(["--fixture", brokenPath, "--out", outPath]);
    expect(code).toBe(1);
    expect(existsSync(outPath)).toBe(false);
  });

  it("exits nonzero on unknown arguments", async () => {
    const code = await runCollectorCli(["--bogus"]);
    expect(code).toBe(2);
  });

  it("prints usage for --help and exits 0", async () => {
    const code = await runCollectorCli(["--help"]);
    expect(code).toBe(0);
  });
});
