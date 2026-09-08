/**
 * Parses tmux "style" strings (e.g. `"fg=colour15,bg=#1a1b26,bold"`) into hex
 * colors, for auto-detecting the tmux theme. Pure, no I/O — see `detect.ts`
 * for the tmux-querying side.
 */

const HEX_RE = /^#[0-9a-f]{6}$/i;
const XTERM_RE = /^colou?r(\d{1,3})$/i;

/** The 16 standard xterm default colors, indexed 0-15 (bright = index + 8). */
const XTERM_16_HEX: readonly string[] = [
  "#000000",
  "#800000",
  "#008000",
  "#808000",
  "#000080",
  "#800080",
  "#008080",
  "#c0c0c0",
  "#808080",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#0000ff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];

const ANSI_NAME_INDEX: Record<string, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  brightblack: 8,
  brightred: 9,
  brightgreen: 10,
  brightyellow: 11,
  brightblue: 12,
  brightmagenta: 13,
  brightcyan: 14,
  brightwhite: 15,
};

const CUBE_RAMP = [0, 95, 135, 175, 215, 255];

function xterm256ToHex(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined;
  if (n < 16) return XTERM_16_HEX[n];
  if (n < 232) {
    const i = n - 16;
    const r = CUBE_RAMP[Math.floor(i / 36)]!;
    const g = CUBE_RAMP[Math.floor((i % 36) / 6)]!;
    const b = CUBE_RAMP[i % 6]!;
    return toHex(r, g, b);
  }
  const level = 8 + (n - 232) * 10;
  return toHex(level, level, level);
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => v.toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Resolves one tmux color token — `#rrggbb`, `colour0`-`colour255`/`color0`-
 * `color255`, an ANSI name (`black`..`white`, `bright*`), or `default` — to a
 * lowercase `#rrggbb` hex string. Returns `undefined` for `default` or any
 * token ccmux doesn't recognize (never throws).
 */
export function tmuxColorToHex(token: string): string | undefined {
  const t = token.trim();
  if (HEX_RE.test(t)) return t.toLowerCase();

  const xtermMatch = XTERM_RE.exec(t);
  if (xtermMatch) return xterm256ToHex(Number(xtermMatch[1]));

  const named = ANSI_NAME_INDEX[t.toLowerCase()];
  if (named !== undefined) return XTERM_16_HEX[named];

  return undefined;
}

/**
 * Parses a tmux style string into its usable `fg`/`bg` hex colors. Attribute
 * flags (`bold`, `none`, ...) and unresolvable values (`default`, unknown
 * tokens) are silently omitted rather than erroring.
 */
export function parseTmuxStyle(style: string): { fg?: string; bg?: string } {
  const result: { fg?: string; bg?: string } = {};
  for (const chunk of style.split(",")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    const key = chunk.slice(0, eq).trim().toLowerCase();
    if (key !== "fg" && key !== "bg") continue;
    const hex = tmuxColorToHex(chunk.slice(eq + 1));
    if (hex) result[key] = hex;
  }
  return result;
}
