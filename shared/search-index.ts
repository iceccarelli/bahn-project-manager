/**
 * What the search can find.
 *
 * The old suggestion list could return a station, a Projektnummer, a
 * Projektleiter, a BM or a Prüfer name — as bare strings, with no way to tell
 * which was which, and it pressed all of them into the same "search the
 * projects table" action. Ask it for "Karte" and it had nothing; ask it for
 * "BVB" and it had nothing; ask it for "abgelehnt" and it had nothing.
 *
 * Everything a reader can name is an entry here, and every entry knows where it
 * goes. A station opens the station's projects; a Gewerk opens that Gewerk's
 * tab; "Karte" opens the map. The index is built once per data load — not per
 * keystroke — and the counts on it are measured, so "Frankfurt · 84 Projekte"
 * is a fact rather than a label.
 */

import { entry, type SearchEntry } from "./search";
import { DEPARTMENT_LIST, REVIEW_STATUSES } from "./validation";

interface IndexReview {
  department: string;
  status?: string | null;
  prueferName?: string | null;
}

interface IndexProject {
  id: number;
  projektnummer?: string | null;
  station?: string | null;
  bahnhofsmanagement?: string | null;
  bahnhofsnummer?: string | null;
  streckennummer?: string | null;
  projektbeschreibung?: string | null;
  projektstand?: string | null;
  projektleiter?: string | null;
  reviews?: IndexReview[] | null;
}

/** Where a Gewerk lives. Two have a tab of their own; the rest filter Projekte. */
export function gewerkHref(department: string): string {
  if (department === "EEA") return "/bvb-eea";
  if (department === "ITK") return "/psv-itk";
  return `/projects?q=${encodeURIComponent(department)}`;
}

/**
 * The fixed part of the index: every route and every view, with the words a
 * reader actually reaches for.
 *
 * "Karte", "Landkarte", "Map" and "wo" all mean the map. Synonyms live here
 * rather than in the scorer, because a synonym is knowledge about this product,
 * not about string similarity.
 */
export function staticEntries(): SearchEntry[] {
  return [
    entry("seite", "Dashboard", "/", {
      sublabel: "Kennzahlen, Verteilungen und Aktivität",
      terms: ["übersicht start home kennzahlen auswertung statistik"],
    }),
    entry("seite", "Projekte", "/projects", {
      sublabel: "Alle Projekte mit allen 14 Fachprüfungen",
      terms: ["projektliste tabelle alle projekte liste"],
    }),
    entry("seite", "Projekte · Karte", "/projects?view=map", {
      sublabel: "Projekte nach Station auf der Karte",
      terms: ["karte landkarte map standort wo stationen geografisch"],
    }),
    entry("seite", "Projekte · Kacheln", "/projects?view=cards", {
      sublabel: "Projekte als Karten-Kacheln",
      terms: ["kacheln karten cards kachelansicht"],
    }),
    entry("seite", "BVB-EEA Prüfungen", "/bvb-eea", {
      sublabel: "Alle EEA-Prüfungen mit Karte, Filter und Details",
      terms: ["bvb eea elektrische energieanlagen"],
    }),
    entry("seite", "PSV-ITK Prüfungen", "/psv-itk", {
      sublabel: "Alle ITK-Prüfungen mit Karte, Filter und Details",
      terms: ["psv itk telekommunikation informationstechnik"],
    }),
    entry("seite", "Projektanmeldung", "/anmeldung", {
      sublabel: "Neues Projekt anmelden — Checkliste und Termin",
      terms: ["neues projekt anlegen anmeldung checkliste formular termin erfassen"],
    }),
    entry("seite", "Änderungshistorie", "/audit", {
      sublabel: "Wer was wann geändert, erzeugt oder verschickt hat",
      terms: ["historie protokoll audit log änderungen verlauf nachweis"],
    }),
  ];
}

/** Build the whole index from the loaded projects. */
export function buildSearchIndex(projects: readonly IndexProject[] | null | undefined): SearchEntry[] {
  const out: SearchEntry[] = staticEntries();
  if (!projects || projects.length === 0) return out;

  const stations = new Map<string, number>();
  const regions = new Map<string, number>();
  const leiter = new Map<string, number>();
  const pruefer = new Map<string, Map<string, number>>();
  const statuses = new Map<string, number>();
  const gewerke = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string | null | undefined) => {
    const k = (key ?? "").trim();
    if (!k) return;
    map.set(k, (map.get(k) ?? 0) + 1);
  };

  for (const p of projects) {
    bump(stations, p.station);
    bump(regions, p.bahnhofsmanagement);
    bump(leiter, p.projektleiter);

    for (const r of p.reviews ?? []) {
      const name = (r.prueferName ?? "").trim();
      if (name) {
        const seen = pruefer.get(name) ?? new Map<string, number>();
        seen.set(r.department, (seen.get(r.department) ?? 0) + 1);
        pruefer.set(name, seen);
      }
      const status = (r.status ?? "").trim();
      if (status && status !== "nicht erforderlich") {
        bump(statuses, status);
        bump(gewerke, r.department);
      }
    }

    // The project itself. Every identifier it carries is searchable, because a
    // reader pastes whichever one their own document happens to hold — a
    // Strecken-Nr. as readily as a Projektnummer.
    const nummer = (p.projektnummer ?? "").trim();
    const station = (p.station ?? "").trim();
    out.push(
      entry("projekt", nummer || `Projekt ${p.id}`, `/projects?q=${encodeURIComponent(nummer || station)}`, {
        sublabel: [station, p.projektbeschreibung].filter(Boolean).join(" · ") || undefined,
        weight: 1,
        projectId: p.id,
        terms: [
          station,
          p.projektbeschreibung ?? "",
          p.projektleiter ?? "",
          p.bahnhofsmanagement ?? "",
          p.bahnhofsnummer ?? "",
          p.streckennummer ?? "",
          p.projektstand ?? "",
        ].filter(Boolean) as string[],
      }),
    );
  }

  for (const [name, count] of stations) {
    out.push(
      entry("station", name, `/projects?q=${encodeURIComponent(name)}&view=cards`, {
        sublabel: `${count} ${count === 1 ? "Projekt" : "Projekte"}`,
        weight: count,
        terms: ["station bahnhof haltepunkt"],
      }),
    );
  }

  for (const [name, count] of regions) {
    out.push(
      entry("region", name, `/projects?q=${encodeURIComponent(name)}`, {
        sublabel: `Bahnhofsmanagement · ${count} ${count === 1 ? "Projekt" : "Projekte"}`,
        weight: count,
        terms: ["region bahnhofsmanagement bm gebiet"],
      }),
    );
  }

  for (const [name, count] of leiter) {
    out.push(
      entry("person", name, `/projects?q=${encodeURIComponent(name)}`, {
        sublabel: `Projektleitung · ${count} ${count === 1 ? "Projekt" : "Projekte"}`,
        weight: count,
        terms: ["projektleiter projektleitung leitung verantwortlich"],
      }),
    );
  }

  for (const [name, byDept] of pruefer) {
    const total = [...byDept.values()].reduce((a, b) => a + b, 0);
    const departments = [...byDept.keys()].sort();
    // One entry per Prüfer, not per Prüfer-and-Gewerk: a reader searching a
    // name wants the person, and the Gewerke they cover are the context.
    out.push(
      entry("person", name, `/projects?q=${encodeURIComponent(name)}`, {
        sublabel: `${departments.join(", ")} · ${total} ${total === 1 ? "Prüfung" : "Prüfungen"}`,
        weight: total,
        terms: ["prüfer fachspezialist prüfung", ...departments],
      }),
    );
  }

  for (const department of DEPARTMENT_LIST) {
    const count = gewerke.get(department) ?? 0;
    out.push(
      entry("gewerk", department, gewerkHref(department), {
        sublabel: count > 0 ? `${count} ${count === 1 ? "Prüfung" : "Prüfungen"}` : "keine Prüfungen erfasst",
        weight: count,
        terms: ["gewerk fachbereich fachprüfung"],
      }),
    );
  }

  for (const status of REVIEW_STATUSES) {
    const count = statuses.get(status) ?? 0;
    if (count === 0) continue;
    out.push(
      entry("status", status, `/projects?q=${encodeURIComponent(status)}`, {
        sublabel: `${count} ${count === 1 ? "Prüfung" : "Prüfungen"}`,
        weight: count,
        terms: ["status stand zustand"],
      }),
    );
  }

  return out;
}
