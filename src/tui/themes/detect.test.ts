import { describe, it, expect } from "bun:test";
import { detectTmuxTheme } from "./detect";

describe("detectTmuxTheme", () => {
  it("short-circuits with no tmux calls when not running inside tmux", () => {
    let calls = 0;
    const runTmux = (_args: string[]) => {
      calls++;
      return null;
    };
    const result = detectTmuxTheme(runTmux, {});
    expect(result.themeName).toBeNull();
    expect(result.warnings[0]).toMatch(/not running inside tmux/);
    expect(calls).toBe(0);
  });

  it("falls back with a warning when no option yields a usable color", () => {
    const runTmux = (_args: string[]) => null;
    const result = detectTmuxTheme(runTmux, { TMUX: "/tmp/tmux-1000/default,123,0" });
    expect(result.themeName).toBeNull();
    expect(result.source).toBeNull();
    expect(result.warnings[0]).toMatch(/could not detect/);
  });

  it("picks a theme from status-style bg when nothing higher-priority is set", () => {
    const runTmux = (args: string[]) => {
      const option = args[2];
      if (option === "status-style") return "fg=colour15,bg=#1e1e2f";
      return null;
    };
    const result = detectTmuxTheme(runTmux, { TMUX: "x" });
    expect(result.themeName).toBe("catppuccin-mocha");
    expect(result.source).toBe("status-style bg");
    expect(result.warnings).toEqual([]);
  });

  it("falls back to an fg color when only a border fg is set", () => {
    const runTmux = (args: string[]) => {
      const option = args[2];
      if (option === "pane-active-border-style") return "fg=#89b4fa";
      return null;
    };
    const result = detectTmuxTheme(runTmux, { TMUX: "x" });
    expect(result.themeName).not.toBeNull();
    expect(result.source).toBe("pane-active-border-style fg (approximate)");
  });

  it("prefers an earlier-priority option over a later one", () => {
    const runTmux = (args: string[]) => {
      const option = args[2];
      if (option === "window-style") return "bg=#1e1e2f";
      if (option === "status-style") return "bg=#ffffff";
      return null;
    };
    const result = detectTmuxTheme(runTmux, { TMUX: "x" });
    expect(result.source).toBe("window-style bg");
  });
});
