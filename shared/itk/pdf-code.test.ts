import { describe, expect, it } from "vitest";
import { generateLegacyPdfCode, generatePdfCode, pdfPrefix, samePdfCode } from "./pdf-code";

describe("generatePdfCode (the workbook formula)", () => {
  it("prefixes by Tätigkeitsbereich: G, S, A, otherwise P", () => {
    expect(pdfPrefix("Gutachten")).toBe("G");
    expect(pdfPrefix("Stellungnahme")).toBe("S");
    expect(pdfPrefix("Abnahmeprüfung")).toBe("A");
    expect(pdfPrefix("fachtechnische Prüfung vor Ibn")).toBe("A");
    expect(pdfPrefix("fachtechnische Prüfung EP")).toBe("P");
    expect(pdfPrefix("Planprüfung")).toBe("P");
  });

  it("builds PREFIX + laufende Nummer + ' - ' + Bahnhof/Strecke", () => {
    expect(generatePdfCode("Planprüfung", "25.001", "Frankfurt Hbf")).toBe("P25.001 - Frankfurt Hbf");
    expect(generatePdfCode("Abnahmeprüfung", "24.117", "Kassel-Wilhelmshöhe")).toBe("A24.117 - Kassel-Wilhelmshöhe");
  });

  it("is blank exactly where the formula's ISBLANK branch is", () => {
    expect(generatePdfCode(null, "25.001", "X")).toBeNull();
    expect(generatePdfCode("", "25.001", "X")).toBeNull();
    expect(generatePdfCode("Gutachten", null, null)).toBe("G - ");
  });

  it("legacy 2018–2019: Prüfnr - Bahnhof - Technik - Phase, skipping empty parts", () => {
    expect(generateLegacyPdfCode(901, "Frankfurt Niederrad", "Video", "Fertigstellung")).toBe("901 - Frankfurt Niederrad - Video - Fertigstellung");
    expect(generateLegacyPdfCode(902, "Köln", null, "EP")).toBe("902 - Köln - EP");
    expect(generateLegacyPdfCode(null, "Köln", "Video", "EP")).toBeNull();
  });

  it("compares ignoring the workbook's stray whitespace", () => {
    expect(samePdfCode("P25.001 -  Frankfurt Hbf ", "P25.001 - Frankfurt Hbf")).toBe(true);
    expect(samePdfCode("P25.001 - Frankfurt", "P25.002 - Frankfurt")).toBe(false);
  });
});

describe("derivePdfCode chooses the formula by layout", () => {
  const base = { laufendeNummer: "25.001", taetigkeitsbereich: "Gutachten", bahnhofStrecke: "Kassel", technik: "Video", phase: "EP" } as const;
  it("2020+, 2018–2019 and 2017", async () => {
    const { derivePdfCode } = await import("./pdf-code");
    expect(derivePdfCode({ ...base, layout: "2020+" })).toBe("G25.001 - Kassel");
    expect(derivePdfCode({ ...base, layout: "2018-2019", laufendeNummer: "901" })).toBe("901 - Kassel - Video - EP");
    expect(derivePdfCode({ ...base, layout: "2017" })).toBeNull();
  });
});
