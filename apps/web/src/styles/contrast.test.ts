import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

function palette(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  if (start === -1) throw new Error(`no ${selector} block in tokens.css`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const themes = {
  day: palette(":root"),
  night: palette(':root[data-theme="dark"]'),
};

/**
 * A wall panel is read at a distance, sometimes in the dark, and nobody is
 * going to lean in. These floors are the quality bar for the palette; the
 * night theme is deliberately dim but dim is not the same as illegible.
 */
describe.each(Object.entries(themes))("%s palette", (_name, theme) => {
  it("defines every colour role", () => {
    for (const token of ["ground", "surface", "edge", "ink", "ink-2", "ink-3", "lit", "wet", "warn"]) {
      expect(theme[token], `--${token} missing`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(["ground", "surface"])("body text clears 4.5:1 on %s", (bg) => {
    expect(contrast(theme.ink!, theme[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["ground", "surface"])("secondary text clears 4.5:1 on %s", (bg) => {
    expect(contrast(theme["ink-2"]!, theme[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["ground", "surface"])("tertiary text clears 3:1 on %s", (bg) => {
    // Used only for small supporting detail, so it sits at the large-text floor.
    expect(contrast(theme["ink-3"]!, theme[bg]!)).toBeGreaterThanOrEqual(3);
  });

  // "Overdue" on a task is small bold text in the warning colour.
  it("the warning colour is legible as small text on a surface", () => {
    expect(contrast(theme.warn!, theme.surface!)).toBeGreaterThanOrEqual(4.5);
  });

  it("the rain accent stays legible as text on a surface", () => {
    expect(contrast(theme.wet!, theme.surface!)).toBeGreaterThanOrEqual(3);
  });

  it("the surface is distinguishable from the background", () => {
    expect(contrast(theme.surface!, theme.ground!)).not.toBe(1);
  });
});
