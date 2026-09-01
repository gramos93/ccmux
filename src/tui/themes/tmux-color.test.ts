import { describe, it, expect } from "bun:test";
import { tmuxColorToHex, parseTmuxStyle } from "./tmux-color";

describe("tmuxColorToHex", () => {
  it("passes through #rrggbb hex, lowercased", () => {
    expect(tmuxColorToHex("#1A1B26")).toBe("#1a1b26");
    expect(tmuxColorToHex("#1a1b26")).toBe("#1a1b26");
  });

  it("resolves colour0-15 / color0-15 to the standard xterm table", () => {
    expect(tmuxColorToHex("colour0")).toBe("#000000");
    expect(tmuxColorToHex("color0")).toBe("#000000");
    expect(tmuxColorToHex("colour15")).toBe("#ffffff");
  });

  it("resolves a 6x6x6 cube value", () => {
    // colour208: cube index 192 -> r=5,g=2,b=0 -> ramp[5]=255, ramp[2]=135, ramp[0]=0
    expect(tmuxColorToHex("colour208")).toBe("#ff8700");
  });

  it("resolves a grayscale ramp value", () => {
    // colour244: level = 8 + (244-232)*10 = 128 = 0x80
    expect(tmuxColorToHex("colour244")).toBe("#808080");
  });

  it("returns undefined for out-of-range or non-numeric colour tokens", () => {
    expect(tmuxColorToHex("colour256")).toBeUndefined();
    expect(tmuxColorToHex("colourabc")).toBeUndefined();
  });

  it("resolves ANSI names, case-insensitively, including bright variants", () => {
    expect(tmuxColorToHex("black")).toBe("#000000");
    expect(tmuxColorToHex("White")).toBe("#c0c0c0");
    expect(tmuxColorToHex("BrightWhite")).toBe("#ffffff");
    expect(tmuxColorToHex("brightred")).toBe("#ff0000");
    expect(tmuxColorToHex("BRIGHTBLACK")).toBe("#808080");
  });

  it("returns undefined for default and unknown tokens", () => {
    expect(tmuxColorToHex("default")).toBeUndefined();
    expect(tmuxColorToHex("terminal")).toBeUndefined();
    expect(tmuxColorToHex("garbage")).toBeUndefined();
  });
});

describe("parseTmuxStyle", () => {
  it("extracts fg and bg from a mixed style string", () => {
    expect(parseTmuxStyle("fg=colour15,bg=#1a1b26,bold")).toEqual({
      fg: "#ffffff",
      bg: "#1a1b26",
    });
  });

  it("omits keys with unresolvable values", () => {
    expect(parseTmuxStyle("bg=black")).toEqual({ bg: "#000000" });
    expect(parseTmuxStyle("fg=default,bg=default")).toEqual({});
  });

  it("ignores attribute-only and empty input", () => {
    expect(parseTmuxStyle("bold,italic")).toEqual({});
    expect(parseTmuxStyle("")).toEqual({});
  });
});
