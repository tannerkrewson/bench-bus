#!/usr/bin/env node
/**
 * Offline dry-run of the Actions collect -> snapshot -> commit flow.
 *
 * Exercises exactly what the collect-and-store composite action does, without
 * network access and without pushing:
 *
 *   1. initialize a fresh temporary bench-bus-data checkout skeleton
 *   2. `snapshot write` a fixture envelope (full schema re-validation)
 *   3. `snapshot commit` (with the assertDataBranch guard bypassed via
 *      --any-branch, since the temp repo's branch is not bench-bus-data)
 *   4. assert the snapshot file + manifest landed as expected
 *   5. negative case: an invalid envelope must fail and change nothing
 *
 * Usage:  node .github/scripts/dry-run-collect-flow.mjs
 * Exit 0 on success; nonzero on any failure.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixturePath = join(repoRoot, ".github/scripts/fixtures/sample-envelope.json");

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    ...opts,
  });
}

function npmSnapshot(args, opts = {}) {
  return run("npm", ["run", "--silent", "snapshot", "--", ...args], opts);
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), "bench-bus-dry-run-"));
  let failures = 0;
  const check = (label, ok) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures += 1;
  };

  try {
    // 1. Fresh data-branch skeleton (same as `cli.ts init` on first run).
    const dataDir = join(work, "data-branch");
    run("git", ["init", "-q", dataDir]);
    npmSnapshot(["init", "--dir", dataDir], { quiet: true });

    // 2. Write a valid fixture envelope through the store.
    npmSnapshot(["write", "--dir", dataDir, "--input", fixturePath], { quiet: true });

    // 3. Commit (any-branch: the temp repo is not on bench-bus-data).
    npmSnapshot(
      ["commit", "--repo", dataDir, "--message", "dry-run: fixture snapshot", "--any-branch"],
      { quiet: true },
    );

    // 4. Assertions: snapshot file, manifest, latestKnownGood, clean git tree.
    const snapshotFiles = (await readdir(join(dataDir, "snapshots/cursor/v1")))
      .filter((f) => f.endsWith(".json"));
    check("snapshot file written at deterministic path", snapshotFiles.length === 1);

    const manifest = JSON.parse(
      await readFile(join(dataDir, "manifests/cursor.json"), "utf8"),
    );
    check(
      "manifest latestKnownGood points at the fixture observation",
      manifest.latestKnownGood === "2026-08-21T00:00:00.000Z" &&
        manifest.entries.length === 1,
    );

    const status = run("git", ["-C", dataDir, "status", "--porcelain"], { quiet: true });
    check("data-branch working tree clean after commit", status.trim() === "");

    // 5. Negative case: corrupt envelope must fail closed and change nothing.
    const badEnvelope = JSON.parse(await readFile(fixturePath, "utf8"));
    badEnvelope.records[0].score = 999; // outside the schema's [0, 100] range
    const badPath = join(work, "bad-envelope.json");
    await writeFile(badPath, JSON.stringify(badEnvelope));
    let rejected = false;
    try {
      npmSnapshot(["write", "--dir", dataDir, "--input", badPath], { quiet: true });
    } catch {
      rejected = true;
    }
    check("invalid envelope rejected by store validation", rejected);

    const manifestAfter = JSON.parse(
      await readFile(join(dataDir, "manifests/cursor.json"), "utf8"),
    );
    check(
      "failed run left manifest and latestKnownGood untouched",
      JSON.stringify(manifestAfter) === JSON.stringify(manifest),
    );

    const snapshotDirAfter = (await readdir(join(dataDir, "snapshots/cursor/v1")))
      .filter((f) => f.endsWith(".json"));
    check("failed run wrote no extra snapshot files", snapshotDirAfter.length === 1);

    const log = run("git", ["-C", dataDir, "log", "--oneline"], { quiet: true });
    check("exactly one snapshot commit landed", log.trim().split("\n").length === 1);
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\ndry-run FAILED: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\ndry-run PASSED: collect -> snapshot -> commit flow is healthy");
}

main();
