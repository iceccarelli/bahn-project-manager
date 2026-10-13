/**
 * Reads the Übersichtsliste ("Übersichtsliste.xlsm", sheet "Übersicht") into project records and department reviews —
 * and into a report that says exactly what was and was not understood.
 *
 * Same stance as the Prüfbericht workbook importer (a separate domain: nothing here imports it), mirrored deliberately:
 *  - header-driven, not position-driven: a column is mapped when its header is recognised. The expected column letters
 *    from the workbook's documented layout are only *compared* — a moved column is reported, never silently followed
 *    into the wrong field;
 *  - values are stored as found (trimmed, whitespace collapsed, placeholders such as "???" / "Bitte auswählen" are "no
 *    value"); a value outside a vocabulary is reported and withheld, never rewritten;
 *  - a row is dropped only for a reason that is written to the report, with its sheet row;
 *  - the sheet row number is for the report only. It is not an identifier (rows move when people sort).
 *
 * The 14 department groups (Status / Name / Datum) map onto `department_reviews`; no department gets columns of its own.
 * Macros are never executed: the workbook is read as cell values by the caller (`sheetsFromWorkbook`).
 *
 * Pure: takes the cell grid per sheet, so the same code runs in the browser, in the CLI and in tests.
 */
import { normalizeBahnhofsmanagement } from "../bahnhofsmanagement";
import { cleanStr } from "../ingest";
import { dayFromCell, foldHeader, type SheetInput } from "../workbook-cells";
import { fullKey, hasIdentity } from "../project-identity";
import { normalizeReviewStatus } from "../review-status";
import { ProjectPatchSchema } from "../project-contract";
import { DEPARTMENTS, type Department } from "../validation";

/** Names the workbook in the key table (`project_source_keys.source`). */
export const REGISTER_SOURCE = "uebersichtsliste";
export const REGISTER_SHEET = "Übersicht";
/** Excel row (1-based) of the header in the workbook as delivered. Compared, not trusted. */
export const EXPECTED_HEADER_ROW = 8;

export interface RegisterFields {
  projektnummer: string | null;
  bahnhofsmanagement: string | null;
  station: string | null;
  bahnhofsnummer: string | null;
  streckennummer: string | null;
  projektbeschreibung: string | null;
  projektstand: string | null;
  projektleiter: string | null;
  /** ISO day */
  terminProjektvorstellung: string | null;
  kommentar: string | null;
  projektLink: string | null;
}
export const REGISTER_FIELD_KEYS = [
  "projektnummer", "bahnhofsmanagement", "station", "bahnhofsnummer", "streckennummer", "projektbeschreibung",
  "projektstand", "projektleiter", "terminProjektvorstellung", "kommentar", "projektLink",
] as const satisfies readonly (keyof RegisterFields)[];

export interface RegisterReview {
  status: string | null;
  prueferName: string | null;
  /** ISO day */
  datum: string | null;
}
export type RegisterReviews = Partial<Record<Department, RegisterReview>>;

export interface RegisterRecord {
  /** Excel row in the source sheet. For messages and for correlating one run's responses ONLY — never an identity. */
  ref: number;
  fields: RegisterFields;
  reviews: RegisterReviews;
}

export type IssueKind =
  | "sheet-missing" | "header-missing" | "header-moved" | "header-unknown" | "department-layout"
  | "row-no-identity" | "bahnhofsmanagement-unknown" | "date-unparseable" | "status-unknown" | "value-invalid"
  | "no-projektnummer" | "duplicate-identical" | "duplicate-conflict";
export interface RegisterIssue {
  kind: IssueKind;
  severity: "error" | "warn" | "info";
  message: string;
  row?: number;
  column?: string;
  value?: string;
}

export interface DepartmentColumns {
  department: Department;
  header: string;
  /** 1-based column of Status; Name and Datum follow it directly */
  column: number;
  expected: string;
}
export interface RegisterReport {
  sheet: string | null;
  headerRow: number | null;
  columns: Partial<Record<keyof RegisterFields, string>>;
  departments: DepartmentColumns[];
  missingDepartments: Department[];
  unmappedHeaders: string[];
  rows: number;
  blank: number;
  records: number;
  withoutProjektnummer: number;
  /** distinct Projektnummern that more than one record carries */
  repeatedProjektnummern: number;
  issues: RegisterIssue[];
  ignoredSheets: string[];
  /** statuses outside the review vocabulary, withheld: value × department × rows (a vocabulary decision belongs to the data owner) */
  unknownStatuses: Array<{ value: string; department: Department; rows: number }>;
}

export interface RegisterParse {
  records: RegisterRecord[];
  report: RegisterReport;
}

/** ---- header recognition ---------------------------------------------------------------------------------------- */

const FIELD_HEADERS: Record<keyof RegisterFields, readonly string[]> = {
  projektnummer: ["projektnummer", "projektnr"],
  bahnhofsmanagement: ["bahnhofsmanagement", "bm"],
  station: ["station", "bahnhof"],
  bahnhofsnummer: ["bahnhofsnummer", "bahnhofsnr", "bfnr"],
  streckennummer: ["streckennummer", "streckennr"],
  projektbeschreibung: ["projektbeschreibung", "beschreibung"],
  projektstand: ["projektstand"],
  projektleiter: ["projektleiter", "projektleitung"],
  terminProjektvorstellung: ["terminprojektvorstellung", "projektvorstellung"],
  kommentar: ["kommentar"],
  projektLink: ["linkzumprojekt", "projektlink", "link"],
};

/**
 * Department header aliases (folded). "Baubetriebstechnnologie" is how the workbook spells it; the canonical name has one
 * "n". Anything else is reported as unmapped instead of being guessed into a department.
 */
const DEPARTMENT_HEADERS: Record<Department, readonly string[]> = {
  EEA: ["eea"], ITK: ["itk"], BS: ["bs"], GA: ["ga"], Energie: ["energie"], HFT: ["hft"], HKLS: ["hkls"], TBQ: ["tbq"],
  UM: ["um"], BIM: ["bim"], LST: ["lst"], Vermessung: ["vermessung"],
  Baubetriebstechnologie: ["baubetriebstechnologie", "baubetriebstechnnologie"],
  Baubetriebsplanung: ["baubetriebsplanung"],
};
/** Status-column letters of the documented layout; each department's Name and Datum columns follow. */
const EXPECTED_STATUS_COLUMN: Record<Department, string> = {
  EEA: "J", ITK: "M", BS: "P", GA: "S", Energie: "V", HFT: "Y", HKLS: "AB", TBQ: "AE", UM: "AH", BIM: "AK", LST: "AN",
  Vermessung: "AQ", Baubetriebstechnologie: "AT", Baubetriebsplanung: "AW",
};

export function columnLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const cellText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  return cleanStr(String(v));
};

/** A numeric Bahnhofs-/Streckennummer arrives as a number; "0945" arrives as text and keeps its zeros. */
const numberLike = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Number.isInteger(v) ? String(v) : String(v);
  return cellText(v);
};

const PLACEHOLDER_DATE = /^[-–—?]+$|^(n\/a|offen|tbd|entfällt|keine)$/i;

/** ---- parsing ---------------------------------------------------------------------------------------------------- */

export function parseRegisterWorkbook(sheets: readonly SheetInput[]): RegisterParse {
  const report: RegisterReport = {
    sheet: null, headerRow: null, columns: {}, departments: [], missingDepartments: [], unmappedHeaders: [],
    rows: 0, blank: 0, records: 0, withoutProjektnummer: 0, repeatedProjektnummern: 0, issues: [], ignoredSheets: [], unknownStatuses: [],
  };
  const issue = (i: RegisterIssue) => report.issues.push(i);

  const sheet = sheets.find((s) => foldHeader(s.name) === foldHeader(REGISTER_SHEET));
  report.ignoredSheets = sheets.filter((s) => s !== sheet).map((s) => s.name);
  if (!sheet) {
    issue({ kind: "sheet-missing", severity: "error", message: `Blatt „${REGISTER_SHEET}“ nicht gefunden` });
    return { records: [], report };
  }
  report.sheet = sheet.name;

  // Header row: the first row (within the top 40) that names Projektnummer, Station and Projektbeschreibung.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(sheet.rows.length, 40); i++) {
    const folded = (sheet.rows[i] ?? []).map(foldHeader);
    if (folded.includes("projektnummer") && folded.includes("station") && folded.includes("projektbeschreibung")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    issue({ kind: "header-missing", severity: "error", message: "Kopfzeile (Projektnummer / Station / Projektbeschreibung) nicht gefunden" });
    return { records: [], report };
  }
  report.headerRow = headerIdx + 1;
  if (report.headerRow !== EXPECTED_HEADER_ROW) {
    issue({ kind: "header-moved", severity: "warn", message: `Kopfzeile steht in Zeile ${report.headerRow} (erwartet: ${EXPECTED_HEADER_ROW}) — nach Kopfzeile gelesen, nicht nach Position` });
  }

  const header = sheet.rows[headerIdx] ?? [];
  const folded = header.map(foldHeader);
  const fieldCol = new Map<keyof RegisterFields, number>();
  for (const key of REGISTER_FIELD_KEYS) {
    const idx = folded.findIndex((h, i) => h !== "" && FIELD_HEADERS[key].includes(h) && !fieldCol.has(key) && ![...fieldCol.values()].includes(i));
    if (idx >= 0) {
      fieldCol.set(key, idx);
      report.columns[key] = columnLetter(idx);
    }
  }
  for (const required of ["projektnummer", "station", "projektbeschreibung"] as const) {
    if (!fieldCol.has(required)) issue({ kind: "header-missing", severity: "error", message: `Spalte „${required}“ nicht gefunden` });
  }
  if (report.issues.some((i) => i.severity === "error")) return { records: [], report };

  // Department groups: header = the department's name, followed directly by a Name… and a Datum… column.
  const deptCol = new Map<Department, number>();
  for (const dept of DEPARTMENTS) {
    const idx = folded.findIndex((h, i) => DEPARTMENT_HEADERS[dept].includes(h) && !deptCol.has(dept) && ![...fieldCol.values()].includes(i));
    if (idx < 0) {
      report.missingDepartments.push(dept);
      issue({ kind: "department-layout", severity: "warn", message: `Gewerk ${dept}: keine Spalte gefunden — ohne Import dieses Gewerks` });
      continue;
    }
    const name = folded[idx + 1] ?? "";
    const datum = folded[idx + 2] ?? "";
    if (!name.startsWith("name") || !datum.startsWith("datum")) {
      report.missingDepartments.push(dept);
      issue({ kind: "department-layout", severity: "warn", message: `Gewerk ${dept}: auf „${String(header[idx])}“ folgen nicht „Name“ und „Datum“ (gefunden: „${String(header[idx + 1] ?? "")}“, „${String(header[idx + 2] ?? "")}“) — ohne Import dieses Gewerks` });
      continue;
    }
    deptCol.set(dept, idx);
    const letter = columnLetter(idx);
    report.departments.push({ department: dept, header: String(header[idx]), column: idx + 1, expected: EXPECTED_STATUS_COLUMN[dept] });
    if (letter !== EXPECTED_STATUS_COLUMN[dept]) {
      issue({ kind: "header-moved", severity: "warn", message: `Gewerk ${dept} steht in Spalte ${letter} (erwartet ${EXPECTED_STATUS_COLUMN[dept]}) — nach Kopfzeile gelesen` });
    }
  }

  const used = new Set<number>([...fieldCol.values(), ...[...deptCol.values()].flatMap((c) => [c, c + 1, c + 2])]);
  report.unmappedHeaders = header
    .map((h, i) => ({ h: cellText(h), i }))
    .filter(({ h, i }) => h !== null && !used.has(i))
    .map(({ h, i }) => `${columnLetter(i)}: ${h}`);
  for (const u of report.unmappedHeaders) issue({ kind: "header-unknown", severity: "info", message: `Kopfzelle ohne Feld: ${u}` });

  const dateOf = (raw: unknown, row: number, column: string): string | null => {
    if (raw === null || raw === undefined || raw === "") return null;
    const iso = dayFromCell(raw);
    if (iso) return iso;
    const t = String(raw).trim();
    if (t === "" || PLACEHOLDER_DATE.test(t)) return null;
    issue({ kind: "date-unparseable", severity: "warn", row, column, value: t.slice(0, 60), message: `Zeile ${row}, ${column}: „${t.slice(0, 60)}“ ist kein sicher lesbares Datum — Feld bleibt leer` });
    return null;
  };

  const records: RegisterRecord[] = [];
  for (let i = headerIdx + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] ?? [];
    const rowNo = i + 1;
    report.rows += 1;
    if (row.every((c) => c === null || c === undefined || String(c).trim() === "")) {
      report.blank += 1;
      continue;
    }
    const get = (k: keyof RegisterFields) => (fieldCol.has(k) ? row[fieldCol.get(k) as number] : null);

    const bm = normalizeBahnhofsmanagement(get("bahnhofsmanagement"));
    if (bm.unmapped !== null) {
      issue({ kind: "bahnhofsmanagement-unknown", severity: "warn", row: rowNo, column: report.columns.bahnhofsmanagement, value: bm.unmapped, message: `Zeile ${rowNo}: Bahnhofsmanagement „${bm.unmapped}“ ist unbekannt — Feld bleibt leer` });
    }
    const fields: RegisterFields = {
      projektnummer: cellText(get("projektnummer")),
      bahnhofsmanagement: bm.value,
      station: cellText(get("station")),
      bahnhofsnummer: numberLike(get("bahnhofsnummer")),
      streckennummer: numberLike(get("streckennummer")),
      projektbeschreibung: cellText(get("projektbeschreibung")),
      projektstand: cellText(get("projektstand")),
      projektleiter: cellText(get("projektleiter")),
      terminProjektvorstellung: dateOf(get("terminProjektvorstellung"), rowNo, report.columns.terminProjektvorstellung ?? "?"),
      kommentar: cellText(get("kommentar")),
      projektLink: cellText(get("projektLink")),
    };

    const reviews: RegisterReviews = {};
    for (const [dept, col] of deptCol) {
      const letter = columnLetter(col);
      const statusRaw = cellText(row[col]);
      const prueferName = cellText(row[col + 1]);
      const datum = dateOf(row[col + 2], rowNo, columnLetter(col + 2));
      let status = statusRaw;
      if (status !== null && normalizeReviewStatus(status) === null) {
        issue({ kind: "status-unknown", severity: "warn", row: rowNo, column: letter, value: status.slice(0, 80), message: `Zeile ${rowNo}, ${dept}: Status „${status.slice(0, 80)}“ gehört nicht zum Vokabular — Status bleibt leer, Name und Datum werden übernommen` });
        const seen = report.unknownStatuses.find((u) => u.value === statusRaw && u.department === dept);
        if (seen) seen.rows += 1;
        else report.unknownStatuses.push({ value: statusRaw as string, department: dept, rows: 1 });
        status = null;
      }
      if (status !== null || prueferName !== null || datum !== null) reviews[dept] = { status, prueferName, datum };
    }

    if (!hasIdentity(fields)) {
      issue({ kind: "row-no-identity", severity: "warn", row: rowNo, message: `Zeile ${rowNo}: weder Projektnummer noch Station noch Beschreibung — nicht identifizierbar, nicht importiert` });
      continue;
    }
    // The wire schema is the app's own definition of a valid project; a row that fails it would fail on write.
    const parsed = ProjectPatchSchema.safeParse(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      issue({ kind: "value-invalid", severity: "warn", row: rowNo, column: String(first?.path[0] ?? ""), message: `Zeile ${rowNo}: ${String(first?.path[0] ?? "Feld")} — ${first?.message ?? "ungültig"} — nicht importiert` });
      continue;
    }
    if (fields.projektnummer === null) {
      report.withoutProjektnummer += 1;
      issue({ kind: "no-projektnummer", severity: "info", row: rowNo, message: `Zeile ${rowNo}: ohne Projektnummer — Identität nur aus Station und Beschreibung` });
    }
    records.push({ ref: rowNo, fields, reviews });
  }
  report.records = records.length;

  const pnCount = new Map<string, number>();
  for (const r of records) if (r.fields.projektnummer) pnCount.set(r.fields.projektnummer.toUpperCase().replace(/\s+/g, ""), (pnCount.get(r.fields.projektnummer.toUpperCase().replace(/\s+/g, "")) ?? 0) + 1);
  report.repeatedProjektnummern = [...pnCount.values()].filter((n) => n > 1).length;

  return { records, report };
}

/** ---- duplicates inside the source ------------------------------------------------------------------------------- */

const sameContent = (a: RegisterRecord, b: RegisterRecord): boolean =>
  JSON.stringify([a.fields, Object.entries(a.reviews).sort()]) === JSON.stringify([b.fields, Object.entries(b.reviews).sort()]);

export interface SourceAnalysis {
  /** one record per distinct identity — what may be planned and imported without a question */
  accepted: RegisterRecord[];
  /** `accepted` plus every row of the held groups: what goes to the planner, which turns the held rows into explicit questions */
  forPlanning: RegisterRecord[];
  /** rows that share a full key with a *different* record: which one is the project is not decidable from the file */
  heldDuplicates: Array<{ fullKey: string; rows: number[] }>;
  /** rows dropped because they repeat another row cell for cell */
  identicalDropped: number[];
  issues: RegisterIssue[];
}

/**
 * Rows sharing a full key (Projektnummer, Station, Beschreibung, Projektstand, Termin) are either the same row twice
 * (kept once) or different content under one identity (nothing in the file says which is right → none of them is
 * imported; the report names the rows so the workbook can be fixed). Nothing is merged.
 */
export function analyzeSource(records: readonly RegisterRecord[]): SourceAnalysis {
  const groups = new Map<string, RegisterRecord[]>();
  for (const r of records) {
    const k = fullKey({ ...r.fields });
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: SourceAnalysis = { accepted: [], forPlanning: [], heldDuplicates: [], identicalDropped: [], issues: [] };
  const heldRows: RegisterRecord[] = [];
  for (const [k, list] of groups) {
    const first = list[0] as RegisterRecord;
    if (list.length === 1) {
      out.accepted.push(first);
    } else if (list.every((r) => sameContent(r, first))) {
      out.accepted.push(first);
      out.identicalDropped.push(...list.slice(1).map((r) => r.ref));
      out.issues.push({ kind: "duplicate-identical", severity: "info", row: first.ref, message: `Zeilen ${list.map((r) => r.ref).join(", ")} sind inhaltsgleich — einmal übernommen` });
    } else {
      heldRows.push(...list);
      out.heldDuplicates.push({ fullKey: k, rows: list.map((r) => r.ref) });
      out.issues.push({ kind: "duplicate-conflict", severity: "warn", row: first.ref, message: `Zeilen ${list.map((r) => r.ref).join(", ")} haben dieselbe Identität (Projektnummer, Station, Beschreibung, Projektstand, Termin), aber unterschiedlichen Inhalt — nicht importiert` });
    }
  }
  // keep source order so reports and batches are stable
  out.accepted.sort((a, b) => a.ref - b.ref);
  out.forPlanning = [...out.accepted, ...heldRows].sort((a, b) => a.ref - b.ref);
  return out;
}
