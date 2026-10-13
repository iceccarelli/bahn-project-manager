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
import { normProjektnummer, normStation } from "../project-identity";

export interface LinkProject {
  id: number;
  projektnummer: string | null;
  station: string | null;
}
export interface LinkSubject {
  projektnummer: string | null;
  bahnhofStrecke: string | null;
}

export type UnmatchedReason = "keine-projektnummer" | "projektnummer-unbekannt" | "station-fehlt" | "station-passt-nicht";

export type LinkVerdict =
  | { status: "unique"; projectId: number }
  | { status: "ambiguous"; candidateIds: number[] }
  | { status: "unmatched"; reason: UnmatchedReason; candidateIds: number[] };

export const UNMATCHED_TEXT: Record<UnmatchedReason, string> = {
  "keine-projektnummer": "Der Prüfbericht hat keine Projektnummer",
  "projektnummer-unbekannt": "Kein Projekt mit dieser Projektnummer",
  "station-fehlt": "Der Prüfbericht nennt keinen Bahnhof",
  "station-passt-nicht": "Kein Projekt mit dieser Projektnummer liegt an diesem Bahnhof",
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
  if (both.length === 1) return { status: "unique", projectId: (both[0] as LinkProject).id };
  if (both.length > 1) return { status: "ambiguous", candidateIds: both.map((p) => p.id) };
  return { status: "unmatched", reason: "station-passt-nicht", candidateIds: ids };
}
