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
    cron: "0 1,5,9,13,17,21 * * *",
    runsPerDay: 6,
  },
  {
    file: "collect-aa.yml",
    cron: "17 0,4,8,12,16,20 * * *",
    runsPerDay: 6,
  },
  {
    file: "collect-cursor.yml",
    cron: "41 1,5,9,13,17,21 * * *",
    runsPerDay: 6,
  },
  {
    file: "collect-deepswe.yml",
    cron: "30 5 * * *",
    runsPerDay: 1,
  },
];

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

function runsPerDay(cron) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return 0;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") return 0;
  if (!/^\d+$/.test(minute) || !/^\d+(,\d+)*$/.test(hour)) return 0;
  return new Set(hour.split(",")).size;
}

async function main() {
  const workflowFiles = (await readdir(workflowsDir)).filter((f) => f.endsWith(".yml"));

  // The four collection workflows must exist; other workflows owned by
  // separate issues (ci.yml, deploy.yml) are allowed but not validated here.
  const nonCollectionWorkflows = new Set(["ci.yml", "deploy.yml"]);
  const collectionWorkflows = workflowFiles.filter((f) => !nonCollectionWorkflows.has(f));

  check(
    "exactly the four collection workflows exist (besides ci/deploy owned elsewhere)",
    collectionWorkflows.length === 4 &&
      expectations.every((e) => collectionWorkflows.includes(e.file)),
  );

  for (const expectation of expectations) {
    const text = await readFile(join(workflowsDir, expectation.file), "utf8");
    const name = expectation.file;

    const cronMatches = [...text.matchAll(/^\s*- cron: "([^"]+)"\s*$/gm)].map(
      (match) => match[1],
    );
    check(
      `${name}: has exactly one expected schedule`,
      cronMatches.length === 1 &&
        cronMatches[0] === expectation.cron &&
        runsPerDay(cronMatches[0]) === expectation.runsPerDay,
    );
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
