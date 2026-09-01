import { describe, it, expect } from "bun:test";
import { classifyFamily, nearestBuiltinTheme } from "./auto-match";
import { BUILTIN_THEMES, BUILTIN_THEME_NAMES } from "./index";

describe("classifyFamily", () => {
  it("classifies near-black as dark and near-white as light", () => {
    expect(classifyFamily("#000000")).toBe("dark");
    expect(classifyFamily("#ffffff")).toBe("light");
  });

  it("straddles the luminance threshold correctly", () => {
    // #808080 has relative luminance ~0.216, above the 0.179 threshold.
    expect(classifyFamily("#808080")).toBe("light");
    // #707070 has relative luminance ~0.155, below the threshold.
    expect(classifyFamily("#707070")).toBe("dark");
  });
});

describe("nearestBuiltinTheme", () => {
  it("returns the exact palette when the hex matches its base exactly", () => {
    for (const name of BUILTIN_THEME_NAMES) {
      const base = BUILTIN_THEMES[name]!.semantic.base;
      expect(nearestBuiltinTheme(base).name).toBe(name);
    }
  });

  it("picks the nearer dark palette when nudged toward it", () => {
    const target = BUILTIN_THEMES["tokyo-night"]!.semantic.base;
    const { name, family } = nearestBuiltinTheme(target);
    expect(family).toBe("dark");
    expect(name).toBe("tokyo-night");
  });

  it("covers every built-in theme as light or dark, matching known light names", () => {
    const lightNames = [
      "catppuccin-latte",
      "tokyo-night-day",
      "gruvbox-light",
      "rose-pine-dawn",
    ];
    for (const name of BUILTIN_THEME_NAMES) {
      const base = BUILTIN_THEMES[name]!.semantic.base;
      const expectedFamily = lightNames.includes(name) ? "light" : "dark";
      expect(classifyFamily(base)).toBe(expectedFamily);
    }
  });
});
