/**
 * Detects the running tmux server's theme by probing its appearance options,
 * for the `theme: "auto"` config mode. DI-friendly: the caller supplies
 * `runTmux` (mirrors `probeAllowPassthrough` in `src/lib/notify-osc.ts`) so
 * this stays testable without spawning a real tmux process.
 */

import { nearestBuiltinTheme } from "./auto-match";
import { parseTmuxStyle } from "./tmux-color";

export interface AutoDetectResult {
  /** Closest built-in theme name, or `null` if nothing usable was found. */
  themeName: string | null;
  /** Which tmux option/channel produced the color, for warnings/debugging. */
  source: string | null;
  warnings: string[];
}

interface Probe {
  option: string;
  /** Whether the `fg` fallback (used when `bg` is unset) is an approximation. */
  fgIsApproximate: boolean;
}

const PROBES: Probe[] = [
  { option: "window-active-style", fgIsApproximate: true },
  { option: "window-style", fgIsApproximate: true },
  { option: "pane-active-border-style", fgIsApproximate: true },
  { option: "pane-border-style", fgIsApproximate: true },
  { option: "status-style", fgIsApproximate: true },
];

/**
 * Probes tmux options in priority order (window > pane border > status;
 * `bg` before `fg`) for a usable color, then resolves it to the nearest
 * built-in ccmux palette. Returns `themeName: null` with a warning if ccmux
 * isn't running inside tmux, or if no option yields a usable color.
 */
export function detectTmuxTheme(
  runTmux: (args: string[]) => string | null,
  env: { TMUX?: string } = process.env as { TMUX?: string },
): AutoDetectResult {
  if (!env.TMUX) {
    return {
      themeName: null,
      source: null,
      warnings: ['not running inside tmux; "auto" theme falls back to default'],
    };
  }

  for (const probe of PROBES) {
    const raw = runTmux(["show-options", "-gv", probe.option]);
    if (!raw) continue;
    const { bg, fg } = parseTmuxStyle(raw.trim());
    if (bg) {
      const { name } = nearestBuiltinTheme(bg);
      return { themeName: name, source: `${probe.option} bg`, warnings: [] };
    }
    if (fg && probe.fgIsApproximate) {
      const { name } = nearestBuiltinTheme(fg);
      return {
        themeName: name,
        source: `${probe.option} fg (approximate)`,
        warnings: [],
      };
    }
  }

  return {
    themeName: null,
    source: null,
    warnings: [
      "could not detect a tmux background color from window/pane/status styles; using default theme",
    ],
  };
}
