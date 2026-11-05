#!/usr/bin/env node
/**
 * Structural smoke test for the daily refresh workflow. Deliberately
 * dependency-free: checks the invariants the workflow must keep (one daily
 * schedule, one job, concurrency guard, least privilege, timeout, script
 * wiring) with targeted line-level assertions instead of a full YAML parser.
 *
 * Usage:  node .github/scripts/validate-workflows.mjs
 * Exit 0 when every expectation holds; nonzero otherwise.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ghDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(ghDir, "workflows");

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

async function main() {
  const workflowFiles = (await readdir(workflowsDir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  check("only ci.yml and refresh.yml exist", workflowFiles.join() === "ci.yml,refresh.yml");

  const ci = await readFile(join(workflowsDir, "ci.yml"), "utf8");
  check("ci.yml: has no schedule", !/^\s*(?:schedule\s*:|(?:-\s*)?cron\s*:)/m.test(ci));

  const refresh = await readFile(join(workflowsDir, "refresh.yml"), "utf8");
  const crons = refresh.match(/^\s*-\s*cron\s*:\s*"([^"]+)"/gm) ?? [];
  check("refresh.yml: exactly one schedule", crons.length === 1);
  check("refresh.yml: runs once a day", /cron: "\d+ \d+ \* \* \*"/.test(refresh));
  check("refresh.yml: scheduled in Eastern time", refresh.includes('timezone: "America/New_York"'));
  check("refresh.yml: workflow_dispatch trigger present", /^  workflow_dispatch:/m.test(refresh));
  check("refresh.yml: never triggers on push", !/^  push:/m.test(refresh));
  check(
    "refresh.yml: concurrency group queues instead of racing",
    /concurrency:\s*\n\s*group: \S+\s*\n\s*cancel-in-progress: false/.test(refresh),
  );
  check(
    "refresh.yml: workflow-level permissions limited to contents: read",
    /^permissions:\s*\n\s*contents: read\s*\n/m.test(refresh),
  );
  check("refresh.yml: job timeout-minutes set", /timeout-minutes: \d+/.test(refresh));
  check(
    "refresh.yml: source checkout does not persist credentials",
    refresh.includes("persist-credentials: false"),
  );
  check(
    "refresh.yml: checks out data and site branches into separate paths",
    refresh.includes("ref: bench-bus-data") && refresh.includes("path: data-branch") &&
      refresh.includes("ref: gh-pages") && refresh.includes("path: site"),
  );
  check("refresh.yml: runs the refresh script", refresh.includes(".github/scripts/daily-refresh.sh"));

  const script = await readFile(join(ghDir, "scripts/daily-refresh.sh"), "utf8");
  for (const source of ["aa", "cursor", "deepswe"]) {
    check(`daily-refresh.sh: collects ${source}`, new RegExp(`^collect ${source}$`, "m").test(script));
  }
  check("daily-refresh.sh: collects openrouter", /^collect openrouter /m.test(script));
  check("daily-refresh.sh: stores via the snapshot CLI", script.includes("snapshot -- write"));
  check("daily-refresh.sh: commits via the guarded snapshot commit", script.includes("snapshot -- commit"));
  check("daily-refresh.sh: pushes both branches", script.includes("HEAD:bench-bus-data") && script.includes("HEAD:gh-pages"));
  check("daily-refresh.sh: verifies the custom domain", script.includes("dist/CNAME"));

  if (failures > 0) {
    console.error(`\nworkflow validation FAILED: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nworkflow validation PASSED");
}

main();
