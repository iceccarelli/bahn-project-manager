import { describe, expect, it } from "vitest";
import { BAHNHOFSMANAGEMENT, normalizeBahnhofsmanagement } from "./bahnhofsmanagement";
import { PROJEKTSTAENDE, normalizeProjektstand } from "./projektstand";
import { isApproved, isBlocking, isOpen, normalizeReviewStatus } from "./review-status";
import { formatGerman, parseStoredDate, toDate } from "./date";

describe("bahnhofsmanagement", () => {
  it("has the 9 values from Hilfsdatei!N17:N25", () => {
    expect(BAHNHOFSMANAGEMENT).toHaveLength(9);
    expect(BAHNHOFSMANAGEMENT).toContain("Frankfurt");
    // the station master says "Frankfurt a. M."; the form and 331 projects say "Frankfurt"
    expect(BAHNHOFSMANAGEMENT).not.toContain("Frankfurt a. M.");
  });

  it.each([
    ["Frankfurt a. M.", "Frankfurt"],
    ["Frankfurt ", "Frankfurt"],
    ["FFM", "Frankfurt"],
    ["Darmstadt LOS 1", "Darmstadt"],
    ["Koblenz LOS 2", "Koblenz"],
    ["Koblenz LOS 4", "Koblenz"],
    ["koblenz", "Koblenz"],
    ["Saabrücken", "Saarbrücken"],
    ["Giessen", "Gießen"],
    ["RB Mitte", "übergreifend"],
  ])("normalises %j to %j", (input, expected) => {
    expect(normalizeBahnhofsmanagement(input).value).toBe(expected);
  });

  it.each(["???", "Bitte auswählen", "-", "", null, undefined])(
    "treats %j as no answer",
    (input) => {
      const r = normalizeBahnhofsmanagement(input);
      expect(r.value).toBeNull();
      expect(r.unmapped).toBeNull();
    },
  );

  it("never guesses — an unknown region is reported, not assigned", () => {
    const r = normalizeBahnhofsmanagement("Hamburg");
    expect(r.value).toBeNull();
    expect(r.unmapped).toBe("Hamburg");
  });
});

describe("projektstand", () => {
  it("has the 7 values from Hilfsdatei!N3:N12 plus Projektkonfiguration", () => {
    expect(PROJEKTSTAENDE).toHaveLength(8);
    expect(PROJEKTSTAENDE).toContain("Mieterumbau MAG");
    expect(PROJEKTSTAENDE).toContain("Mieterumbau iAG");
    expect(PROJEKTSTAENDE).toContain("Projektkonfiguration");
  });

  it.each([
    ["AP", "AP"],
    [" AP ", "AP"],
    ["Projektkonfig.", "Projektkonfiguration"],
    ["Mieterumbau MAG", "Mieterumbau MAG"],
    ["CSM-RA", "CSM-RA"],
  ])("canonicalises %j to %j", (input, expected) => {
    expect(normalizeProjektstand(input).canonical).toBe(expected);
  });

  it("refuses to guess between Mieterumbau MAG and iAG", () => {
    const r = normalizeProjektstand("Mieterumbau");
    expect(r.canonical).toBeNull();
    expect(r.unmapped).toBe("Mieterumbau");
  });

  it("preserves free-text phases instead of discarding them", () => {
    const r = normalizeProjektstand("Plausibilitätsprüfung gBSK");
    expect(r.canonical).toBeNull();
    expect(r.raw).toBe("Plausibilitätsprüfung gBSK");
  });
});

describe("review status", () => {
  it("collapses the two synonyms found in data.json", () => {
    expect(normalizeReviewStatus("Projektkonfiguration")).toBe("Projektkonfig.");
    expect(normalizeReviewStatus("Niederschrift erstellt (LP05-05-01-F31)")).toBe(
      "Niederschrift erstellt",
    );
  });

  it("classifies the workflow buckets", () => {
    expect(isOpen("offen")).toBe(true);
    expect(isOpen("in Bearbeitung")).toBe(true);
    expect(isApproved("Zustimmung erteilt")).toBe(true);
    expect(isApproved("Niederschrift erstellt (LP05-05-01-F31)")).toBe(true);
    expect(isBlocking("abgelehnt")).toBe(true);
    expect(isOpen("nicht erforderlich")).toBe(false);
  });

  it("returns null for something it does not recognise", () => {
    expect(normalizeReviewStatus("völlig unbekannt")).toBeNull();
  });
});

describe("dates", () => {
  it("reads German dd.mm.yyyy, which is what the workbook produces", () => {
    const r = parseStoredDate("21.03.2023");
    expect(r.iso).toBe("2023-03-21");
    expect(r.reason).toBe("german");
  });

  it("does not mistake dd.mm for mm.dd", () => {
    // 147 stored values have a first component > 12, proving the ordering
    expect(parseStoredDate("30.12.2024").iso).toBe("2024-12-30");
    // and a day-first reading of an ambiguous one must stay day-first
    expect(parseStoredDate("01.02.2023").iso).toBe("2023-02-01");
  });

  it("passes ISO through unchanged", () => {
    expect(parseStoredDate("2026-06-15").iso).toBe("2026-06-15");
    expect(parseStoredDate("2026-06-15T09:00:00Z").iso).toBe("2026-06-15");
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    // new Date("2024-02-31") silently becomes 2 March
    expect(parseStoredDate("31.02.2024").iso).toBeNull();
    expect(parseStoredDate("31.02.2024").reason).toBe("invalid-date");
  });

  it("refuses cells holding more than one date", () => {
    expect(parseStoredDate("01.02.2023/12.9.23").reason).toBe("ambiguous");
    expect(parseStoredDate("08.09.2023 14.03.2024").reason).toBe("ambiguous");
  });

  it("treats the literal dash as no date", () => {
    expect(parseStoredDate("-").iso).toBeNull();
    expect(parseStoredDate("-").reason).toBe("placeholder");
  });

  it("reports a malformed year rather than inventing one", () => {
    expect(parseStoredDate("30.12.20025").iso).toBeNull();
    expect(parseStoredDate("30.12.20025").reason).toBe("unrecognised");
  });

  it("toDate returns null where new Date() would return Invalid Date", () => {
    expect(Number.isNaN(new Date("21.03.2023").getTime())).toBe(true);
    expect(toDate("21.03.2023")?.toISOString()).toBe("2023-03-21T00:00:00.000Z");
    expect(toDate("-")).toBeNull();
  });

  it("formats back to German for display", () => {
    expect(formatGerman("2023-03-21")).toBe("21.03.2023");
    expect(formatGerman(null)).toBe("");
  });
});
