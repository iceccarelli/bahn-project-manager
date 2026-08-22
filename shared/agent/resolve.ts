/**
 * From a sentence to a skill.
 *
 * No model, no embedding, no cloud round trip: German folding (the same two
 * foldings the search uses), keyword scoring, and entity extraction against the
 * data actually loaded. It is small enough to read in one sitting, which is the
 * point — every answer this assistant gives can be traced to a rule someone can
 * look at.
 *
 * Entities are pulled from the real vocabularies rather than guessed: a Gewerk
 * has to be one of the fourteen, a station has to be a station that exists, a
 * Projektnummer has to be a Projektnummer on file. That is what stops "Wie
 * steht EAA?" inventing a department, and it is also why a typo still lands —
 * the same fuzzy matching the palette uses is available here.
 */

import { editDistance, foldExpanded, foldLoose, toleranceFor } from "../search";
import { DEPARTMENT_LIST } from "../validation";
import { helpAnswer, SKILLS, type AgentEntities, type Skill } from "./skills";
import type { AgentAnswer, AgentContext } from "./types";

/** Words that carry no intent and would otherwise pull every skill up. */
const STOPWORDS = new Set([
  "der","die","das","den","dem","des","ein","eine","einer","eines","und","oder",
  "ist","sind","war","waren","wie","was","wer","wo","wann","warum","welche",
  "welches","welcher","mir","mich","ich","wir","uns","sie","es","auf","in","im",
  "an","am","zu","zum","zur","fur","für","von","vom","mit","bei","aus","hat",
  "haben","bitte","mal","denn","noch","schon","gibt","viele","viel",
]);

const words = (s: string) => s.split(" ").filter(Boolean);

/** Best fuzzy match of `term` against a vocabulary, or null. */
function closest(term: string, vocabulary: readonly string[]): string | null {
  const t = foldExpanded(term);
  if (!t) return null;
  let best: { value: string; distance: number } | null = null;
  for (const candidate of vocabulary) {
    for (const folded of [foldExpanded(candidate), foldLoose(candidate)]) {
      if (!folded) continue;
      if (folded === t) return candidate;
      const tolerance = toleranceFor(t);
      if (tolerance === 0) continue;
      if (Math.abs(folded.length - t.length) > tolerance) continue;
      const d = editDistance(t, folded, tolerance);
      if (d <= tolerance && (!best || d < best.distance)) best = { value: candidate, distance: d };
    }
  }
  return best ? best.value : null;
}

const PROJEKTNUMMER = /\b[gG][.\s]?\d[\d.\s]{4,}\b/;

/** Everything the question names that the data also knows about. */
export function extractEntities(question: string, ctx: AgentContext): AgentEntities {
  const out: AgentEntities = {};
  const folded = foldExpanded(question);
  const tokens = words(folded).filter((w) => !STOPWORDS.has(w));

  // Gewerk: exact or near-miss against the fourteen.
  for (const token of tokens) {
    const hit = closest(token, DEPARTMENT_LIST as readonly string[]);
    if (hit) {
      out.department = hit;
      break;
    }
  }

  // Projektnummer: the shape is distinctive enough to lift out of the sentence.
  const nummer = question.match(PROJEKTNUMMER);
  if (nummer) out.projektnummer = nummer[0].trim();

  // Station and region: only names that exist in the loaded data.
  const stations = new Set<string>();
  const regions = new Set<string>();
  const people = new Set<string>();
  for (const p of ctx.projects) {
    const s = (p.station ?? "").trim();
    if (s) stations.add(s);
    const r = (p.bahnhofsmanagement ?? "").trim();
    if (r) regions.add(r);
    const l = (p.projektleiter ?? "").trim();
    if (l) people.add(l);
    for (const review of p.reviews ?? []) {
      const n = (review.prueferName ?? "").trim();
      if (n) people.add(n);
    }
  }

  // Longest match first: "Frankfurt (Main) Süd" must win over "Frankfurt".
  const byLength = (a: string, b: string) => b.length - a.length;
  for (const station of [...stations].sort(byLength)) {
    const f = foldExpanded(station);
    if (f && folded.includes(f)) {
      out.station = station;
      break;
    }
  }
  if (!out.station) {
    for (const token of tokens) {
      const hit = closest(token, [...stations]);
      if (hit) {
        out.station = hit;
        break;
      }
    }
  }
  for (const region of [...regions].sort(byLength)) {
    const f = foldExpanded(region);
    if (f && folded.includes(f)) {
      out.region = region;
      break;
    }
  }
  for (const person of [...people].sort(byLength)) {
    const f = foldExpanded(person);
    if (f && f.length > 3 && folded.includes(f)) {
      out.person = person;
      break;
    }
  }
  return out;
}

export interface Ranked {
  skill: Skill;
  score: number;
}

/** Score every skill against the question. Exported so a test can pin it. */
export function rankSkills(question: string, entities: AgentEntities): Ranked[] {
  const folded = foldExpanded(question);
  /*
   * Word boundaries, not raw substrings.
   *
   * `folded.includes(keyword)` matched "in" inside "sind" and "wo" inside
   * "wollen", so a question about data quality scored as a question about a
   * station. Padding both sides turns every comparison into a whole-word or
   * whole-phrase one, which is what a keyword was always meant to be.
   */
  const padded = ` ${folded} `;
  const ranked: Ranked[] = [];
  for (const skill of SKILLS) {
    // A skill that needs an entity it did not get is not a candidate at all.
    if (skill.needs && entities[skill.needs] === undefined) continue;
    let score = 0;
    for (const keyword of skill.keywords) {
      const k = foldExpanded(keyword);
      if (!k) continue;
      if (folded === k) score += skill.weight * 2;
      else if (padded.includes(` ${k} `)) score += skill.weight;
    }
    // Having the entity a skill wants is itself evidence it is the right skill.
    if (skill.needs && entities[skill.needs] !== undefined) score += skill.weight / 2;
    if (score > 0) ranked.push({ skill, score });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

/**
 * Answer a question from the loaded data.
 *
 * Deterministic: the same question over the same data returns the same answer,
 * every time, which is what makes an answer about a delivery schedule worth
 * anything.
 */
export function ask(question: string, ctx: AgentContext): AgentAnswer {
  const trimmed = question.trim();
  if (!trimmed) return helpAnswer();

  const entities = extractEntities(trimmed, ctx);
  const ranked = rankSkills(trimmed, entities);

  // A named Gewerk, station or Projektnummer with no matching keyword is still
  // a question — "EEA" alone means "how does EEA stand".
  if (ranked.length === 0) {
    if (entities.projektnummer) return SKILLS[1]?.run(ctx, entities) ?? helpAnswer();
    const fallback = entities.department
      ? SKILLS.find((s) => s.id === "gewerk-status")
      : entities.station
        ? SKILLS.find((s) => s.id === "station")
        : null;
    if (fallback) return fallback.run(ctx, entities);
    return helpAnswer();
  }

  return (ranked[0] as Ranked).skill.run(ctx, entities);
}

/** The prompts the widget offers before anyone has typed anything. */
export const STARTERS: ReadonlyArray<{ label: string; question: string }> = [
  { label: "Was ist gerade kritisch?", question: "Was ist gerade kritisch?" },
  { label: "Was ist überfällig?", question: "Was ist überfällig?" },
  { label: "Wer hat die meiste Last?", question: "Wer hat die meiste offene Last?" },
  { label: "Wie steht das Portfolio?", question: "Wie steht das Portfolio insgesamt?" },
  { label: "Was hat sich geändert?", question: "Was hat sich geändert?" },
  { label: "Wie verlässlich sind die Zahlen?", question: "Wie verlässlich sind die Zahlen?" },
];
