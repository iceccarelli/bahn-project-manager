/**
 * Which project does an ITK Prüfbericht belong to? — the evidence rule, in one pure function used by the server (link
 * candidates, automatic linking), by the inspector CLI (projection before anything is written) and by the tests.
 *
 * The two workbooks share no identifier. What they share is the Projektnummer — which is NOT unique (a framework number
 * is carried by dozens of stations) — and a station name spelled differently in each. So:
 *
 *   unique     exactly one project has the same Projektnummer AND the same station (normalised: case, accents,
 *              punctuation, bracketed qualifiers, Hbf) → may be linked automatically
 *   ambiguous  more than one project has both → a person picks; nothing is guessed (one station can carry several
 *              registrations of the same job: AP, EP, …)
 *   unmatched  no Projektnummer on the report / no project with it / its station is absent or different. The projects
 *              that carry the Projektnummer are still returned as `candidateIds`, to be chosen from by a person — they
 *              are suggestions, never a link.
 *
 * Station-only matches do not exist: a station name is not an identifier of a project.
 */
import { normProjektnummer, normStation, normText } from "../project-identity";

export interface LinkProject {
  id: number;
  projektnummer: string | null;
  station: string | null;
  /** the project's phase (AP, EP, VEP, …) */
  projektstand?: string | null;
}
export interface LinkSubject {
  projektnummer: string | null;
  bahnhofStrecke: string | null;
  /** "fachtechnische Prüfung EP" … (2020+ sheets) */
  taetigkeitsbereich?: string | null;
  /** the legacy sheets' "VEP/EP/AP/Fertigstellung" column */
  phase?: string | null;
}

export type UnmatchedReason = "keine-projektnummer" | "projektnummer-unbekannt" | "station-fehlt" | "station-passt-nicht" | "phase-passt-nicht";

export type Phase = "VEP" | "EP" | "AP";
const PHASES: readonly Phase[] = ["VEP", "EP", "AP"];

/**
 * The phase a report states about itself: "fachtechnische Prüfung EP" (Tätigkeitsbereich) or the legacy sheets' phase column.
 * Only VEP / EP / AP count — "Abnahmeprüfung", "Gutachten", "Stellungnahme", "Fertigstellung" say nothing about a phase, and
 * silence is not evidence.
 */
export function reportPhase(s: Pick<LinkSubject, "taetigkeitsbereich" | "phase">): Phase | null {
  const fromTaetigkeit = /\b(VEP|EP|AP)\s*$/i.exec((s.taetigkeitsbereich ?? "").trim())?.[1]?.toUpperCase();
  const candidate = fromTaetigkeit ?? (s.phase ?? "").trim().toUpperCase();
  return (PHASES as readonly string[]).includes(candidate) ? (candidate as Phase) : null;
}
/** A project's phase if it is exactly one of the three; "EP/AP", "Mieterumbau …", "FA" and blanks are not a phase a report can be held against. */
export const projectPhase = (p: Pick<LinkProject, "projektstand">): Phase | null => {
  const t = normText(p.projektstand).toUpperCase();
  return (PHASES as readonly string[]).includes(t) ? (t as Phase) : null;
};

export type LinkVerdict =
  | { status: "unique"; projectId: number; /** true when the report's stated phase decided between several projects at the station */ byPhase: boolean }
  | { status: "ambiguous"; candidateIds: number[] }
  | { status: "unmatched"; reason: UnmatchedReason; candidateIds: number[] };

export const UNMATCHED_TEXT: Record<UnmatchedReason, string> = {
  "keine-projektnummer": "Der Prüfbericht hat keine Projektnummer",
  "projektnummer-unbekannt": "Kein Projekt mit dieser Projektnummer",
  "station-fehlt": "Der Prüfbericht nennt keinen Bahnhof",
  "station-passt-nicht": "Kein Projekt mit dieser Projektnummer liegt an diesem Bahnhof",
  "phase-passt-nicht": "Der Prüfbericht betrifft eine andere Phase als das Projekt (AP, EP und VEP sind verschiedene Anmeldungen)",
};

/** Index once, match many: the server matches a few hundred reports against all projects. */
export function indexProjects(projects: readonly LinkProject[]): Map<string, LinkProject[]> {
  const byPn = new Map<string, LinkProject[]>();
  for (const p of projects) {
    const k = normProjektnummer(p.projektnummer);
    if (!k) continue;
    const l = byPn.get(k);
    if (l) l.push(p);
    else byPn.set(k, [p]);
  }
  return byPn;
}

export function matchPruefbericht(subject: LinkSubject, byPn: ReadonlyMap<string, readonly LinkProject[]>): LinkVerdict {
  const pn = normProjektnummer(subject.projektnummer);
  if (!pn) return { status: "unmatched", reason: "keine-projektnummer", candidateIds: [] };
  const sameNumber = byPn.get(pn) ?? [];
  if (sameNumber.length === 0) return { status: "unmatched", reason: "projektnummer-unbekannt", candidateIds: [] };
  const ids = sameNumber.map((p) => p.id);
  const station = normStation(subject.bahnhofStrecke);
  if (!station) return { status: "unmatched", reason: "station-fehlt", candidateIds: ids };
  const both = sameNumber.filter((p) => normStation(p.station) === station);
  if (both.length === 0) return { status: "unmatched", reason: "station-passt-nicht", candidateIds: ids };

  // A phase is a registration of its own. When the report states its phase, it belongs to the project of THAT phase — and is
  // never linked to a project of another one. A report that states none (Abnahmeprüfung, Gutachten …) is not narrowed.
  const phase = reportPhase(subject);
  if (phase) {
    const samePhase = both.filter((p) => projectPhase(p) === phase);
    const otherPhase = both.filter((p) => { const pp = projectPhase(p); return pp !== null && pp !== phase; });
    if (samePhase.length === 1) return { status: "unique", projectId: (samePhase[0] as LinkProject).id, byPhase: both.length > 1 };
    if (samePhase.length > 1) return { status: "ambiguous", candidateIds: samePhase.map((p) => p.id) };
    // no project of the stated phase: projects of another phase are NOT a match (suggestions only)
    if (otherPhase.length === both.length) return { status: "unmatched", reason: "phase-passt-nicht", candidateIds: both.map((p) => p.id) };
    // a mix of projects of other phases and projects whose stand is no single phase ("EP/AP", "FA", blank): only the latter can still be it
    const open = both.filter((p) => projectPhase(p) === null);
    if (open.length === 1) return { status: "unique", projectId: (open[0] as LinkProject).id, byPhase: both.length > 1 };
    return { status: "ambiguous", candidateIds: open.map((p) => p.id) };
  }
  if (both.length === 1) return { status: "unique", projectId: (both[0] as LinkProject).id, byPhase: false };
  return { status: "ambiguous", candidateIds: both.map((p) => p.id) };
}

/** The recommended policy for what the evidence rule cannot decide — shown in the Projektübersicht ITK and quoted by docs/project-register-import.md. */
export const LINK_POLICY = {
  noProjektnummer:
    "Ohne Projektnummer ist kein Prüfbericht sicher einem Projekt zuzuordnen. Empfehlung: die Projektnummer in der Arbeitsmappe der Prüfstelle ergänzen und neu importieren; bis dahin einzeln von Hand zuordnen.",
  ambiguous:
    "Mehrere Projekte tragen dieselbe Projektnummer am selben Bahnhof. Nennt der Prüfbericht seine Phase (fachtechnische Prüfung EP/AP/VEP), wird er dem Projekt dieser Phase zugeordnet; sonst bitte das Projekt wählen, das er betrifft. Die Wahl bleibt bei einem erneuten Import der Arbeitsmappe erhalten.",
  phase:
    "AP, EP und VEP sind verschiedene Phasen und damit verschiedene Anmeldungen. Ein Prüfbericht, der seine Phase nennt, wird nie einem Projekt einer anderen Phase zugeordnet — auch nicht, wenn es das einzige Projekt an diesem Bahnhof ist.",
} as const;

/**
 * Order the open reports offered to ONE project: the ones whose station and phase fit it come first (a framework number is
 * shared by dozens of stations, so the report for this station must not drown in the rest). Pure ordering — nothing is hidden or linked.
 */
export function rankOffers<R extends Pick<LinkSubject, "taetigkeitsbereich" | "phase"> & { bahnhofStrecke: string | null; year: number; laufendeNummer: string }>(
  reports: readonly R[], project: { station: string | null; projektstand: string | null },
): Array<{ report: R; fit: "station+phase" | "station" | "other" }> {
  const st = normStation(project.station);
  const pp = projectPhase({ projektstand: project.projektstand });
  const score = (r: R): "station+phase" | "station" | "other" => {
    const rs = normStation(r.bahnhofStrecke);
    const stationOk = st !== "" && rs !== "" && (rs === st || rs.includes(st) || st.includes(rs));
    if (!stationOk) return "other";
    const rp = reportPhase(r);
    return rp === null || pp === null || rp === pp ? "station+phase" : "station";
  };
  const rank = { "station+phase": 0, station: 1, other: 2 } as const;
  return reports.map((report) => ({ report, fit: score(report) }))
    .sort((a, b) => rank[a.fit] - rank[b.fit] || b.report.year - a.report.year || a.report.laufendeNummer.localeCompare(b.report.laufendeNummer, "de", { numeric: true }));
}
