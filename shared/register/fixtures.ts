/**
 * Synthetic fixtures (Übersichtsliste) that reproduce the EDGE CASES measured on the real workbooks — their shapes and proportions, none of
 * their data (every name, number, station and link is invented). Used by the unit tests, the real-database tests and the
 * browser proof, so all three exercise the same awkward inputs.
 *
 *  Übersichtsliste:  one framework number on many stations and phases · rows without a Projektnummer · groups of rows with one
 *                    identity and different content (cells of the department reviews, the Kommentar) · a cell-for-cell
 *                    duplicate · two dates in one cell, an impossible year, "-" · statuses outside the vocabulary and the
 *                    variants of the vocabulary · Bahnhofsmanagement lots and placeholders · a station spelled with a
 *                    bracketed qualifier
 *
 * Register only: the Prüfbericht fixtures are in shared/itk/edge-fixtures.ts, and the pair that exercises the link is
 * composed in shared/link-fixtures.ts.
 */
import type { SheetInput } from "../workbook-cells";
import { registerRow, registerSheet, type RowSpec } from "./testing";

/** The framework number carried by many stations (and, in shared/link-fixtures.ts, named by reports). */
export const FRAMEWORK = "G.F0001";

/** Rows of the Übersicht sheet; `edgeCaseRegisterSheet()` wraps them in the real layout. */
export function edgeCaseRegisterRows(): RowSpec[] {
  const rows: RowSpec[] = [];
  // one framework number on 8 stations; 3 of them registered twice (AP and EP) — the real file: one number on up to 100 rows
  const onePhase = new Set(["Musterstadt (Main) Marktplatz", "Testhausen Hbf", "Beta", "Gamma", "Delta"]);
  for (const [i, station] of ["Musterstadt (Main) Marktplatz", "Beispieldorf", "Testhausen Hbf", "Probenburg", "Alpha", "Beta", "Gamma", "Delta"].entries()) {
    rows.push({ projektnummer: FRAMEWORK, station, bm: i % 2 ? "Mainz" : "Kassel", beschreibung: "Rahmenmaßnahme ELA", stand: "AP", termin: 45_000 + i });
    if (!onePhase.has(station)) rows.push({ projektnummer: FRAMEWORK, station, bm: i % 2 ? "Mainz" : "Kassel", beschreibung: "Rahmenmaßnahme ELA", stand: "EP", termin: 45_100 + i });
  }
  // no Projektnummer at all
  rows.push({ projektnummer: null, station: "Ohne Nummer Nord", beschreibung: "Sonderfall 1" });
  rows.push({ projektnummer: null, station: "Ohne Nummer Süd", beschreibung: "Sonderfall 2" });
  // the FILE cannot decide: same identity, different content
  rows.push({ projektnummer: "G.D0001", station: "Dublette", beschreibung: "Doppelt geführt", reviews: { ITK: ["offen", "Pia", 45_000] } });
  rows.push({ projektnummer: "G.D0001", station: "Dublette", beschreibung: "Doppelt geführt", reviews: { ITK: ["Zustimmung erteilt", "Pia", 45_010] } });
  rows.push({ projektnummer: "G.D0002", station: "Dublette", beschreibung: "Kommentar abweichend", kommentar: "Fassung A" });
  rows.push({ projektnummer: "G.D0002", station: "Dublette", beschreibung: "Kommentar abweichend", kommentar: "Fassung B" });
  // …and a cell-for-cell duplicate, which needs no decision
  rows.push({ projektnummer: "G.D0003", station: "Dublette", beschreibung: "Wirklich identisch" });
  rows.push({ projektnummer: "G.D0003", station: "Dublette", beschreibung: "Wirklich identisch" });
  // odd dates
  rows.push({ projektnummer: "G.T0001", station: "Datumsfall 1", termin: "08.09.2023\n14.03.2024" });
  rows.push({ projektnummer: "G.T0002", station: "Datumsfall 2", termin: "30.12.20025" });
  rows.push({ projektnummer: "G.T0003", station: "Datumsfall 3", termin: "-" });
  rows.push({ projektnummer: "G.T0004", station: "Datumsfall 4", termin: "17.02.2026" });
  // statuses: outside the vocabulary (withheld), variants of it (kept as written)
  rows.push({ projektnummer: "G.S0001", station: "Statusfall", reviews: { TBQ: ["Protokoll erstellt", "Tom", 45_000], UM: ["planungsbegleitend", "Uli", 45_000], ITK: ["Projektkonfiguration", null, null], EEA: ["Niederschrift erstellt (LP05-05-01-F31)", "Eva", 45_000] } });
  // Bahnhofsmanagement lots and placeholders
  rows.push({ projektnummer: "G.B0001", station: "Los 1", bm: "Darmstadt LOS 1" });
  rows.push({ projektnummer: "G.B0002", station: "Los 2", bm: "???" });
  rows.push({ projektnummer: "G.B0003", station: "Los 3", bm: "Bitte auswählen" });
  return rows;
}

export const edgeCaseRegisterSheet = (): SheetInput => registerSheet(edgeCaseRegisterRows().map(registerRow));

/** What `edgeCaseRegisterRows()` is built to produce — asserted in fixtures.test.ts so the fixture cannot drift from its purpose. */
export const EDGE_CASE_REGISTER = { rows: 11 + 2 + 6 + 4 + 1 + 3, withoutProjektnummer: 2, heldGroups: 2, identicalDropped: 1, unparseableDates: 2, unknownStatuses: 2, bmUnknown: 0 } as const;
