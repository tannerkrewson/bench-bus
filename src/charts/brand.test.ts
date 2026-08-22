import { describe, expect, it } from "vitest";
import {
  COLOR_BLIND_CONTRAST_TARGET,
  COLOR_BLIND_MODEL_GROUP_PALETTE,
  COLOR_BLIND_SURFACE_SWATCHES,
  effortGroupColor,
  inferModelBrand,
  modelBrandColor,
  modelGroupColor,
} from "./brand";

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it("keeps every known family on a distinct color-blind slot", () => {
    const familyKeys = [
      "opus-5",
      "sonnet-5",
      "grok-4-6",
      "luna",
      "sol",
      "terra",
      "fable-5",
      "composer-2-5",
      "opus-4-8",
      "deepseek-v4-flash-0731",
      "gemini-3-7-flash",
    ];
    const lightColors = familyKeys.map((key) => modelGroupColor(key, false, true));
    const darkColors = familyKeys.map((key) => modelGroupColor(key, true, true));

    expect(new Set(lightColors).size).toBe(familyKeys.length);
    expect(new Set(darkColors).size).toBe(familyKeys.length);
    expect(lightColors).toEqual([...COLOR_BLIND_MODEL_GROUP_PALETTE.light]);
    expect(darkColors).toEqual([...COLOR_BLIND_MODEL_GROUP_PALETTE.dark]);
    expect(modelGroupColor("opus-5", false, true)).not.toBe(modelGroupColor("opus-5", false));
  });

  it("keeps every color-blind slot above the contrast target on supported surfaces", () => {
    for (const color of COLOR_BLIND_MODEL_GROUP_PALETTE.light) {
      for (const surface of COLOR_BLIND_SURFACE_SWATCHES.light) {
        expect(
          contrastRatio(color, surface.color),
          `${color} on ${surface.theme} ${surface.color}`,
        ).toBeGreaterThanOrEqual(COLOR_BLIND_CONTRAST_TARGET);
      }
    }
    for (const color of COLOR_BLIND_MODEL_GROUP_PALETTE.dark) {
      for (const surface of COLOR_BLIND_SURFACE_SWATCHES.dark) {
        expect(
          contrastRatio(color, surface.color),
          `${color} on ${surface.theme} ${surface.color}`,
        ).toBeGreaterThanOrEqual(COLOR_BLIND_CONTRAST_TARGET);
      }
    }
  });

  it("keeps OpenAI readable in both themes", () => {
    expect(modelBrandColor("openai", false)).toBe("#111111");
    expect(modelBrandColor("openai", true)).toBe("#f8fafc");
  });
});
