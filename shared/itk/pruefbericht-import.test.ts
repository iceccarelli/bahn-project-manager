import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { dayFromCell, foldHeader, importWorkbookSheets, serialToIso } from "./pruefbericht-import";
import { C, H2017, H2018, H2019, H2020, row2020 } from "./testing";
import { sheetsFromWorkbook } from "./workbook";

describe("helpers", () => {
  it("folds headers: umlauts, ß, case, line breaks, punctuation", () => {
    expect(foldHeader("Bf /\r\nStreckenbezeichnung / Nr. /\r\nProjektbezeichnung mit Ort [Ril100]")).toBe("bfstreckenbezeichnungnrprojektbezeichnungmitortril100");
    expect(foldHeader("Art der Baumaßnahme")).toBe("artderbaumassnahme");
    expect(foldHeader("abge schlossen")).toBe("abgeschlossen");
    expect(foldHeader("Gesamt-bewertung")).toBe("gesamtbewertung");
  });

  it("converts dates without a time zone: serial, yyyymmdd, German text", () => {
    expect(serialToIso(45_000)).toBe("2023-03-15");
    expect(dayFromCell(43_846)).toBe("2020-01-16");
    expect(dayFromCell(20_190_731)).toBe("2019-07-31");
    expect(dayFromCell(20_191_341)).toBeNull();
    expect(dayFromCell("22.03.2025")).toBe("2025-03-22");
    expect(dayFromCell("17.01.25")).toBe("2025-01-17");
    expect(dayFromCell("")).toBeNull();
    expect(dayFromCell("irgendwann")).toBeNull();
  });
});

describe("importWorkbookSheets — 2020+ layout (the real headers)", () => {
  const rows = [
    [null, null, null, null, null, null, null, null, null, null, null, null, null, "Zwischenablage Beschriftung:"],
    [],
    // the 2025/2026 sheets start in column B: a leading empty column
    [null, ...H2020],
    [null, ...row2020("25.001", { bauform: "Video", technik: "Axis", datum: 45_000 })],
    [null, ...row2020("25.002", { taetigkeit: "Gutachten", bauform: "ELA AN1", technik: null, ab: "Nein", fs: null })],
    [null, ...row2020("25.003", { taetigkeit: "Abnahmeprüfung", bauform: "Laser", technik: "Nicht Prüfen!", ab: "vielleicht", beschriftung: "A25.003 - Koeln" })],
    [],
    [null, "Summe", 3],
    [null, ...row2020("25.001", { bauform: "ZIM", ab: "-" })],
  ];
  const res = importWorkbookSheets([{ name: "2025", rows }, { name: "Tabelle2", rows: [["x"]] }, { name: "Master", rows: [] }]);
  const sheet = res.report.sheets[0]!;

  it("recognises long multi-line headers wherever the columns are, and names every field it mapped", () => {
    expect(sheet.layout).toBe("2020+");
    expect(sheet.headerRow).toBe(3);
    expect(sheet.mapped.taetigkeitsbereich).toContain("Tätigkeitsbereich");
    expect(sheet.mapped.bauformBezeichnung).toContain("Bauform");
    expect(sheet.mapped.beschriftung).toBe("Beschriftung");
    expect(sheet.unmappedHeaders).toEqual([]);
  });

  it("keeps the Technik column (product) and the Bauform column (Technik of the installation) apart", () => {
    expect(res.records[0]).toMatchObject({ year: 2025, laufendeNummer: "25.001", bauformBezeichnung: "Video", technik: "Axis", abgeschlossen: "Ja", zustaendigerPl: "Uwe Kessmann", zustaendigerFs: "Ravdorf", datum: "2023-03-15", termin: "2023-06-23" });
    expect(res.records[1]).toMatchObject({ bauformBezeichnung: "ELA AN1", technik: null, zustaendigerFs: null });
  });

  it("skips a non-report row with a reason, counts blanks, and keeps a repeated number under a suffix", () => {
    expect(res.records.map((r) => r.laufendeNummer)).toEqual(["25.001", "25.002", "25.003", "25.001/2"]);
    expect(sheet.blank).toBe(1);
    expect(sheet.skipped).toEqual([{ row: 8, reason: "laufende Nummer ohne Punkt (erwartet z. B. 25.001)", value: "Summe" }]);
    expect(res.report.duplicates).toEqual([{ year: 2025, laufendeNummer: "25.001", rows: [4, 9], keptAs: ["25.001/2"] }]);
    expect(sheet.warnings.join(" ")).toContain("als 25.001/2 übernommen");
    expect(res.report.totals).toMatchObject({ imported: 4, skipped: 1, blank: 1, duplicates: 1 });
  });

  it("reports vocabulary it does not know (Technik of the installation, abgeschlossen) without changing it", () => {
    expect(res.report.vocabulary.technikUnknown).toEqual({ Laser: 1 });
    expect(res.report.vocabulary.abgeschlossenUnknown).toEqual({ vielleicht: 1 });
    expect(res.records[2]!.bauformBezeichnung).toBe("Laser");
    // "-" is the dropdown's "no value", not an unknown value
    expect(res.report.vocabulary.abgeschlossenEmpty).toBe(1);
  });

  it("measures the PDF-Code formula against the stored codes (a duplicate is compared under its own number)", () => {
    // 25.001 ×2 and 25.002 match; 25.003 stored "Koeln" but the Bahnhof cell says "Bahnhof 25.003"
    expect(res.report.pdfCode).toMatchObject({ checked: 4, match: 3, mismatch: 1, noStoredCode: 0 });
    expect(res.report.pdfCode.samples[0]).toMatchObject({ laufendeNummer: "25.003", stored: "A25.003 - Koeln", generated: "A25.003 - Bahnhof 25.003" });
  });

  it("lists the sheets that are not year sheets", () => {
    expect(res.report.ignoredSheets).toEqual(["Tabelle2", "Master"]);
  });
});

describe("importWorkbookSheets — legacy layouts and failure modes", () => {
  const legacy = (nr: number | string | null, over: Record<number, unknown> = {}) => {
    const r: unknown[] = [nr, "Frankfurt Niederrad", "Videoprojekt", "Video", null, "G.011500072", "Fertigstellung", 20_190_109, "Ja", "Ja", "Ja", "Rafik Aananouch", null, null, 1, null, null, "3-"];
    for (const [i, v] of Object.entries(over)) r[Number(i)] = v;
    return r;
  };

  it("2019: annotated Bahnhof header, yyyymmdd date, AG PL becomes the unified PL, the 2019 PDF-Code formula", () => {
    const rows = [["PB", "Prüfbericht"], [], [], [], [], [], [], [], [], [...H2019], legacy(901, { 13: "901 - Frankfurt Niederrad - Video - Fertigstellung" })];
    const r = importWorkbookSheets([{ name: "2019", rows }]);
    expect(r.report.sheets[0]!.layout).toBe("2018-2019");
    expect(r.records[0]).toMatchObject({ year: 2019, laufendeNummer: "901", datum: "2019-01-09", technik: "Video", agPl: "Rafik Aananouch", zustaendigerPl: "Rafik Aananouch", abschlusstermin: "1", gesamtbewertung: "3-" });
    expect(r.report.pdfCode).toMatchObject({ checked: 1, match: 1 });
    expect(r.report.sheets[0]!.unmappedHeaders).toEqual([]);
  });

  it("2018: its own PDF-Code formula (date-number Bahnhof Technik Phase), and rows that only carry the pre-filled flag are blank, not skipped", () => {
    const flagOnly = new Array(18).fill(null) as unknown[];
    flagOnly[14] = 1;
    const rows = [...Array(9).fill([]), [...H2018], legacy(801, { 1: "Fulda", 3: "ELA", 6: "EP", 7: 20_180_115, 13: "20180115-801 Fulda ELA EP" }), flagOnly, flagOnly];
    const r = importWorkbookSheets([{ name: "2018", rows }]);
    expect(r.records).toHaveLength(1);
    expect(r.report.sheets[0]).toMatchObject({ blank: 2, skipped: [] });
    expect(r.report.pdfCode).toMatchObject({ checked: 1, match: 1 });
  });

  it("2017: a number used twice is two reports, kept as 770 and 770/2", () => {
    const rows = [[...H2017], [770, "Erneuerung FIA", "Bad Nauheim", null, "Abnahme", null, 43_058, null, null, "Karoline Faber"], [770, "Erweiterung FIA", "Bad Nauheim", null, "AP", "x", 43_082, null, "x", "Karoline Faber"]];
    const r = importWorkbookSheets([{ name: "2017", rows }]);
    expect(r.records.map((x) => [x.laufendeNummer, x.projektname])).toEqual([["770", "Erneuerung FIA"], ["770/2", "Erweiterung FIA"]]);
    expect(r.records[0]).toMatchObject({ layout: "2017", bahnhofStrecke: "Bad Nauheim", zustaendigerPl: "Karoline Faber", datum: "2017-11-19" });
    expect(r.report.pdfCode.checked).toBe(0);
  });

  it("a year sheet whose header cannot be recognised is reported, not guessed", () => {
    const r = importWorkbookSheets([{ name: "2024", rows: [["a", "b"], [1, 2]] }]);
    expect(r.records).toEqual([]);
    expect(r.report.sheets[0]!.layout).toBeNull();
    expect(r.report.sheets[0]!.warnings[0]).toContain("Kopfzeile nicht erkannt");
  });

  it("warns about laufende Nummern stored as numbers (a trailing zero is already lost)", () => {
    const rows = [[...H2020], row2020("25.01", { nr: 25.01 })];
    const r = importWorkbookSheets([{ name: "2025", rows }]);
    expect(r.records[0]!.laufendeNummer).toBe("25.01");
    expect(r.report.sheets[0]!.warnings.join(" ")).toContain("als Zahl gespeichert");
  });
});

describe("a real .xlsx file round trip", () => {
  it("reads dates as serials and text as text, through the library", () => {
    const wb = XLSX.utils.book_new();
    const aoa: unknown[][] = [[...H2020], row2020("25.001", { datum: new Date(Date.UTC(2025, 2, 22)), bauform: "Video" })];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), "2025");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const r = importWorkbookSheets(sheetsFromWorkbook(XLSX, XLSX.read(buf, { type: "buffer" })));
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ laufendeNummer: "25.001", datum: "2025-03-22", bauformBezeichnung: "Video", abgeschlossen: "Ja" });
  });
});

void C;
