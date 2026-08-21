import { describe, expect, it } from "vitest";
import { assertDataBranch, commitAll, currentBranch, isDataBranch } from "./git";

function fakeRunner(responses: Record<string, string> = {}) {
  const calls: string[][] = [];
  const runner = async (args: string[]) => {
    calls.push(args);
    const key = args.join(" ");
    if (key in responses) {
      return responses[key] ?? "";
    }
    return "";
  };
  return { calls, runner };
}

describe("currentBranch / isDataBranch", () => {
  it("reads the checked-out branch name", async () => {
    const { runner } = fakeRunner({ "rev-parse --abbrev-ref HEAD": "bench-bus-data\n" });
    await expect(currentBranch(runner)).resolves.toBe("bench-bus-data");
    await expect(isDataBranch(runner)).resolves.toBe(true);
  });

  it("reports false on the source branch", async () => {
    const { runner } = fakeRunner({ "rev-parse --abbrev-ref HEAD": "main\n" });
    await expect(isDataBranch(runner)).resolves.toBe(false);
  });
});

describe("commitAll", () => {
  it("stages everything and commits", async () => {
    const { calls, runner } = fakeRunner({ "commit -m collect: aa snapshot": "" });
    await commitAll(runner, "collect: aa snapshot");
    expect(calls).toEqual([
      ["add", "-A"],
      ["commit", "-m", "collect: aa snapshot"],
    ]);
  });

  it("treats an empty commit as a no-op, not an error", async () => {
    const { runner } = fakeRunner();
    // Simulate git's failure output for nothing-to-commit.
    const failingRunner = async (args: string[]) => {
      if (args[0] === "commit") {
        throw new Error(
          "Command failed: git commit -m x\nnothing to commit, working tree clean",
        );
      }
      return "";
    };
    void runner;
    await expect(commitAll(failingRunner, "x")).resolves.toBeUndefined();
  });
});

describe("assertDataBranch", () => {
  it("passes when the data branch is checked out", async () => {
    const { runner } = fakeRunner({ "rev-parse --abbrev-ref HEAD": "bench-bus-data" });
    await expect(assertDataBranch(runner)).resolves.toBeUndefined();
  });

  it("refuses to run against the source branch (fail closed)", async () => {
    const { runner } = fakeRunner({ "rev-parse --abbrev-ref HEAD": "main" });
    await expect(assertDataBranch(runner)).rejects.toThrow(
      /expected branch "bench-bus-data" but found "main"/,
    );
  });
});
