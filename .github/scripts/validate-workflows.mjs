#!/usr/bin/env node
/**
 * Structural smoke test for the collection workflow YAMLs. Deliberately
 * dependency-free: checks the invariants the workflows must keep (schedules,
 * manual dispatch, concurrency guards, least-privilege permissions, timeouts,
 * composite-action wiring) with targeted line-level assertions instead of a
 * full YAML parser.
 *
 * Usage:  node .github/scripts/validate-workflows.mjs
 * Exit 0 when every expectation holds; nonzero otherwise.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ghDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(ghDir, "workflows");

const expectations = [
  {
    file: "collect-openrouter.yml",
    crons: ["23 */2 * * *"],
  },
  {
    file: "collect-aa.yml",
    crons: ["17 4 * * *"],
  },
  {
    file: "collect-cursor.yml",
    crons: ["41 5 * * *"],
  },
];

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

async function main() {
  const workflowFiles = (await readdir(workflowsDir)).filter((f) => f.endsWith(".yml"));

  check(
    "exactly the three collection workflows exist (no Pages deploy workflow here)",
    workflowFiles.length === 3 &&
      expectations.every((e) => workflowFiles.includes(e.file)),
  );

  for (const expectation of expectations) {
    const text = await readFile(join(workflowsDir, expectation.file), "utf8");
    const name = expectation.file;

    for (const cron of expectation.crons) {
      check(`${name}: schedule includes cron "${cron}"`, text.includes(`cron: "${cron}"`));
    }
    check(`${name}: workflow_dispatch trigger present`, text.includes("workflow_dispatch"));
    check(
      `${name}: concurrency group with cancel-in-progress: false (queue, never race)`,
      /concurrency:\s*\n\s*group: \S+\s*\n\s*cancel-in-progress: false/.test(text),
    );
    check(
      `${name}: workflow-level permissions limited to contents: read`,
      /permissions:\s*\n\s*contents: read\s*\n/.test(text),
    );
    check(
      `${name}: job-level contents: write (data-branch push only)`,
      /contents: write/.test(text),
    );
    check(`${name}: job timeout-minutes set`, /timeout-minutes: \d+/.test(text));
    check(
      `${name}: uses the shared collect-and-store composite action`,
      text.includes("./.github/actions/collect-and-store"),
    );
    check(
      `${name}: checks out the bench-bus-data branch into a separate path`,
      text.includes("ref: bench-bus-data") && text.includes("path: data-branch"),
    );
    check(
      `${name}: source checkout does not persist credentials`,
      text.includes("persist-credentials: false"),
    );
    check(
      `${name}: documents best-effort scheduling`,
      text.includes("best-effort"),
    );
  }

  const action = await readFile(
    join(ghDir, "actions/collect-and-store/action.yml"),
    "utf8",
  );
  check(
    "composite action runs collector with fail-closed --out envelope",
    action.includes("collect:${SOURCE}") && action.includes("--out"),
  );
  check(
    "composite action validates + writes via the snapshot store",
    action.includes("snapshot -- write") && action.includes("--input"),
  );
  check(
    "composite action commits via the guarded snapshot commit",
    action.includes("snapshot -- commit") && action.includes("--repo"),
  );
  check(
    "composite action pushes HEAD:bench-bus-data",
    action.includes("HEAD:bench-bus-data"),
  );

  if (failures > 0) {
    console.error(`\nworkflow validation FAILED: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nworkflow validation PASSED");
}

main();
