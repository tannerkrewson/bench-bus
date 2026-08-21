/**
 * Structural regression check for the PR CI workflow (bench-bus-0cd.14).
 *
 * Guards the two properties the issue's acceptance list cares about:
 * 1. CI never requires network access to Artificial Analysis, OpenRouter, or
 *    Cursor (deterministic offline runs).
 * 2. The workflow actually runs typecheck, tests, and the production build.
 *
 * Deliberately dependency-free YAML "parsing" via targeted line checks — the
 * workflow is small and owned in-repo, so a structural drift that matters
 * (removed step, added fetch, widened permissions) trips an assertion here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Resolve relative to the repo root (npm test always runs from there). */
const CI_YML = resolve(process.cwd(), ".github/workflows/ci.yml");

function ciYml(): string {
  return readFileSync(CI_YML, "utf8");
}

describe("ci.yml workflow contract", () => {
  it("runs install, typecheck, tests, and production build", () => {
    const yml = ciYml();
    expect(yml).toContain("npm ci");
    expect(yml).toContain("npm run typecheck");
    expect(yml).toContain("npm test");
    expect(yml).toContain("npm run build");
  });

  it("requires no third-party benchmark-site network access", () => {
    const yml = ciYml();
    for (const host of ["artificialanalysis.ai", "openrouter.ai", "cursor.com"]) {
      expect(yml.includes(host), `ci.yml must not contact ${host}`).toBe(false);
    }
    // No curl/wget network calls at all.
    expect(/^\s*(curl|wget)\b/m.test(yml)).toBe(false);
  });

  it("stays least-privilege and cancels superseded runs", () => {
    const yml = ciYml();
    expect(yml).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(yml).toContain("concurrency:");
    expect(yml).toContain("cancel-in-progress: true");
    expect(yml).not.toContain("contents: write");
  });

  it("pins Node to the same major version as local development", () => {
    const yml = ciYml();
    expect(yml).toMatch(/node-version:\s*24\b/);
  });
});
