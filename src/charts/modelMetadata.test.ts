import { describe, expect, it } from "vitest";
import {
  isNonReasoningModel,
  expandedModelName,
  latestModelVersionIds,
  modelVersionIdentity,
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
    expect(modelDisplayMetadata("DeepSeek V4 Flash", "deepseek-v4-flash")).toMatchObject({
      label: "DeepSeek v4 Flash 0731",
      groupKey: "deepseek-v4-flash-0731",
    });
    expect(modelDisplayMetadata("DeepSeek V4 Pro", "deepseek-v4-pro")).toMatchObject({
      label: "DeepSeek v4 Pro 0813",
      groupKey: "deepseek-v4-pro-0813",
    });
    expect(modelDisplayMetadata("Claude Fable 5.1 (Adaptive Reasoning, High Effort, Default Fallback)")).toEqual({
      label: "Fable 5.1 high",
      groupKey: "fable-5-1",
      effort: "high",
    });
  });

  it("marks legacy DeepSeek V4 releases as 0423 without changing later releases", () => {
    expect(modelDisplayMetadata("DeepSeek V4 Flash (Reasoning, Max Effort)", "deepseek-v4-flash-0420")).toEqual({
      label: "DeepSeek v4 Flash 0423 max",
      groupKey: "deepseek-v4-flash-0423",
      effort: "max",
    });
    expect(modelDisplayMetadata("DeepSeek V4 Pro 0424", "deepseek-v4-pro-0424")).toMatchObject({
      label: "DeepSeek v4 Pro 0423",
      groupKey: "deepseek-v4-pro-0423",
    });
    expect(modelDisplayMetadata("DeepSeek V4 Pro 0813 (max)", "deepseek-v4-pro")).toMatchObject({
      label: "DeepSeek v4 Pro 0813 max",
      groupKey: "deepseek-v4-pro-0813",
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

  it("identifies non-reasoning source rows without excluding reasoning variants", () => {
    expect(isNonReasoningModel("GPT-5.6 Luna (Non-reasoning)", "gpt-5-6-luna")).toBe(true);
    expect(isNonReasoningModel("GPT-5.6 Luna high", "gpt-5-6-luna-high")).toBe(false);
    expect(isNonReasoningModel("GPT-5.6 Luna", "gpt-5-6-luna-non-reasoning")).toBe(true);
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

  it("extracts release versions without treating date markers as releases", () => {
    expect(modelVersionIdentity("GLM 5.2 High")).toEqual({ familyKey: "glm", version: [5, 2] });
    expect(modelVersionIdentity("DeepSeek v4 Flash 0423 max")).toEqual({
      familyKey: "deepseek-flash",
      version: [4],
    });
  });

  it("keeps only the newest release in an implicit selection", () => {
    const models = [
      { id: "glm-5-2", label: "GLM 5.2" },
      { id: "glm-5-3", label: "GLM 5.3" },
      { id: "muse-spark-1-2", label: "Muse Spark 1.2" },
      { id: "muse-spark-1-3", label: "Muse Spark 1.3" },
    ];
    expect(latestModelVersionIds(models, models.map((model) => model.id))).toEqual([
      "glm-5-3",
      "muse-spark-1-3",
    ]);
  });

  it("falls back to numeric releases in ids when source labels omit them", () => {
    expect(modelVersionIdentity("Muse Spark", "muse-spark-1-2")).toEqual({
      familyKey: "muse-spark",
      version: [1, 2],
    });
    expect(modelVersionIdentity("DeepSeek Flash", "deepseek-v4-flash-0731")).toEqual({
      familyKey: "deepseek-flash",
      version: [4],
    });
    expect(latestModelVersionIds([
      { id: "muse-spark-1-2", label: "Muse Spark" },
      { id: "muse-spark-1-3", label: "Muse Spark" },
    ], ["muse-spark-1-2", "muse-spark-1-3"])).toEqual(["muse-spark-1-3"]);
  });

  it("expands provider names for detail views while leaving chart labels concise", () => {
    expect(expandedModelName("Opus 5", "claude-opus-5")).toBe("Anthropic Claude Opus 5");
    expect(expandedModelName("GPT-5.6 Sol", "gpt-5-6-sol")).toBe("OpenAI GPT-5.6 Sol");
  });
});
