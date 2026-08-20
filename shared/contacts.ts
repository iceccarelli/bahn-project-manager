/**
 * Fachspezialisten contacts — sheet `Hilfsdatei` of
 * Projektanmeldung-Fachspezialistenpruefung.xlsm, transcribed by
 * scripts/extract-contacts.ts (`pnpm contacts:extract`).
 *
 * ---------------------------------------------------------------------------
 * The off-by-two
 * ---------------------------------------------------------------------------
 * The live macro builds the ITK notification from Hilfsdatei rows 8-12
 * (VBA lines 201-210 and 1203-1212, `MITK1..MITK5` / `ITK1..ITK5`).
 * The ITK block in Hilfsdatei is rows 10-14. The macro is two rows high, so
 * every ITK notification since has:
 *
 *   included  row 8   Lucas Gorißen      — a BRANDSCHUTZ specialist
 *   included  row 9   (blank separator)  — an empty recipient
 *   omitted   row 13  Emin Er            — 471 ITK reviews, the busiest reviewer
 *   omitted   row 14  Daniel Goldhausen  —  10 ITK reviews
 *
 * scripts/extract-contacts.ts detects this structurally rather than on
 * assertion: it reports that F17's recipient rows span two different group
 * labels ("Brandschutz" and "Informations- und Telekommunikationstechnologien").
 *
 * DEPARTMENT_RECIPIENT_ROWS below is the corrected map. VBA_RECIPIENT_ROWS
 * preserves what the macro actually does, so contacts.test.ts can assert the
 * difference is exactly this one fix and not an accidental re-shuffle.
 *
 * ---------------------------------------------------------------------------
 * Departments that reach nobody
 * ---------------------------------------------------------------------------
 * Transcription also surfaced recipient rows that carry a group label but no
 * address, so the macro sends to an empty string:
 *
 *   LST                     rows 74, 75      BOTH empty — 52 reviews, 22 open,
 *                                            and the notification has never
 *                                            reached a single person
 *   Baubetriebstechnologie  rows 82, 85      2 of 4 empty —  40 reviews, 20 open
 *   Vermessung              row  72          1 of 2 empty — 142 reviews, 97 open
 *   BIM                     row  67          1 of 5 empty — 125 reviews, 88 open
 *   HKLS                    row  69          1 of 3 empty — 250 reviews, 89 open
 *   BS                      row   9          1 of 5 empty — 520 reviews, 134 open
 *
 * These are missing data, not a code defect: nobody can be notified who has no
 * address on file. `recipientsFor()` drops the empty rows rather than emitting
 * blank recipients, and `departmentsWithoutRecipients()` names the departments
 * that would silently notify nobody, so the UI can say so instead of showing a
 * successful send.
 */

import type { Department } from "./types";

export interface Contact {
  /** Row in sheet `Hilfsdatei`. Kept so any address can be traced to its source. */
  row: number;
  /** Column A — the group label as the workbook writes it. */
  group: string;
  /** Column B. */
  name: string;
  /** Column C. */
  mail: string;
}

/** Every Hilfsdatei row that carries an address. Rows without one are omitted. */
export const CONTACTS: readonly Contact[] = [
  { row:  5, group: "Brandschutz", name: "Patrick Bierbaum", mail: "patrick.bierbaum@deutschebahn.com" },
  { row:  6, group: "Brandschutz", name: "Sebastian Fey", mail: "sebastian.s.fey@deutschebahn.com" },
  { row:  7, group: "Brandschutz", name: "Mert-Yakup Afteni", mail: "mert-yakup.afteni@deutschebahn.com" },
  { row:  8, group: "Brandschutz", name: "Lucas Gorißen", mail: "Lucas.Gorissen@deutschebahn.com" },
  { row: 10, group: "Informations- und Telekommunikationstechnologien (ITK)", name: "", mail: "DB.InfraGO.AG-RB.Mitte.ITKAM@deutschebahn.com" },
  { row: 11, group: "Informations- und Telekommunikationstechnologien (ITK)", name: "Robert Gabai", mail: "Robert.Gabai@deutschebahn.com" },
  { row: 12, group: "Informations- und Telekommunikationstechnologien (ITK)", name: "Vincenzo Grimaldi", mail: "Vincenzo.V.Ceccarelli-Grimaldi@deutschebahn.com" },
  { row: 13, group: "Informations- und Telekommunikationstechnologien (ITK)", name: "Emin Er", mail: "emin.er@deutschebahn.com" },
  { row: 14, group: "Informations- und Telekommunikationstechnologien (ITK)", name: "Daniel Goldhausen", mail: "Daniel.Goldhausen@deutschebahn.com" },
  { row: 15, group: "Fachkoordinator Energie", name: "Florian Lorenz", mail: "florian.f.lorenz@deutschebahn.com" },
  { row: 16, group: "Fachspezialist Heizung-, Lüftung-, Sanitärtechnik", name: "Thorben Haberla", mail: "Thorben.Haberla@deutschebahn.com" },
  { row: 17, group: "Fachkoordinator Gebäudeautomation", name: "Sascha Weyer", mail: "sascha.weyer@deutschebahn.com" },
  { row: 18, group: "Elektrotechnik", name: "Nils Schomber", mail: "nils.schomber@deutschebahn.com" },
  { row: 19, group: "Elektrotechnik", name: "Jan Degen", mail: "jan.degen@deutschebahn.com" },
  { row: 20, group: "Elektrotechnik", name: "Dirk Ries", mail: "dirk.ries@deutschebahn.com" },
  { row: 21, group: "Elektrotechnik", name: "Ali Aydogdu", mail: "ali.aydogdu@deutschebahn.com" },
  { row: 22, group: "Fördertechnik", name: "Stephan Hartung", mail: "stephan.hartung@deutschebahn.com" },
  { row: 23, group: "Umweltmanagement", name: "Christian Kohlwey", mail: "christian.kohlwey@deutschebahn.com" },
  { row: 24, group: "Umweltmanagement", name: "Julia Hebbrecht", mail: "Julia.hebbrecht@deutschebahn.com" },
  { row: 25, group: "Fachkoordinator Heizung-, Lüftung-, Sanitärtechnik", name: "Benjamin Frischbier", mail: "benjamin.frischbier@deutschebahn.com" },
  { row: 26, group: "Fachspezialist Gebäudeautomation", name: "Johannes Kröcker", mail: "johannes.kroecker@deutschebahn.com" },
  { row: 38, group: "FAA-Mail in", name: "", mail: "FAA-DBInfraGO.RBMitte@deutschebahn.com" },
  { row: 39, group: "FAA kaufm. PM", name: "", mail: "kfm-PoM-DBInfraGO-RBMitte@deutschebahn.com" },
  { row: 40, group: "TBQ", name: "Masoud Vafaei", mail: "masoud.vafaei@deutschebahn.com" },
  { row: 41, group: "TBQ", name: "Sarah Dauth", mail: "sarah.dauth@deutschebahn.com" },
  { row: 42, group: "TBQ", name: "Torben-Leif Glandorf", mail: "torben-leif.glandorf@deutschebahn.com" },
  { row: 43, group: "TBQ", name: "Michel Bierbrauer", mail: "michel.bierbrauer@deutschebahn.com" },
  { row: 44, group: "TBQ", name: "Venuste Kubwimana", mail: "venuste.kubwimana@deutschebahn.com" },
  { row: 45, group: "TBQ", name: "Patrick Kalisa", mail: "patrick.kalisa@deutschebahn.com" },
  { row: 47, group: "Umweltmanagement", name: "Helena Burkhardt", mail: "Helena.Burkhardt@deutschebahn.com" },
  { row: 50, group: "Darmstadt", name: "Benjamin Schmidt", mail: "benjamin.schmidt@deutschebahn.com" },
  { row: 51, group: "Frankfurt", name: "Melanie Kühner", mail: "melanie.kuehner@deutschebahn.com" },
  { row: 52, group: "Gießen", name: "Carsten Hoepfner", mail: "carsten.hoepfner@deutschebahn.com" },
  { row: 53, group: "Kaiserslautern", name: "Kathrin Behsler", mail: "kathrin.behsler@deutschebahn.com" },
  { row: 54, group: "Kassel", name: "Michaela Andresen", mail: "michaela.andresen@deutschebahn.com" },
  { row: 55, group: "Koblenz", name: "Britta Remahne", mail: "britta.remahne@deutschebahn.com" },
  { row: 56, group: "Mainz", name: "Andre Schulte", mail: "Andre.An.Schulte@deutschebahn.com" },
  { row: 57, group: "Saarbrücken", name: "Jennifer Sauer", mail: "jennifer.sauer@deutschebahn.com" },
  { row: 60, group: "HuBs", name: "Luigi La Rocca", mail: "luigi.la-rocca@deutschebahn.com" },
  { row: 61, group: "ITK", name: "Klaus Hock", mail: "klaus.hock@deutschebahn.com" },
  { row: 62, group: "ITK", name: "Mirwais Khondel", mail: "Mirwais.Khondel@deutschebahn.com" },
  { row: 63, group: "BIM", name: "Beata Rabkin", mail: "beata.rabkin@deutschebahn.com" },
  { row: 64, group: "BIM", name: "Izzet Köksal", mail: "izzet.i.koeksal@deutschebahn.com" },
  { row: 65, group: "BIM", name: "Janis Schauß", mail: "janis.schauss@deutschebahn.com" },
  { row: 66, group: "BIM", name: "Duc Minh Nguyen", mail: "duc-minh.d.nguyen@deutschebahn.com" },
  { row: 71, group: "Vermessung", name: "Eda Pourabbas", mail: "Eda-Ahu.Pourabbas@deutschebahn.com" },
  { row: 77, group: "Baubetriebsplanung", name: "Gundolf Tielmann", mail: "gundolf.tielmann@deutschebahn.com" },
  { row: 78, group: "Baubetriebsplanung", name: "Kevin Kliwer", mail: "kevin.kliwer@deutschebahn.com" },
  { row: 79, group: "Baubetriebsplanung", name: "Morsal Rashidi", mail: "morsal.rashidi@deutschebahn.com" },
  { row: 83, group: "Baubetriebstechnologe", name: "Dimitri Widjajanto", mail: "Dimitri.Widjajanto@deutschebahn.com" },
  { row: 84, group: "Baubetriebstechnologe", name: "Markus Fuchs", mail: "Markus.Fuchs@deutschebahn.com" },
] as const;

const BY_ROW = new Map(CONTACTS.map((c) => [c.row, c]));

/**
 * What the live macro reads, verbatim. Kept so the fix stays visible and
 * testable rather than becoming folklore.
 */
export const VBA_RECIPIENT_ROWS: Readonly<Record<number, readonly number[]>> = {
  17: [8, 9, 10, 11, 12],
  18: [18, 19, 20, 21],
  19: [5, 6, 7, 8, 9],
  20: [22],
  21: [16, 25, 69],
  22: [17, 26],
  23: [15],
  24: [40, 41, 42, 43, 44, 45],
  25: [23, 24, 47],
  26: [50, 51, 52, 53, 54, 55, 56, 57],
  27: [60],
  28: [38, 39, 61, 62],
  29: [63, 64, 65, 66, 67],
  30: [74, 75],
  31: [71, 72],
  32: [82, 83, 84, 85],
  33: [77, 78, 79, 80],
};

/**
 * The corrected map, keyed by department rather than by Formular cell.
 *
 * Identical to VBA_RECIPIENT_ROWS except for ITK, which moves 8-12 -> 10-14.
 * Blank rows are left in deliberately: recipientsFor() filters them, and
 * keeping them here means the range still matches the workbook block, so a
 * future address filled into row 72 or 74 is picked up with no code change.
 */
export const DEPARTMENT_RECIPIENT_ROWS: Readonly<Record<Department, readonly number[]>> = {
  // 10-14, not 8-12. See the off-by-two note above.
  ITK: [10, 11, 12, 13, 14],
  EEA: [18, 19, 20, 21],
  BS: [5, 6, 7, 8, 9],
  HFT: [22],
  HKLS: [16, 25, 69],
  GA: [17, 26],
  Energie: [15],
  TBQ: [40, 41, 42, 43, 44, 45],
  UM: [23, 24, 47],
  BIM: [63, 64, 65, 66, 67],
  LST: [74, 75],
  Vermessung: [71, 72],
  Baubetriebstechnologie: [82, 83, 84, 85],
  Baubetriebsplanung: [77, 78, 79, 80],
};

/** Recipients that are not a Gewerk review: the BM per region, HuBs, ITK-FM, FAA. */
export const NOTIFY_ONLY_ROWS = {
  /** One per Bahnhofsmanagement, rows 50-57 in workbook order. */
  bahnhofsmanagement: [50, 51, 52, 53, 54, 55, 56, 57],
  huBs: [60],
  /** ITK-Facility-Management plus the two FAA mailboxes. */
  itkFm: [38, 39, 61, 62],
} as const;

/**
 * Addresses for a department, in workbook order, with blank rows dropped.
 *
 * Returns [] rather than throwing for a department with nothing on file —
 * callers must handle that, which is the point of
 * departmentsWithoutRecipients().
 */
export function recipientsFor(department: Department): Contact[] {
  const rows = DEPARTMENT_RECIPIENT_ROWS[department] ?? [];
  return rows.map((r) => BY_ROW.get(r)).filter((c): c is Contact => c !== undefined);
}

/** Addresses for one of the notify-only groups. */
export function notifyOnlyRecipients(group: keyof typeof NOTIFY_ONLY_ROWS): Contact[] {
  return NOTIFY_ONLY_ROWS[group]
    .map((r) => BY_ROW.get(r))
    .filter((c): c is Contact => c !== undefined);
}

/** The Bahnhofsmanagement contact for a region, matched on the group label. */
export function bahnhofsmanagementContact(bm: string | null | undefined): Contact | null {
  if (!bm) return null;
  const wanted = bm.trim().toLowerCase();
  return (
    notifyOnlyRecipients("bahnhofsmanagement").find(
      (c) => c.group.toLowerCase() === wanted,
    ) ?? null
  );
}

/**
 * Departments whose notification would reach nobody.
 *
 * The UI must surface this rather than reporting a successful send: an
 * "Anmeldung verschickt" toast for a department with no address on file is a
 * false confirmation, and LST has been in exactly that state.
 */
export function departmentsWithoutRecipients(): Department[] {
  return (Object.keys(DEPARTMENT_RECIPIENT_ROWS) as Department[]).filter(
    (d) => recipientsFor(d).length === 0,
  );
}

/**
 * What to show a human for a contact. Row 10 is the ITK shared mailbox: a real
 * address with no name in column B, which rendered as an empty list entry.
 */
export function displayName(c: Contact): string {
  return c.name || c.mail;
}

/** Unique, de-duplicated addresses for a set of departments. */
export function mailListFor(departments: readonly Department[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of departments) {
    for (const c of recipientsFor(d)) {
      const key = c.mail.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c.mail);
    }
  }
  return out;
}
