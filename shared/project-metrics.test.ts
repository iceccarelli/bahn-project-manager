import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deriveProjectMetrics, EMPTY_METRICS, percent } from "./project-metrics";

const raw = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../client/public/data.json"), "utf-8"),
);
const projects = Array.isArray(raw) ? raw : raw.projects;

describe("deriveProjectMetrics", () => {
  it("classifies every project into exactly one bucket — no drift", () => {
    const m = deriveProjectMetrics(projects);
    expect(m.total).toBe(1298);
    expect(m.active + m.completed + m.blocked + m.notStarted + m.unclassified).toBe(m.total);
  });

  it("classifies every review row — no drift", () => {
    const m = deriveProjectMetrics(projects);
    expect(m.totalReviews).toBe(18172);
    expect(
      m.openReviews +
        m.approvedReviews +
        m.notRequiredReviews +
        m.blockedReviews +
        m.unresolvedReviews,
    ).toBe(m.totalReviews);
  });

  it("does not reproduce the fabricated multipliers it replaced", () => {
    const m = deriveProjectMetrics(projects);
    // Projects.tsx used Math.round(total * 0.86) for "Termingerecht" and
    // Dashboard.tsx used Math.round(total * 0.68) for "Abgeschlossen".
    // Both described the same thing and neither matched reality.
    expect(m.completed).not.toBe(Math.round(m.total * 0.86)); // was 1116
    expect(m.completed).not.toBe(Math.round(m.total * 0.68)); // was 883
    expect(m.completed).toBe(573);
    expect(m.blocked).toBe(122);
  });

  it("is total on empty / null input rather than throwing", () => {
    expect(deriveProjectMetrics(null)).toEqual(EMPTY_METRICS);
    expect(deriveProjectMetrics([])).toEqual(EMPTY_METRICS);
    expect(deriveProjectMetrics([{ reviews: null }]).total).toBe(1);
  });

  it("percent never divides by zero", () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(573, 1298)).toBe(44);
  });
});
