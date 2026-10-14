/**
 * Synthetic fixtures (Prüfbericht workbook) that reproduce edge cases measured on the real file — shapes, not data: Technik
 * values outside the list ("ZIM ELA", "ZIM/ElA", "Rückbau") · the 2018 / 2019 / 2022 PDF-Code formulas and a stored code that
 * deviates · reports without a Projektnummer · a number no project carries · a station that differs · a duplicated running
 * number. Knows nothing of the Übersichtsliste: the framework number the reports name is a parameter.
 */
import type { SheetInput } from "../workbook-cells";
import { H2018, H2019, H2020, row2018, row2020 } from "./testing";

/** Sheets that name `framework` (a Projektnummer carried by several projects) — and some reports that cannot be linked. */
export function edgeCaseReportSheets(framework: string): SheetInput[] {
  const t18 = { name: "2018", rows: [[...H2018], row2018("814", { bahnhof: "Betzdorf(Sieg)", abgabe: 20_180_205, pdf: "20180131-814 Betzdorf(Sieg) ELA Fertigstellung" })] };
  const t19 = { name: "2019", rows: [[...H2019], row2018("901", { bahnhof: "Beispieldorf", technik: "Video", phase: "EP", abgabe: 20_190_731 })] };
  const y22 = {
    name: "2022",
    rows: [[...H2020],
      // the stored code swaps the A/P prefix of the formula (the real 2022 sheet does this in places)
      row2020("22.001", { projektnummer: framework, bahnhof: "Beispieldorf", taetigkeit: "fachtechnische Prüfung EP", beschriftung: "A22.001 - Beispieldorf" }),
    ],
  };
  // "Abnahmeprüfung" states no phase (silence is not evidence); "fachtechnische Prüfung EP/AP" does.
  const NO_PHASE = "Abnahmeprüfung";
  const y25 = {
    name: "2025",
    rows: [[...H2020],
      row2020("25.001", { projektnummer: framework, bahnhof: "Musterstadt Marktplatz", bauform: "ELA AN1", taetigkeit: NO_PHASE }),   // unique (qualifier spelled differently)
      row2020("25.002", { projektnummer: framework, bahnhof: "Testhausen Hauptbahnhof", bauform: "Video", taetigkeit: NO_PHASE }),   // unique (Hbf ↔ Hauptbahnhof)
      row2020("25.003", { projektnummer: framework, bahnhof: "Alpha", bauform: "ZIM", taetigkeit: NO_PHASE }),                       // ambiguous: AP and EP project, no phase stated
      row2020("25.004", { projektnummer: framework, bahnhof: "Ganz woanders", bauform: "ZIM" }),                                     // number known, station differs
      row2020("25.005", { projektnummer: null, bahnhof: "Beta", bauform: "ZIM" }),                                                   // no Projektnummer
      row2020("25.006", { projektnummer: null, bahnhof: "Gamma", bauform: "ZIM ELA" }),                                              // odd Technik, no number
      row2020("25.007", { projektnummer: "G.NIEMAND", bahnhof: "Alpha", bauform: "ZIM/ElA" }),                                       // a number no project carries
      row2020("25.008", { projektnummer: framework, bahnhof: "Delta", bauform: "Rückbau", taetigkeit: NO_PHASE }),                   // odd Technik, unique
      row2020("25.009", { projektnummer: framework, bahnhof: "Alpha", bauform: "Video", taetigkeit: "fachtechnische Prüfung EP" }),  // states EP → the EP project of the two
      row2020("25.010", { projektnummer: null, bahnhof: "Dublette 1" }),
      row2020("25.010", { projektnummer: null, bahnhof: "Dublette 2" }),                                                             // duplicated running number → 25.010/2
      row2020("25.011", { projektnummer: framework, bahnhof: "Alpha", bauform: "ZIM", taetigkeit: "fachtechnische Prüfung AP" }),    // states AP → the AP project
      row2020("25.012", { projektnummer: framework, bahnhof: "Gamma", bauform: "ZIM", taetigkeit: "fachtechnische Prüfung EP" }),    // states EP, but the only project at Gamma is AP → NOT linked
    ],
  };
  return [t18, t19, y22, y25];
}
