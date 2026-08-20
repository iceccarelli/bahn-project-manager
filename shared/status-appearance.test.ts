import { describe, expect, it } from "vitest";
import { REVIEW_STATUSES } from "./validation";
import {
  STATUS_TONE,
  TONE_APPEARANCE,
  statusBadgeClass,
  statusHex,
} from "./status-appearance";

describe("status appearance", () => {
  it("gives every canonical status a tone — no silent grey fallback", () => {
    for (const status of REVIEW_STATUSES) {
      expect(STATUS_TONE[status], `no tone for "${status}"`).toBeDefined();
    }
    expect(Object.keys(STATUS_TONE)).toHaveLength(REVIEW_STATUSES.length);
  });

  it('colours "Prüfung erfolgt" as a real review, not as neutral', () => {
    // It was missing from Dashboard.tsx's map and fell through to #64748b,
    // rendering a completed review identically to "nicht erforderlich".
    expect(statusHex("Prüfung erfolgt")).not.toBe(statusHex("nicht erforderlich"));
  });

  it('does not collide "gestoppt" with "Nachforderung"', () => {
    // Both were #f97316 on the dashboard while being visibly different in the
    // table — the same data, two answers.
    expect(statusHex("gestoppt")).not.toBe(statusHex("Nachforderung"));
  });

  it("agrees between the badge and the chart for every status", () => {
    for (const status of REVIEW_STATUSES) {
      const tone = STATUS_TONE[status];
      expect(statusBadgeClass(status)).toBe(TONE_APPEARANCE[tone].badge);
      expect(statusHex(status)).toBe(TONE_APPEARANCE[tone].hex);
    }
  });

  it("gives each tone a distinct hex, so a legend is readable", () => {
    const hexes = Object.values(TONE_APPEARANCE).map((a) => a.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it("carries both a light and a dark rule on every badge", () => {
    for (const appearance of Object.values(TONE_APPEARANCE)) {
      expect(appearance.badge).toMatch(/dark:bg-/);
      expect(appearance.badge).toMatch(/dark:text-/);
    }
  });

  it("falls back to neutral rather than throwing on unknown input", () => {
    expect(statusHex(null)).toBe(TONE_APPEARANCE.neutral.hex);
    expect(statusHex("etwas völlig anderes")).toBe(TONE_APPEARANCE.neutral.hex);
    expect(statusBadgeClass(undefined)).toBe(TONE_APPEARANCE.neutral.badge);
  });
});
