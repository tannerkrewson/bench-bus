import { describe, expect, it } from "vitest";
import { effortGroupColor, inferModelBrand, modelBrandColor, modelGroupColor } from "./brand";

describe("model brand colors", () => {
  it("recognizes common provider families from model names and providers", () => {
    expect(inferModelBrand("Claude Opus", "anthropic")).toBe("anthropic");
    expect(inferModelBrand("GPT-5", "openai")).toBe("openai");
    expect(inferModelBrand("Gemini 3", "google")).toBe("google");
    expect(inferModelBrand("Composer", "cursor")).toBe("cursor");
  });

  it("assigns stable non-provider colors to effort groups", () => {
    expect(effortGroupColor("opus", false)).toBe(effortGroupColor("opus", false));
    expect(effortGroupColor("opus", false)).not.toBe(effortGroupColor("sonnet", false));
  });

  it("uses a distinct, non-white color-blind palette in both themes", () => {
    const lightColors = ["opus-5", "sonnet-5", "grok-4-6", "luna", "sol", "terra", "fable-5", "composer-2-5", "opus-4-8", "deepseek-v4-flash-0731"].map(
      (key) => modelGroupColor(key, false, true),
    );
    const darkColors = lightColors.map((_, index) => modelGroupColor(
      ["opus-5", "sonnet-5", "grok-4-6", "luna", "sol", "terra", "fable-5", "composer-2-5", "opus-4-8", "deepseek-v4-flash-0731"][index]!,
      true,
      true,
    ));
    expect(new Set(lightColors).size).toBe(lightColors.length);
    expect(new Set(darkColors).size).toBe(darkColors.length);
    expect(lightColors.every((color) => color !== "#ffffff" && color !== "#000000")).toBe(true);
    expect(darkColors.every((color) => color !== "#ffffff" && color !== "#000000")).toBe(true);
    expect(modelGroupColor("opus-5", false, true)).not.toBe(modelGroupColor("opus-5", false));
  });

  it("keeps OpenAI readable in both themes", () => {
    expect(modelBrandColor("openai", false)).toBe("#111111");
    expect(modelBrandColor("openai", true)).toBe("#f8fafc");
  });
});
