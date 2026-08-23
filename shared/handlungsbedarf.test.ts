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
import { OPEN_STATUSES, BLOCKING_STATUSES } from "./review-status";

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
