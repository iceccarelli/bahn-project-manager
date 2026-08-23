/**
 * The questions an answer leads to.
 *
 * ---------------------------------------------------------------------------
 * Why the phrasing here is not free text
 * ---------------------------------------------------------------------------
 * A follow-up chip is a promise: the reader clicks it because they expect an
 * answer. If the sentence on the chip scores against the wrong skill — or
 * against none — the click produces "das habe ich nicht verstanden", and one
 * of those teaches a reader that the whole panel is decorative.
 *
 * So every question the assistant offers itself is written once, here, in a
 * phrasing chosen to carry at least two keywords of its target skill and none
 * of any other. `ask()` is the arbiter, not this file's good intentions:
 * tests/agent-follow-ups.test.ts sends every offered follow-up back through the
 * resolver and fails if it does not come back with the intended intent and
 * `confidence: "measured"`. That is what keeps a chip from ever being a dead
 * end, including the chips built from live data — a Gewerk name, a station.
 */

import { recipientsFor } from "../contacts";
import type { AgentFollowUp } from "./types";

/**
 * The fixed questions, one per skill that needs no entity.
 *
 * Keyed by skill id so a reader can check the mapping against skills.ts at a
 * glance, and so the test can iterate the pairs rather than trusting a comment.
 */
export const ASK = {
  "most-critical": { label: "Was ist gerade kritisch?", question: "Was ist gerade kritisch?" },
  overdue: { label: "Was ist überfällig?", question: "Was ist überfällig?" },
  blocked: { label: "Was ist blockiert?", question: "Welche Prüfungen sind blockiert?" },
  unassigned: { label: "Was hat keinen Prüfer?", question: "Welche Prüfungen haben keinen Prüfer?" },
  workload: { label: "Wer trägt die meiste Last?", question: "Wer hat die meiste offene Last?" },
  aging: { label: "Wie alt ist der Rückstand?", question: "Wie alt sind die offenen Prüfungen?" },
  portfolio: { label: "Wie steht das Portfolio?", question: "Wie steht das Portfolio insgesamt?" },
  "data-quality": {
    label: "Wie verlässlich sind die Zahlen?",
    question: "Wie verlässlich sind die Zahlen?",
  },
  "recent-changes": { label: "Was hat sich geändert?", question: "Was hat sich geändert?" },
  navigate: { label: "Wohin kann ich springen?", question: "Öffne die Übersicht" },
} as const satisfies Record<string, AgentFollowUp>;

/** The skill each fixed question is written to reach. Pinned by the test. */
export const ASK_INTENT: Readonly<Record<keyof typeof ASK, string>> = {
  "most-critical": "most-critical",
  overdue: "overdue",
  blocked: "blocked",
  unassigned: "unassigned",
  workload: "workload",
  aging: "aging",
  portfolio: "portfolio",
  "data-quality": "data-quality",
  "recent-changes": "recent-changes",
  navigate: "navigate",
};

/*
 * The entity questions carry two keywords on purpose.
 *
 * "Wie steht EEA?" resolves today, but it wins by 90 to nothing — and a Gewerk
 * or station name is data, so tomorrow it may contain a word that belongs to
 * another skill. Naming the kind of thing as well as the thing ("das Gewerk
 * EEA", "an der Station Kassel-Wilhelmshöhe") doubles the score of the intended
 * skill and makes the margin structural rather than lucky.
 */

/** "How does this Gewerk stand" — reaches `gewerk-status`. */
export function gewerkAsk(department: string): AgentFollowUp {
  const q = `Wie steht das Gewerk ${department}?`;
  return { label: q, question: q };
}

/**
 * "Who is responsible" — reaches `contact`, but only when there is somebody to
 * name. For a Gewerk with no address in the Hilfsdatei the answer is an honest
 * dead end, and a dead end is not a suggestion. LST is exactly this case.
 */
export function contactAsk(department: string): AgentFollowUp | null {
  if (recipientsFor(department as never).length === 0) return null;
  const q = `Wer ist der Ansprechpartner für ${department}?`;
  return { label: q, question: q };
}

/** "What is happening here" — reaches `station`. */
export function stationAsk(station: string): AgentFollowUp | null {
  const name = station.trim();
  if (!name) return null;
  const q = `Was läuft an der Station ${name}?`;
  return { label: q, question: q };
}

/** How many chips fit under an answer before they stop being a shortcut. */
export const MAX_FOLLOW_UPS = 4;

/**
 * Assemble the chips: drop what did not apply, drop repeats, cap the row.
 *
 * Callers pass more candidates than fit, most specific first — a question built
 * from this answer's own worst Gewerk beats a generic one — and the cap decides.
 * The generic tail at the end of every call is what guarantees a non-empty row
 * even when nothing specific applied.
 */
export function followUps(
  ...candidates: Array<AgentFollowUp | null | undefined | false>
): AgentFollowUp[] {
  const out: AgentFollowUp[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = candidate.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length === MAX_FOLLOW_UPS) break;
  }
  return out;
}
