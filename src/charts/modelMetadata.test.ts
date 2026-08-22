import { describe, expect, it } from "vitest";
import {
  modelDisplayMetadata,
  modelGroupKey,
  preferredFamilyLabel,
} from "./modelMetadata";

describe("modelDisplayMetadata", () => {
  it("canonicalizes concise labels and reasoning efforts across AA and Cursor spellings", () => {
    expect(modelDisplayMetadata("Claude Opus 5 (Adaptive Reasoning, High Effort)")).toMatchObject({
      label: "Opus 5 high",
      groupKey: "opus-5",
      effort: "high",
    });
    expect(modelDisplayMetadata("Opus 5 High")).toMatchObject({
      label: "Opus 5 high",
      groupKey: "opus-5",
      effort: "high",
    });
    expect(modelDisplayMetadata("DeepSeek V4 Flash 0731 (max)")).toMatchObject({
      label: "DeepSeek v4 Flash 0731 max",
      groupKey: "deepseek-v4-flash-0731",
      effort: "max",
    });
    expect(modelDisplayMetadata("DeepSeek V4 Flash 0731 (Reasoning, Max Effort)")).toEqual({
      label: "DeepSeek v4 Flash 0731 max",
      groupKey: "deepseek-v4-flash-0731",
      effort: "max",
    });
  });

  it("keeps the canonical GPT prefix and shortens extra high", () => {
    const aa = modelDisplayMetadata("GPT-5.6 Luna (low)");
    const cursor = modelDisplayMetadata("5.6 Luna xhigh");
    expect(aa.label).toBe("GPT-5.6 Luna low");
    expect(cursor.label).toBe("GPT-5.6 Luna xhigh");
    expect(aa.groupKey).toBe(cursor.groupKey);
    expect(aa.label).not.toMatch(/[()]/);
    expect(cursor.label).not.toContain("extra");
    expect(modelGroupKey("GPT-5.6 Luna (high)")).toBe("gpt-5-6-luna");

    const nonReasoning = modelDisplayMetadata("GPT-5.6 Luna (Non-reasoning)", "gpt-5-6-luna-non-reasoning");
    expect(nonReasoning).toEqual({
      label: "GPT-5.6 Luna",
      groupKey: "gpt-5-6-luna",
    });
    expect(nonReasoning.label).not.toMatch(/[()]/);
  });

  it("prefers high as a family label, then the highest available effort", () => {
    expect(preferredFamilyLabel([
      { label: "Opus 5 low", effort: "low" },
      { label: "Opus 5 high", effort: "high" },
      { label: "Opus 5 xhigh", effort: "xhigh" },
    ], "Opus 5")).toBe("Opus 5 high");
    expect(preferredFamilyLabel([
      { label: "Luna low", effort: "low" },
      { label: "Luna xhigh", effort: "xhigh" },
    ], "Luna")).toBe("Luna xhigh");
  });
});
