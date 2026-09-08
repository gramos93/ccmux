/**
 * Classifies a detected tmux background color as light/dark and picks the
 * nearest built-in ccmux palette in that family. Pure, no I/O.
 */

import { BUILTIN_THEMES, BUILTIN_THEME_NAMES } from "./index";

export type ThemeFamily = "light" | "dark";

/** Above this relative luminance, a background reads as "light" (WCAG midpoint). */
const LUMINANCE_THRESHOLD = 0.179;

/** Built-in palettes with a light background; every other name is "dark". */
const LIGHT_THEME_NAMES = [
  "catppuccin-latte",
  "tokyo-night-day",
  "gruvbox-light",
  "rose-pine-dawn",
];

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Classifies a `#rrggbb` background color as light or dark. */
export function classifyFamily(hex: string): ThemeFamily {
  return relativeLuminance(hex) >= LUMINANCE_THRESHOLD ? "light" : "dark";
}

function rgbDistance(a: string, b: string): number {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return Math.sqrt((ar! - br!) ** 2 + (ag! - bg!) ** 2 + (ab! - bb!) ** 2);
}

/**
 * Picks the built-in theme whose family matches `hex` and whose semantic
 * `base` is closest to it by RGB distance.
 */
export function nearestBuiltinTheme(hex: string): {
  name: string;
  family: ThemeFamily;
} {
  const family = classifyFamily(hex);
  const candidates = BUILTIN_THEME_NAMES.filter((name) =>
    family === "light"
      ? LIGHT_THEME_NAMES.includes(name)
      : !LIGHT_THEME_NAMES.includes(name),
  );

  let best = candidates[0]!;
  let bestDistance = Infinity;
  for (const name of candidates) {
    const distance = rgbDistance(hex, BUILTIN_THEMES[name]!.semantic.base);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return { name: best, family };
}
