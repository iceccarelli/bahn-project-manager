import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { dayFromCell, foldHeader, importWorkbookSheets, serialToIso } from "./pruefbericht-import";
import { sheetsFromWorkbook } from "./workbook";

const H2020 = ["Laufende Nummer", "Datum", "Tätigkeitsbereich", "Art der Baumaßnahme", "EBA-Aktenzeichen", "Bf / Streckenbezeichnung", "Zuständige EBA Außenstelle", "Art der Technik", "Bauform/Bezeichnung", "Technik", "abgeschlossen", "Projektnummer", "zuständiger PL", "zuständiger FS", "Termin", "Beschriftung / PDF Code", "Link"];

describe("helpers", () => {
  it("folds headers: umlauts, ß, case, punctuation", () => {
    expect(foldHeader("Bf / Streckenbezeichnung")).toBe("bfstreckenbezeichnung");
    expect(foldHeader("Art der Baumaßnahme")).toBe("artderbaumassnahme");
    expect(foldHeader(" zuständiger  PL ")).toBe("zustaendigerpl");
    expect(foldHeader("Abgabedat. (yyyymmdd)")).toBe("abgabedatyyyymmdd");
  });

  it("converts dates without a time zone: serial, yyyymmdd, German text", () => {
    expect(serialToIso(45_000)).toBe("2023-03-15");
    expect(dayFromCell(45_000)).toBe("2023-03-15");
    expect(dayFromCell(20_190_731)).toBe("2019-07-31");
    expect(dayFromCell(20_191_341)).toBeNull(); // not a date
    expect(dayFromCell("22.03.2025")).toBe("2025-03-22");
    expect(dayFromCell("")).toBeNull();
    expect(dayFromCell("irgendwann")).toBeNull();
  });
});

describe("importWorkbookSheets — 2020+ layout", () => {
  const rows = [
    ["Projektübersicht ITK 2025"],
    [],
    // a leading empty column, as in the real sheets (data starts in column B)
    [null, ...H2020],
    [null, "25.001", 45_000, "Planprüfung", "Neubau", "EBA-1", "Frankfurt Hbf", "AS Mitte", "Video", "Kamera", "Video", "Ja", "G.1", "Uwe Kessmann", "Ravdorf", 45_100, "P25.001 - Frankfurt Hbf", "https://x"],
    [null, "25.002", "22.03.25", "Gutachten", null, null, "Kassel", null, null, null, "WLAN", "in Bearbeitung", "G.2", "Vera Velstedt", null, null, "G25.002 - Kassel", null],
    [null, "25.003", null, "Abnahmeprüfung", null, null, "Köln", null, null, null, "Laser", "vielleicht", "G.3", null, null, null, "A25.003 - Koeln", null],
    [],
    [null, "Summe", 3],
    [null, "25.001", null, "Planprüfung", null, null, "Doppelt", null, null, null, "ELA", "Nein"],
  ];
  const res = importWorkbookSheets([{ name: "2025", rows }, { name: "Tabelle2", rows: [["x"]] }]);
  const sheet = res.report.sheets[0]!;

  it("finds the header by its text, wherever the columns are", () => {
    expect(sheet.layout).toBe("2020+");
    expect(sheet.headerRow).toBe(3);
    expect(sheet.mapped.laufendeNummer).toBe("Laufende Nummer");
    expect(sheet.mapped.zustaendigerFs).toBe("zuständiger FS");
    expect(sheet.unmappedHeaders).toEqual([]);
  });

  it("imports every field of a row as found", () => {
    expect(res.records[0]).toMatchObject({
      year: 2025, laufendeNummer: "25.001", datum: "2023-03-15", taetigkeitsbereich: "Planprüfung", bahnhofStrecke: "Frankfurt Hbf",
      technik: "Video", abgeschlossen: "Ja", projektnummer: "G.1", zustaendigerPl: "Uwe Kessmann", zustaendigerFs: "Ravdorf",
      termin: "2023-06-23", beschriftung: "P25.001 - Frankfurt Hbf", link: "https://x",
    });
    expect(res.records[1]!.datum).toBe("2025-03-22");
    expect(res.records[1]!.zustaendigerFs).toBeNull();
  });

  it("skips with a reason, counts blanks, and keeps the first of a duplicate", () => {
    expect(res.records.map((r) => r.laufendeNummer)).toEqual(["25.001", "25.002", "25.003"]);
    expect(sheet.blank).toBe(1);
    expect(sheet.skipped).toEqual([
      { row: 8, reason: "laufende Nummer ohne Punkt (erwartet z. B. 25.001)", value: "Summe" },
      { row: 9, reason: "Duplikat von Zeile 4 (erste Zeile bleibt, diese wird nicht übernommen)", value: "25.001" },
    ]);
    expect(res.report.duplicates).toEqual([{ year: 2025, laufendeNummer: "25.001", rows: [4, 9] }]);
    expect(res.report.totals).toEqual({ imported: 3, skipped: 2, blank: 1, duplicates: 1 });
  });

  it("reports vocabulary it does not know without changing it", () => {
    expect(res.report.vocabulary.technikUnknown).toEqual({ Laser: 1 });
    expect(res.report.vocabulary.abgeschlossenUnknown).toEqual({ vielleicht: 1 });
    expect(res.records[2]!.technik).toBe("Laser");
  });

  it("measures the PDF-Code formula against the stored codes", () => {
    // 25.001 and 25.002 match; 25.003 stored "Koeln" but the Bahnhof cell says "Köln"
    expect(res.report.pdfCode).toMatchObject({ checked: 3, match: 2, mismatch: 1, noStoredCode: 0 });
    expect(res.report.pdfCode.samples[0]).toEqual({ year: 2025, laufendeNummer: "25.003", stored: "A25.003 - Koeln", generated: "A25.003 - Köln" });
  });

  it("lists sheets that are not year sheets", () => {
    expect(res.report.ignoredSheets).toEqual(["Tabelle2"]);
  });
});

describe("importWorkbookSheets — legacy layouts and failure modes", () => {
  it("2018–2019: Prüfnr numeric, Abgabedatum yyyymmdd, AG PL becomes the unified PL", () => {
    const rows = [
      ["Prüfstelle"], [], [], [], [], [], [], [], [],
      ["Prüfnr.", "Bahnhofsname", "Projektname", "Technik", "Fabrikat", "FAA", "VEP/EP/AP/Fertigstellung", "Abgabedat. (yyyymmdd)", "PB vorhanden", "erneute Prüfung erforderlich", "abgeschlossen", "AG PL", "AN PL", "PDF Code"],
      [901, "Frankfurt Niederrad", "Umbau", "Video", "Bosch", "FAA1", "Fertigstellung", 20_190_731, "ja", "nein", "Ja", "Thorsten Schrader", "Fa. X", "901 - Frankfurt Niederrad - Video - Fertigstellung"],
      ["Bemerkung", null],
    ];
    const r = importWorkbookSheets([{ name: "2019", rows }]);
    expect(r.report.sheets[0]!.layout).toBe("2018-2019");
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ year: 2019, laufendeNummer: "901", datum: "2019-07-31", technik: "Video", agPl: "Thorsten Schrader", zustaendigerPl: "Thorsten Schrader", anPl: "Fa. X" });
    expect(r.report.pdfCode).toMatchObject({ checked: 1, match: 1 });
    expect(r.report.sheets[0]!.skipped).toEqual([{ row: 12, reason: "Prüfnr. ist keine Zahl", value: "Bemerkung" }]);
  });

  it("2017", () => {
    const rows = [["Projektnr", "Projektname", "Bahnhofname", "FAA", "VEP/EP/AP/Abnahme", "PB vorhanden", "Abgabe", "Prüfung erforderlich", "Erledigt", "AG PL"], ["17-01", "Neubau", "Fulda", "F", "EP", "ja", null, "nein", "ja", "A. B."]];
    const r = importWorkbookSheets([{ name: "2017", rows }]);
    expect(r.records[0]).toMatchObject({ year: 2017, laufendeNummer: "17-01", bahnhofStrecke: "Fulda", abgeschlossen: "ja", zustaendigerPl: "A. B." });
  });

  it("a year sheet whose header cannot be recognised is reported, not guessed", () => {
    const r = importWorkbookSheets([{ name: "2024", rows: [["a", "b"], [1, 2]] }]);
    expect(r.records).toEqual([]);
    expect(r.report.sheets[0]!.layout).toBeNull();
    expect(r.report.sheets[0]!.warnings[0]).toContain("Kopfzeile nicht erkannt");
  });

  it("warns about laufende Nummern stored as numbers (a trailing zero is already lost)", () => {
    const rows = [H2020, [25.01, null, "Planprüfung", null, null, "X"]];
    const r = importWorkbookSheets([{ name: "2025", rows }]);
    expect(r.records[0]!.laufendeNummer).toBe("25.01");
    expect(r.report.sheets[0]!.warnings.join(" ")).toContain("als Zahl gespeichert");
  });
});

describe("a real .xlsx file round trip", () => {
  it("reads dates as serials and text as text, through the library", () => {
    const wb = XLSX.utils.book_new();
    const aoa: unknown[][] = [H2020, ["25.001", new Date(Date.UTC(2025, 2, 22)), "Planprüfung", null, null, "Frankfurt Hbf", null, null, null, "Video", "Ja"]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), "2025");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const read = XLSX.read(buf, { type: "buffer" });
    const r = importWorkbookSheets(sheetsFromWorkbook(XLSX, read));
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ laufendeNummer: "25.001", datum: "2025-03-22", technik: "Video", abgeschlossen: "Ja" });
  });
});
