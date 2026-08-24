import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  BEDARF,
  bedarfFor,
  bedarfHref,
  countBedarf,
  projectHref,
  projectMatchesBedarf,
  reviewMatchesBedarf,
} from "./handlungsbedarf";
import {
  countTones,
  projectMatchesTone,
  toneFor,
  toneHref,
  toneIsAwaiting,
} from "./handlungsbedarf";
import { normalizeReviewStatus, OPEN_STATUSES, BLOCKING_STATUSES } from "./review-status";
import { STATUS_TONE, TONE_APPEARANCE } from "./status-appearance";

const DATA = JSON.parse(fs.readFileSync("client/public/data.json", "utf8"));
/*
 * Pinned, because three of the four buckets move with the calendar. This is the
 * day the Dashboard screenshot was taken that these figures come from.
 */
const TODAY = new Date("2026-08-23T00:00:00").getTime();

describe("the four buckets are counted once, here", () => {
  it("reproduces the figures the Dashboard has been showing", () => {
    const counts = Object.fromEntries(countBedarf(DATA.projects, TODAY).map((c) => [c.key, c.rows]));
    expect(counts).toEqual({ overdue: 558, blocked: 132, nachforderung: 97, unassigned: 111 });
  });

  it("counts fewer projects than rows, because rows share projects", () => {
    for (const c of countBedarf(DATA.projects, TODAY)) {
      expect(c.projects, c.key).toBeGreaterThan(0);
      expect(c.projects, c.key).toBeLessThanOrEqual(c.rows);
    }
  });

  it("agrees with itself: the project count is the set the filter returns", () => {
    // The number on the chip and the number of cards on the page are the same
    // computation, not two that happen to look alike.
    for (const c of countBedarf(DATA.projects, TODAY)) {
      const filtered = DATA.projects.filter((p: never) =>
        projectMatchesBedarf(p, c.key, TODAY),
      ).length;
      expect(filtered, c.key).toBe(c.projects);
    }
  });

  it("never counts a row in a bucket its status cannot belong to", () => {
    for (const status of BLOCKING_STATUSES) {
      const row = { department: "EEA", status, prueferName: "", pruefDatum: "2020-01-01" };
      expect(reviewMatchesBedarf(row, "blocked", TODAY)).toBe(true);
      // Blocked is not open: a rejected review has had its decision, so it is
      // neither overdue nor unassigned however old and however empty.
      expect(reviewMatchesBedarf(row, "overdue", TODAY)).toBe(false);
      expect(reviewMatchesBedarf(row, "unassigned", TODAY)).toBe(false);
    }
  });

  it("treats a missing or unreadable Prüfdatum as not overdue, never as overdue", () => {
    for (const pruefDatum of [null, "", "  ", "offen", "?", "kein Datum"]) {
      const row = { department: "EEA", status: "offen", prueferName: "X", pruefDatum };
      expect(reviewMatchesBedarf(row, "overdue", TODAY), String(pruefDatum)).toBe(false);
    }
  });

  it("counts every open status as unassignable, not just „offen“", () => {
    for (const status of OPEN_STATUSES) {
      const row = { department: "EEA", status, prueferName: "  ", pruefDatum: null };
      expect(reviewMatchesBedarf(row, "unassigned", TODAY), status).toBe(true);
    }
  });

  it("ignores a bucket key that did not come from us", () => {
    expect(bedarfFor("überfällig")).toBeNull();
    expect(bedarfFor(null)).toBeNull();
    expect(bedarfFor("")).toBeNull();
    expect(bedarfFor("overdue")?.label).toBe("Prüftermin überschritten");
  });

  it("marks as awaiting exactly the buckets that are still open", () => {
    const awaiting = BEDARF.filter((b) => b.awaiting).map((b) => b.key);
    // `blocked` is urgent and settled at the same time — it does not pulse.
    expect(awaiting).toEqual(["overdue", "nachforderung", "unassigned"]);
  });

  it("states a basis for every bucket", () => {
    for (const b of BEDARF) expect(b.basis.length, b.key).toBeGreaterThan(20);
  });

  it("builds links the Projekte page can actually read", () => {
    expect(bedarfHref("overdue")).toBe("/projects?bedarf=overdue&view=cards");
    expect(projectHref(42)).toBe("/projects?projekt=42&view=cards");
  });
});

describe("a slice of the status donut lands on what it counted", () => {
  it("counts every row that carries a recognised status, and no others", () => {
    const slices = countTones(DATA.projects);
    const total = slices.reduce((a, s) => a + s.rows, 0);
    /*
     * Normalised, not raw. 80 rows read "Niederschrift erstellt
     * (LP05-05-01-F31)" — a canonical status with an annotation — and
     * comparing against the raw string counts them as unrecognised while the
     * chart correctly plots them. The comparison has to speak the same
     * language the chart does or it is testing the wrong thing.
     */
    let recognised = 0;
    for (const p of DATA.projects) {
      for (const r of p.reviews ?? []) {
        if (!r.status) continue;
        if (normalizeReviewStatus(r.status) !== null) recognised++;
      }
    }
    // Equal, not approximately: the donut's slices are the whole of what it
    // claims to plot, and a row that falls out of it silently is the defect
    // this whole file exists to prevent.
    expect(total).toBe(recognised);
    expect(total).toBeGreaterThan(15_000);
    expect(total).toBeLessThanOrEqual(18_172);
  });

  it("agrees with itself: the project figure is the set the filter returns", () => {
    for (const slice of countTones(DATA.projects)) {
      const filtered = DATA.projects.filter((p: never) =>
        projectMatchesTone(p, slice.tone),
      ).length;
      expect(filtered, slice.tone).toBe(slice.projects);
    }
  });

  it("gives every slice a label and a colour from the one appearance table", () => {
    for (const slice of countTones(DATA.projects)) {
      expect(slice.label, slice.tone).toBe(TONE_APPEARANCE[slice.tone].label);
      expect(slice.hex, slice.tone).toBe(TONE_APPEARANCE[slice.tone].hex);
    }
  });

  it("marks a band as awaiting exactly when an open status maps into it", () => {
    const fromStatuses = new Set(OPEN_STATUSES.map((s) => STATUS_TONE[s]));
    for (const slice of countTones(DATA.projects)) {
      expect(toneIsAwaiting(slice.tone), slice.tone).toBe(fromStatuses.has(slice.tone));
    }
    // Derived, never hand-listed: adding a status to OPEN_STATUSES has to light
    // up its band without anybody editing a second list.
    expect(toneIsAwaiting("done")).toBe(false);
    expect(toneIsAwaiting("blocked")).toBe(false);
    expect(toneIsAwaiting("pending")).toBe(true);
  });

  it("ignores a tone that did not come from us", () => {
    expect(toneFor("offen")).toBeNull();
    expect(toneFor("")).toBeNull();
    expect(toneFor(null)).toBeNull();
    expect(toneFor("pending")).toBe("pending");
  });

  it("builds a link the Projekte page can read", () => {
    expect(toneHref("pending")).toBe("/projects?tone=pending&view=cards");
  });
});
