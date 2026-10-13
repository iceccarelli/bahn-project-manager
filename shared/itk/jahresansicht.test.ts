import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveProjectMetrics } from "../project-metrics";
import { normalizeReviewStatus } from "../review-status";
import type { PortfolioProject } from "../portfolio-metrics";
import { buildItkYears, RANK_LIMIT } from "./jahresansicht";

const p = (id: number, pl: string | null, status: string | null, datum: string | null, pruefer: string | null = null, dept = "ITK"): PortfolioProject => ({
  id,
  projektleiter: pl,
  reviews: [{ department: dept, status, prueferName: pruefer, pruefDatum: datum }],
});

describe("buildItkYears", () => {
  const rows = [
    p(1, "Gero Dornhaus", "Zustimmung erteilt", "2023-05-02", "A. Prüfer"),
    p(2, "Gero Dornhaus", "offen", "2023-06-01", "A. Prüfer"),
    p(3, "Eva Beck", "abgelehnt", "2024-01-15", "B. Prüfer"),
    p(4, "Eva Beck", "Zustimmung erteilt", null, null),
    p(5, "Eva Beck", "nicht erforderlich", "2023-01-01"), // out of scope, like the Übersicht
    p(6, "Eva Beck", "offen", "2023-01-01", null, "EEA"), // other Gewerk
  ];
  const v = buildItkYears(rows, 0);

  it("buckets by year of the Prüfdatum, ascending, undated last", () => {
    expect(v.years.map((y) => y.year)).toEqual([2023, 2024, null]);
    expect(v.years.map((y) => y.metrics.total)).toEqual([2, 1, 1]);
  });

  it("scopes exactly like the Übersicht: ITK rows that are not 'nicht erforderlich'", () => {
    expect(v.all.metrics.total).toBe(4);
  });

  it("counts status with the Übersicht's own deriveProjectMetrics", () => {
    const y2023 = v.years[0]!;
    expect(y2023.metrics).toEqual(deriveProjectMetrics([{ reviews: [{ status: "Zustimmung erteilt" }] }, { reviews: [{ status: "offen" }] }]));
    expect(y2023.metrics.completed).toBe(1);
    expect(v.years[1]!.metrics.blocked).toBe(1);
  });

  it("tone counts add up to the bucket total", () => {
    for (const b of [...v.years, v.all]) {
      expect(Object.values(b.tones).reduce((a, n) => a + (n ?? 0), 0)).toBe(b.metrics.total);
    }
    expect(v.all.tones).toMatchObject({ done: 2, pending: 1, blocked: 1 });
  });

  it("ranks Projektleitung and Prüfer, ignoring blanks, with approved counts", () => {
    expect(v.all.projektleitung).toEqual([
      { name: "Eva Beck", count: 2, approved: 1 },
      { name: "Gero Dornhaus", count: 2, approved: 1 },
    ]);
    expect(v.all.pruefer.map((r) => r.name)).toEqual(["A. Prüfer", "B. Prüfer"]);
    expect(v.all.pruefer[0]).toEqual({ name: "A. Prüfer", count: 2, approved: 1 });
  });

  it("does not rank the 'Zuordnung erforderlich' placeholder as a person", () => {
    const v2 = buildItkYears([p(1, "Eva Beck", "offen", "2023-01-01", "Zuordnung erforderlich"), p(2, "Eva Beck", "offen", "2023-01-01", "A. Prüfer")]);
    expect(v2.all.pruefer.map((r) => r.name)).toEqual(["A. Prüfer"]);
    expect(v2.all.metrics.total).toBe(2); // still a Prüfzeile, still counted
  });

  it("bounds the rankings", () => {
    const many = Array.from({ length: 30 }, (_, i) => p(i + 1, `PL ${String(i).padStart(2, "0")}`, "offen", "2023-01-01"));
    expect(buildItkYears(many).all.projektleitung).toHaveLength(RANK_LIMIT);
  });

  it("empty input is an empty view, not an error", () => {
    const e = buildItkYears([]);
    expect(e.years).toEqual([]);
    expect(e.all.metrics.total).toBe(0);
  });
});

describe("on the shipped dataset", () => {
  const data = JSON.parse(readFileSync("client/public/data.json", "utf8")) as { projects: PortfolioProject[] };
  const v = buildItkYears(data.projects, 0);

  it("'alle Jahre' equals the Übersicht KPI derivation over the same rows, to the unit", () => {
    const scoped = data.projects
      .map((pr) => (pr.reviews ?? []).find((r) => r.department === "ITK"))
      .filter((r): r is NonNullable<typeof r> => !!r && normalizeReviewStatus(r.status) !== "nicht erforderlich");
    expect(v.all.metrics).toEqual(deriveProjectMetrics(scoped.map((r) => ({ reviews: [r] }))));
    expect(v.all.metrics.total).toBeGreaterThan(400);
  });

  it("year buckets partition the total", () => {
    expect(v.years.reduce((n, y) => n + y.metrics.total, 0)).toBe(v.all.metrics.total);
  });
});
