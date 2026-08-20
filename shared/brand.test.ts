import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DB_RED } from "./brand";

const css = fs.readFileSync(
  path.resolve(__dirname, "../client/src/index.css"),
  "utf-8",
);

/** `h s% l%` (Tailwind/shadcn token form) -> #rrggbb */
function hslTokenToHex(token: string): string {
  const m = token.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) throw new Error(`not an hsl token: "${token}"`);
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(v * 255);
  };
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`.toUpperCase();
}

describe("brand colour", () => {
  it("matches the --primary token in index.css", () => {
    // Every `bg-primary` in the app resolves through this declaration. If
    // someone retunes the brand there, DB_RED must move with it or the map
    // markers will quietly disagree with every button on the page.
    const matches = [...css.matchAll(/--primary:\s*([^;]+);/g)].map((m) => m[1]);
    expect(matches.length).toBeGreaterThan(0);
    for (const token of matches) {
      expect(hslTokenToHex(token as string)).toBe(DB_RED.toUpperCase());
    }
  });

  it("uses the same primary in light and dark", () => {
    // A brand colour that shifts with the theme is not a brand colour.
    const matches = [...css.matchAll(/--primary:\s*([^;]+);/g)].map((m) =>
      (m[1] as string).trim(),
    );
    expect(new Set(matches).size).toBe(1);
  });

  it("is DB Red 500, the colour DB actually publish", () => {
    // github.com/db-ui/core — source/_patterns/00-base/colors: $db-color-red-500.
    // Pure #FF0000 appears on third-party brand-colour sites but not in DB's
    // own tokens, and it is the one that fails contrast.
    expect(DB_RED.toUpperCase()).toBe("#EC0016");
  });

  it("carries white text at WCAG AA for small text", () => {
    // This is the property the colour was chosen for; asserting it here means
    // a future retune cannot quietly drop below the floor.
    expect(contrast(hexToRgb(DB_RED), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });

  it("converts a known token correctly", () => {
    expect(hslTokenToHex("0 100% 50%")).toBe("#FF0000");
    expect(hslTokenToHex("0 0% 100%")).toBe("#FFFFFF");
  });
});

function hexToRgb(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2.1 relative-luminance contrast ratio. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const lum = (c: [number, number, number]) => {
    const [r, g, bl] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
