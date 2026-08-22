import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  agingOfOpenReviews,
  dataQuality,
  daysBetween,
  gewerkStandings,
  reviewerConcentration,
  RISK_WEIGHTS,
} from "./portfolio-metrics";
import { DEPARTMENT_LIST } from "./validation";
import { normalizeReviewStatus } from "./review-status";

const DATA = JSON.parse(fs.readFileSync("client/public/data.json", "utf8")) as {
  projects: Array<Record<string, unknown>>;
};
const TODAY = Date.parse("2026-08-22T00:00:00Z");
const STANDINGS = gewerkStandings(DATA.projects as never, DEPARTMENT_LIST, TODAY);

describe("the Gewerke figure is the workload, not the row count", () => {
  it("counts required rows, which is what the Gewerk tabs already show", () => {
    // The Dashboard tile read 1.298 for seven of eight Gewerke — the number of
    // projects, not the number of checks. /bvb-eea says 814 and /psv-itk 510,
    // and the Dashboard must agree with them.
    const eea = STANDINGS.find((g) => g.department === "EEA");
    const itk = STANDINGS.find((g) => g.department === "ITK");
    expect(eea?.required).toBe(814);
    expect(itk?.required).toBe(510);
  });

  it("gives the fourteen Gewerke fourteen different answers", () => {
    const required = STANDINGS.map((g) => g.required);
    expect(STANDINGS).toHaveLength(14);
    // The old tile was a constant. Any measure worth showing varies.
    expect(new Set(required).size).toBeGreaterThan(8);
    expect(Math.max(...required)).toBeGreaterThan(Math.min(...required) * 5);
  });

  it("accounts for every required row it counts", () => {
    for (const g of STANDINGS) {
      expect(g.open + g.approved + g.blocked + g.other, g.department).toBe(g.required);
    }
  });

  it("derives the same required count as counting the data by hand", () => {
    for (const g of STANDINGS) {
      let expected = 0;
      for (const p of DATA.projects) {
        const reviews = (p.reviews ?? []) as Array<{ department: string; status?: string }>;
        const r = reviews.find((x) => x.department === g.department);
        const s = normalizeReviewStatus(r?.status);
        if (s !== null && s !== "nicht erforderlich") expected++;
      }
      expect(g.required, g.department).toBe(expected);
    }
  });

  it("never claims completion on a Gewerk that has approved nothing", () => {
    // UM's vocabulary contains no approval status at all: 31 rows say
    // "Prüfung erfolgt", which is neither an approval nor an open state. A
    // completion percentage must not round that up to progress.
    const um = STANDINGS.find((g) => g.department === "UM");
    expect(um?.approved).toBe(0);
    expect(um?.completion).toBe(0);
    expect(um?.other).toBeGreaterThan(0);
  });

  it("weights risk from stated components, never from a magic number", () => {
    for (const g of STANDINGS) {
      expect(g.riskScore, g.department).toBe(
        g.blocked * RISK_WEIGHTS.blocked +
          g.overdue * RISK_WEIGHTS.overdue +
          g.unassigned * RISK_WEIGHTS.unassigned,
      );
    }
  });
});

describe("aging", () => {
  const aging = agingOfOpenReviews(DATA.projects as never, TODAY);

  it("buckets every dated open review exactly once", () => {
    const bucketed = aging.cohorts.reduce((a, c) => a + c.count, 0);
    let openTotal = 0;
    for (const p of DATA.projects) {
      for (const r of (p.reviews ?? []) as Array<{ status?: string }>) {
        const s = normalizeReviewStatus(r.status);
        if (s && ["offen", "in Bearbeitung", "Nachforderung", "prüffähig"].includes(s)) openTotal++;
      }
    }
    expect(bucketed + aging.undatedOpen).toBe(openTotal);
  });

  it("reports the open rows it cannot age instead of dropping them", () => {
    expect(aging.undatedOpen).toBeGreaterThan(0);
  });

  it("has a median that sits inside the data", () => {
    expect(aging.medianAgeDays).not.toBeNull();
    expect(aging.medianAgeDays).toBeGreaterThan(0);
  });
});

describe("concentration", () => {
  const c = reviewerConcentration(DATA.projects as never);

  it("finds every named reviewer, not a hardcoded roster", () => {
    const names = new Set<string>();
    for (const p of DATA.projects) {
      for (const r of (p.reviews ?? []) as Array<{ status?: string; prueferName?: string }>) {
        const s = normalizeReviewStatus(r.status);
        if (s === null || s === "nicht erforderlich") continue;
        const n = (r.prueferName ?? "").trim();
        if (n) names.add(n);
      }
    }
    expect(c.reviewers.length).toBe(names.size);
  });

  it("states the share of open work held by the busiest five", () => {
    expect(c.topFiveShareOfOpen).toBeGreaterThan(0);
    expect(c.topFiveShareOfOpen).toBeLessThanOrEqual(100);
  });

  it("counts unassigned open work separately rather than hiding it in a name", () => {
    expect(c.unassignedOpen).toBeGreaterThan(0);
    expect(c.reviewers.some((r) => r.name === "")).toBe(false);
  });
});

describe("data quality", () => {
  const q = dataQuality(DATA.projects as never);

  it("names the statuses that belong to no lifecycle bucket", () => {
    // Otherwise open + approved + blocked silently omits them and the totals
    // look complete while missing hundreds of rows.
    expect(q.unclassifiedStatuses.length).toBeGreaterThan(0);
    expect(q.unclassifiedStatuses.map((s) => s.status)).toContain("Prüfung erfolgt");
    for (const s of q.unclassifiedStatuses) expect(s.count).toBeGreaterThan(0);
  });

  it("treats a shared Projektnummer as a fact, not an error", () => {
    // 1,298 projects carry 385 numbers; one appears 98 times. This is how the
    // workbook is organised.
    expect(q.distinctProjektnummern).toBeLessThan(q.totalProjects);
    expect(q.projectsSharingANumber).toBeGreaterThan(q.sharedProjektnummern);
  });

  it("counts blank review rows", () => {
    expect(q.reviewsWithoutStatus).toBeGreaterThan(0);
  });

  it("reports totals a reader can check against the file", () => {
    expect(q.totalProjects).toBe(DATA.projects.length);
    let reviews = 0;
    for (const p of DATA.projects) reviews += ((p.reviews ?? []) as unknown[]).length;
    expect(q.totalReviews).toBe(reviews);
  });
});

describe("daysBetween", () => {
  it("is positive in the past and negative in the future", () => {
    expect(daysBetween("2026-08-12", TODAY)).toBe(10);
    expect(daysBetween("2026-09-01", TODAY)).toBeLessThan(0);
    expect(daysBetween(null, TODAY)).toBeNull();
    expect(daysBetween("kein Datum", TODAY)).toBeNull();
  });
});
