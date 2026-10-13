import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { DEPARTMENTS } from "../validation";
import { analyzeSource, columnLetter, parseRegisterWorkbook } from "./register-import";
import { REGISTER_HEADER, registerRow, registerSheet } from "./testing";
import { sheetsFromWorkbook } from "../itk/workbook";

describe("columnLetter", () => {
  it("matches Excel", () => {
    expect([0, 25, 26, 51, 52].map(columnLetter)).toEqual(["A", "Z", "AA", "AZ", "BA"]);
  });
});

describe("parseRegisterWorkbook — layout", () => {
  it("finds the header on row 8 and maps every project field and all 14 department groups to the documented columns", () => {
    const reviews = Object.fromEntries(DEPARTMENTS.map((d, i) => [d, [`Status ${d}`.length ? "offen" : null, `Prüfer ${i}`, 45_000 + i]])) as never;
    const { records, report } = parseRegisterWorkbook([registerSheet([registerRow({ projektnummer: "G.1", station: "A", reviews, kommentar: "k", link: "https://example.invalid/p" })])]);
    expect(report.headerRow).toBe(8);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report.columns).toMatchObject({ projektnummer: "A", bahnhofsmanagement: "B", station: "C", bahnhofsnummer: "D", streckennummer: "E", projektbeschreibung: "F", projektstand: "G", projektleiter: "H", terminProjektvorstellung: "I", kommentar: "AZ", projektLink: "BA" });
    // the documented status columns, in order, and every department found
    expect(report.departments.map((d) => [d.department, columnLetter(d.column - 1)])).toEqual([
      ["EEA", "J"], ["ITK", "M"], ["BS", "P"], ["GA", "S"], ["Energie", "V"], ["HFT", "Y"], ["HKLS", "AB"], ["TBQ", "AE"], ["UM", "AH"],
      ["BIM", "AK"], ["LST", "AN"], ["Vermessung", "AQ"], ["Baubetriebstechnologie", "AT"], ["Baubetriebsplanung", "AW"],
    ]);
    expect(report.missingDepartments).toEqual([]);
    expect(report.issues.filter((i) => i.kind === "header-moved")).toEqual([]);
    const r = records[0]!;
    expect(r.fields).toMatchObject({ projektnummer: "G.1", kommentar: "k", projektLink: "https://example.invalid/p", terminProjektvorstellung: "2023-03-15" });
    // each department's own Name and Datum, not its neighbour's
    DEPARTMENTS.forEach((d, i) => expect(r.reviews[d]).toEqual({ status: "offen", prueferName: `Prüfer ${i}`, datum: new Date(Date.UTC(1899, 11, 30) + (45_000 + i) * 86_400_000).toISOString().slice(0, 10) }));
  });

  it("reads the workbook's own spelling of Baubetriebstechnologie", () => {
    expect(REGISTER_HEADER).toContain("Baubetriebstechnnologie");
    const { report } = parseRegisterWorkbook([registerSheet([registerRow({ projektnummer: "G.1" })])]);
    expect(report.departments.find((d) => d.department === "Baubetriebstechnologie")?.header).toBe("Baubetriebstechnnologie");
  });

  it("follows a moved header row and says so", () => {
    const sheet = registerSheet([registerRow({ projektnummer: "G.1" })]);
    sheet.rows = [[], ...sheet.rows];
    const { records, report } = parseRegisterWorkbook([sheet]);
    expect(report.headerRow).toBe(9);
    expect(report.issues.some((i) => i.kind === "header-moved" && /Zeile 9/.test(i.message))).toBe(true);
    expect(records).toHaveLength(1);
  });

  it("follows a column inserted before the groups by name, reporting every moved department", () => {
    const sheet = registerSheet([registerRow({ projektnummer: "G.1", reviews: { ITK: ["Zustimmung erteilt", "Pia", 45_000] } })]);
    sheet.rows = sheet.rows.map((r, i) => (i < 7 ? r : [...r.slice(0, 9), i === 7 ? "Neue Spalte" : "x", ...r.slice(9)]));
    const { records, report } = parseRegisterWorkbook([sheet]);
    expect(records[0]?.reviews.ITK?.status).toBe("Zustimmung erteilt");
    expect(report.issues.filter((i) => i.kind === "header-moved").length).toBe(14);
    expect(report.unmappedHeaders).toEqual(["J: Neue Spalte"]);
  });

  it("does not guess a department whose Name/Datum columns are not where the group says", () => {
    const sheet = registerSheet([registerRow({ projektnummer: "G.1", reviews: { ITK: ["offen", "Pia", 45_000] } })]);
    (sheet.rows[7] as unknown[])[13] = "Bemerkung"; // ITK's "Name2"
    const { records, report } = parseRegisterWorkbook([sheet]);
    expect(report.missingDepartments).toEqual(["ITK"]);
    expect(records[0]?.reviews.ITK).toBeUndefined();
  });

  it("reports a missing sheet and a missing header instead of importing nothing silently", () => {
    expect(parseRegisterWorkbook([{ name: "Tabelle1", rows: [["a"]] }]).report.issues[0]?.kind).toBe("sheet-missing");
    expect(parseRegisterWorkbook([{ name: "Übersicht", rows: [["a"], ["b"]] }]).report.issues[0]?.kind).toBe("header-missing");
  });

  it("ignores every other sheet (extracts, pivots, helper tables)", () => {
    const { report, records } = parseRegisterWorkbook([registerSheet([registerRow({ projektnummer: "G.1" })]), { name: "BVB-EEA", rows: [REGISTER_HEADER, registerRow({ projektnummer: "G.9" })] }, { name: "Pivot-Tabellen", rows: [["x"]] }]);
    expect(report.ignoredSheets).toEqual(["BVB-EEA", "Pivot-Tabellen"]);
    expect(records.map((r) => r.fields.projektnummer)).toEqual(["G.1"]);
  });
});

describe("parseRegisterWorkbook — values", () => {
  it("converts Excel serials, German text dates and ISO text; placeholders are no value; impossible dates are reported and withheld", () => {
    const { records, report } = parseRegisterWorkbook([
      registerSheet([
        registerRow({ projektnummer: "G.1", termin: 45_000, reviews: { EEA: ["offen", "A", "17.02.2026"], ITK: ["offen", "B", "-"], BS: ["offen", "C", "31.02.2024"], GA: ["offen", "D", "2025-03-22"], HFT: ["offen", "E", 20_250_131] } }),
        registerRow({ projektnummer: "G.2", termin: "-" }),
        registerRow({ projektnummer: "G.3", termin: "irgendwann" }),
      ]),
    ]);
    const [a, b, c] = records;
    expect(a?.fields.terminProjektvorstellung).toBe("2023-03-15");
    expect(a?.reviews.EEA?.datum).toBe("2026-02-17");
    expect(a?.reviews.ITK?.datum).toBeNull();
    expect(a?.reviews.BS?.datum).toBeNull();
    expect(a?.reviews.GA?.datum).toBe("2025-03-22");
    expect(a?.reviews.HFT?.datum).toBe("2025-01-31");
    expect(b?.fields.terminProjektvorstellung).toBeNull();
    expect(c?.fields.terminProjektvorstellung).toBeNull();
    const bad = report.issues.filter((i) => i.kind === "date-unparseable").map((i) => i.value);
    expect(bad.sort()).toEqual(["31.02.2024", "irgendwann"]);
  });

  it("canonicalises Bahnhofsmanagement, withholds unknown ones, and treats placeholders as empty", () => {
    const { records, report } = parseRegisterWorkbook([
      registerSheet([
        registerRow({ projektnummer: "G.1", bm: "Darmstadt LOS 1" }),
        registerRow({ projektnummer: "G.2", bm: "???" }),
        registerRow({ projektnummer: "G.3", bm: "Atlantis" }),
        registerRow({ projektnummer: "G.4", bm: "Bitte auswählen" }),
      ]),
    ]);
    expect(records.map((r) => r.fields.bahnhofsmanagement)).toEqual(["Darmstadt", null, null, null]);
    expect(report.issues.filter((i) => i.kind === "bahnhofsmanagement-unknown").map((i) => i.value)).toEqual(["Atlantis"]);
  });

  it("keeps annotated and variant statuses as written, withholds a status outside the vocabulary but keeps name and date", () => {
    const { records, report } = parseRegisterWorkbook([
      registerSheet([registerRow({ projektnummer: "G.1", reviews: { TBQ: ["Niederschrift erstellt (LP05-05-01-F31)", "T", 45_000], ITK: ["Projektkonfiguration", null, null], UM: ["vielleicht", "U", 45_001] } })]),
    ]);
    const r = records[0]!;
    expect(r.reviews.TBQ?.status).toBe("Niederschrift erstellt (LP05-05-01-F31)");
    expect(r.reviews.ITK?.status).toBe("Projektkonfiguration");
    expect(r.reviews.UM).toEqual({ status: null, prueferName: "U", datum: "2023-03-16" });
    expect(report.issues.filter((i) => i.kind === "status-unknown").map((i) => i.value)).toEqual(["vielleicht"]);
  });

  it("creates no review for a department whose three cells are empty", () => {
    const { records } = parseRegisterWorkbook([registerSheet([registerRow({ projektnummer: "G.1", reviews: { ITK: [null, null, null] } })])]);
    expect(Object.keys(records[0]!.reviews)).toHaveLength(13); // the other 13 default to "nicht erforderlich"
    expect(records[0]!.reviews.ITK).toBeUndefined();
  });

  it("keeps leading zeros of a Bahnhofsnummer and numeric Streckennummern", () => {
    const { records } = parseRegisterWorkbook([registerSheet([registerRow({ projektnummer: "G.1", bahnhofsnummer: "0945", strecke: 3010 }), registerRow({ projektnummer: "G.2", bahnhofsnummer: 489, strecke: "3601, 3688" })])]);
    expect(records.map((r) => [r.fields.bahnhofsnummer, r.fields.streckennummer])).toEqual([["0945", "3010"], ["489", "3601, 3688"]]);
  });

  it("counts blank rows, drops rows with no identity, keeps rows without a Projektnummer", () => {
    const { records, report } = parseRegisterWorkbook([
      registerSheet([
        registerRow({ projektnummer: null, station: "Nur Station", beschreibung: "X" }),
        Array(REGISTER_HEADER.length).fill(null),
        registerRow({ projektnummer: null, station: null, beschreibung: null }),
        registerRow({ projektnummer: "G.1" }),
      ]),
    ]);
    expect(records).toHaveLength(2);
    expect(report.blank).toBe(1);
    expect(report.withoutProjektnummer).toBe(1);
    expect(report.issues.some((i) => i.kind === "row-no-identity" && i.row === 11)).toBe(true);
  });

  it("does not collapse repeated Projektnummern into one project", () => {
    const { records, report } = parseRegisterWorkbook([registerSheet([registerRow({ projektnummer: "G.1", station: "A" }), registerRow({ projektnummer: "G.1", station: "B" }), registerRow({ projektnummer: "g. 1", station: "C" })])]);
    expect(records).toHaveLength(3);
    expect(report.repeatedProjektnummern).toBe(1);
  });

  it("round-trips through a real .xlsx file read with the repository's reader (serial dates, no macros executed)", () => {
    const ws = XLSX.utils.aoa_to_sheet(registerSheet([registerRow({ projektnummer: "G.1", reviews: { ITK: ["offen", "Pia", 45_000] } })]).rows as unknown[][]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Übersicht");
    const out = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
    const { records } = parseRegisterWorkbook(sheetsFromWorkbook(XLSX, out));
    expect(records[0]?.reviews.ITK).toEqual({ status: "offen", prueferName: "Pia", datum: "2023-03-15" });
  });
});

describe("analyzeSource — duplicates inside the file", () => {
  const parse = (rows: unknown[][]) => parseRegisterWorkbook([registerSheet(rows)]).records;

  it("keeps a row that repeats another cell for cell once, and says so", () => {
    const a = analyzeSource(parse([registerRow({ projektnummer: "G.1" }), registerRow({ projektnummer: "G.1" })]));
    expect(a.accepted).toHaveLength(1);
    expect(a.identicalDropped).toEqual([10]);
    expect(a.heldDuplicates).toEqual([]);
  });

  it("imports none of the rows that share an identity but differ in content (no silent merge, no silent winner)", () => {
    const a = analyzeSource(parse([registerRow({ projektnummer: "G.1", kommentar: "a" }), registerRow({ projektnummer: "G.1", kommentar: "b" }), registerRow({ projektnummer: "G.2" })]));
    expect(a.accepted.map((r) => r.fields.projektnummer)).toEqual(["G.2"]);
    expect(a.heldDuplicates).toEqual([{ fullKey: expect.any(String), rows: [9, 10] }]);
    expect(a.issues.some((i) => i.kind === "duplicate-conflict")).toBe(true);
  });

  it("different Projektstand or Termin under the same number/station/description are different registrations", () => {
    const a = analyzeSource(parse([registerRow({ projektnummer: "G.1", stand: "AP" }), registerRow({ projektnummer: "G.1", stand: "EP" }), registerRow({ projektnummer: "G.1", stand: "AP", termin: 45_001 })]));
    expect(a.accepted).toHaveLength(3);
  });
});
