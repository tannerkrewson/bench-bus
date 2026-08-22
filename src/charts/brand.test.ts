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

  it("keeps general family slots stable while preferred families share reserved colors", () => {
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
    const lightColors = familyKeys.map((key) => modelGroupColor(key, false));
    const darkColors = familyKeys.map((key) => modelGroupColor(key, true));

    expect(lightColors).toEqual([
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[2],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[3],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[4],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[5],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[6],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[7],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[0],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[10],
    ]);
    expect(darkColors).toEqual([
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[2],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[3],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[4],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[5],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[6],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[7],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[0],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[10],
    ]);
  });

  it("keeps Luna, Sol, and Opus source keys visibly distinct", () => {
    expect(new Set([
      modelGroupColor("gpt-5-6-luna", false),
      modelGroupColor("gpt-5-6-sol", false),
      modelGroupColor("opus-5", false),
    ]).size).toBe(3);
    expect(new Set([
      modelGroupColor("gpt-5-6-luna", true),
      modelGroupColor("gpt-5-6-sol", true),
      modelGroupColor("opus-5", true),
    ]).size).toBe(3);
  });

  it("reserves compliant blue for all DeepSeek variants and orange for Opus variants", () => {
    expect(modelGroupColor("deepseek-v4-flash-0731", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[0]);
    expect(modelGroupColor("deepseek-v5-new-variant", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[0]);
    expect(modelGroupColor("deepseek-v5-new-variant", true)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.dark[0]);
    expect(modelGroupColor("opus-5", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[1]);
    expect(modelGroupColor("opus-6-latest", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[1]);
    expect(modelGroupColor("opus-6-latest", true)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.dark[1]);
    expect(modelGroupColor("grok-4-6", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[2]);
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

  it("uses the compliant family palette for provider fallback colors", () => {
    expect(modelBrandColor("openai", false)).toBe(modelGroupColor("openai", false));
    expect(modelBrandColor("openai", true)).toBe(modelGroupColor("openai", true));
  });
});
