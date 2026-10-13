/**
 * Test support: sheets shaped like the real Prüfstelle workbook (headers copied from it, long multi-line labels and
 * all), so the importer's tests, the database tests and the e2e import all exercise what the file actually looks like.
 */

export const H2020 = [
  "Laufende Nummer",
  "Datum\r\nPlan-PB /\r\nAbn.-NS",
  "Ausgeübter\r\nTätigkeitsbereich\r\n(ggf. mit Hinweis\r\nauf Tutorium)",
  "Art der Baumaßnahme",
  "EBA-Aktenzeichen",
  "Bf /\r\nStreckenbezeichnung / Nr. /\r\nProjektbezeichnung mit Ort [Ril100]",
  "Zuständige\r\nEBA Außenstelle(n)",
  "Art der Technik gem.\r\nAnhang 1 PRÜF-STE\r\n(Teilgebiet)",
  "Bauform /\r\nBezeichnung der\r\nAnlage",
  "Technik",
  "abgeschlossen",
  "Projektnummer",
  "zuständiger PL",
  "zuständiger FS",
  "Termin",
  "Beschriftung",
  "Link",
] as const;

export const H2018 = ["Prüfnr.", "Bahnhofsname", "Projektname", "Technik", "Fabrikat", "FAA", "VEP/ EP/ AP/ Fertigstellung", "Abgabedat. (yyyymmdd)", "PB vorhanden", "erneute Prüfung erforderlich", "abge schlossen", "AG PL", "AN PL", "PDF Code", "Abschlusstermin", "Planungsbüro", "Planer", "Gesamt-bewertung"] as const;
/** 2019's header annotates the Bahnhof column. */
export const H2019 = H2018.map((h, i) => (i === 1 ? "Bahnhofsname\r\n[Ril100 Kurz]" : h));
export const H2017 = ["Projektnr", "Projektname", "Bahnhofname", "FAA", "VEP/ EP/ AP/ Abnahme", "PB vorhanden", "Abgabe", "Prüfung erforderlich", "Erledigt", "AG PL"] as const;

/** Column positions in a 2020+ row (without the leading empty column some sheets have). */
export const C = { nr: 0, datum: 1, taetigkeit: 2, art: 3, eba: 4, bahnhof: 5, aussenstelle: 6, artTechnik: 7, bauform: 8, technik: 9, ab: 10, projektnummer: 11, pl: 12, fs: 13, termin: 14, beschriftung: 15, link: 16 } as const;

const prefixOf = (t: string | null) => (t === "Gutachten" ? "G" : t === "Stellungnahme" ? "S" : t === "Abnahmeprüfung" || t === "fachtechnische Prüfung vor Ibn" ? "A" : "P");

/** A 2020+ row. `technikArt` goes where the real workbook keeps it (the "Bauform / Bezeichnung der Anlage" column). */
export function row2020(nr: string, over: Partial<Record<keyof typeof C, unknown>> = {}): unknown[] {
  const r: unknown[] = new Array(17).fill(null);
  const v = { nr, datum: 45_000, taetigkeit: "fachtechnische Prüfung EP", art: "Neubau", bahnhof: `Bahnhof ${nr}`, bauform: "WLAN", technik: "Cisco", ab: "Ja", projektnummer: `G.${nr}`, pl: "Uwe Kessmann", fs: "Ravdorf", termin: 45_100, ...over } as Record<string, unknown>;
  for (const [k, i] of Object.entries(C)) if (k in v) r[i] = v[k];
  // the stored PDF-Code the way the workbook's formula writes it, unless the caller sets one
  if (!("beschriftung" in over)) r[C.beschriftung] = `${prefixOf(v.taetigkeit as string | null)}${nr} - ${String(v.bahnhof ?? "")}`;
  return r;
}

/** A 2018/2019 row (header H2018/H2019). Column order as in the sheet; `abgabe` is the yyyymmdd integer the sheets use. */
export function row2018(nr: string, over: { bahnhof?: string; projekt?: string; technik?: string; phase?: string; abgabe?: number | null; pdf?: string | null; plAg?: string | null } = {}): unknown[] {
  const bahnhof = over.bahnhof ?? `Bahnhof ${nr}`;
  const technik = over.technik ?? "ELA";
  const phase = over.phase ?? "Fertigstellung";
  const abgabe = "abgabe" in over ? over.abgabe : 20_180_131;
  return [Number.isFinite(Number(nr)) ? Number(nr) : nr, bahnhof, over.projekt ?? "Projekt", technik, null, null, phase, abgabe, "Ja", "Ja", "Ja", over.plAg ?? "Uwe Kessmann", null, "pdf" in over ? over.pdf : `${abgabe} - ${nr} ${bahnhof} ${technik} ${phase}`, 1, null, null, "3-"];
}
