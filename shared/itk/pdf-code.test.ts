import { describe, expect, it } from "vitest";
import { derivePdfCode, generatePdfCode, generatePdfCode2018, generatePdfCode2019, pdfPrefix, samePdfCode } from "./pdf-code";

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

  it("2019: Prüfnr - Bahnhof - Technik - Phase, plain concatenation, separators stay", () => {
    expect(generatePdfCode2019(901, "Frankfurt Niederrad", "Video", "Fertigstellung")).toBe("901 - Frankfurt Niederrad - Video - Fertigstellung");
    expect(generatePdfCode2019(902, "Köln", null, "EP")).toBe("902 - Köln - - EP");
    expect(generatePdfCode2019(null, "Köln", "Video", "EP")).toBeNull();
  });

  it("2018: Abgabedatum-Prüfnr Bahnhof Technik Phase — the formula the platform documents and then does not implement", () => {
    expect(generatePdfCode2018("2018-01-15", 801, "Fulda", "ELA", "EP")).toBe("20180115-801 Fulda ELA EP");
    expect(generatePdfCode2018("2018-10-04", 805, "Mainz Röm. Theater", "ELA", "EP")).toBe("20181004-805 Mainz Röm. Theater ELA EP");
    expect(generatePdfCode2018(null, 864, "Alzey", "ZIM", null)).toBe("-864 Alzey ZIM"); // an empty date cell concatenates to nothing
  });

  it("compares ignoring the workbook's stray whitespace", () => {
    expect(samePdfCode("P25.001 -  Frankfurt Hbf ", "P25.001 - Frankfurt Hbf")).toBe(true);
    expect(samePdfCode("P25.001 - Frankfurt", "P25.002 - Frankfurt")).toBe(false);
  });
});

describe("derivePdfCode chooses the formula by layout and year", () => {
  const base = { laufendeNummer: "25.001", datum: "2018-01-15", taetigkeitsbereich: "Gutachten", bahnhofStrecke: "Kassel", technik: "Video", phase: "EP" } as const;
  it("2020+, 2019, 2018 and 2017", () => {
    expect(derivePdfCode({ ...base, year: 2025, layout: "2020+" })).toBe("G25.001 - Kassel");
    expect(derivePdfCode({ ...base, year: 2019, layout: "2018-2019", laufendeNummer: "901" })).toBe("901 - Kassel - Video - EP");
    expect(derivePdfCode({ ...base, year: 2018, layout: "2018-2019", laufendeNummer: "801" })).toBe("20180115-801 Kassel Video EP");
    expect(derivePdfCode({ ...base, year: 2017, layout: "2017" })).toBeNull();
  });
});
