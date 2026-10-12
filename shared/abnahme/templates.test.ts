import { describe, expect, it } from "vitest";
import { ABNAHME_TEMPLATES, templateFor } from "./templates";
import { ABNAHME_TECHNIKEN } from "./types";

const COUNTS = { ZIM: 93, Video: 74, "DSA+": 74, dBOS: 85 } as const;

describe("Abnahme templates", () => {
  for (const [technik, expected] of Object.entries(COUNTS)) {
    const template = templateFor(technik as keyof typeof COUNTS);
    it(`${technik}: ${expected} items, unique ids, ids prefixed by their section`, () => {
      expect(template?.technik).toBe(technik);
      const items = template?.sections.flatMap((s) => s.items) ?? [];
      expect(items).toHaveLength(expected);
      expect(new Set(items.map((i) => i.id)).size).toBe(expected);
      for (const s of template?.sections ?? []) {
        expect(s.title.length).toBeGreaterThan(0);
        for (const i of s.items) expect(i.id.startsWith(`${s.number}.`)).toBe(true);
      }
    });
  }

  it("section counts match the prototype", () => {
    expect(templateFor("ZIM")?.sections.map((s) => s.items.length)).toEqual([24, 9, 26, 14, 2, 10, 8]);
    expect(templateFor("dBOS")?.sections.map((s) => s.items.length)).toEqual([24, 9, 26, 14, 2, 10]);
    expect(templateFor("Video")?.sections.map((s) => s.items.length)).toEqual([24, 10, 10, 10, 10, 10]);
  });

  it("shares section 1.1 by reference across all four techniques", () => {
    const first = templateFor("ZIM")?.sections[0];
    for (const t of ["Video", "DSA+", "dBOS"] as const) expect(templateFor(t)?.sections[0]).toBe(first);
  });

  it("ELA, WLAN and SAA have no template yet", () => {
    for (const t of ["ELA", "WLAN", "SAA"] as const) expect(templateFor(t)).toBeNull();
    expect(Object.keys(ABNAHME_TEMPLATES).every((k) => (ABNAHME_TECHNIKEN as readonly string[]).includes(k))).toBe(true);
  });
});
