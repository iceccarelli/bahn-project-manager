import { percent } from "../project-metrics";
import type { AbnahmeAnswers, ChecklistSection, ChecklistTemplate, ItemState } from "./types";

const NOT_RATED: ItemState = { selected: null, mangel: "" };

export function stateOf(answers: AbnahmeAnswers, itemId: string): ItemState {
  return answers[itemId] ?? NOT_RATED;
}

export interface AbnahmeSummary {
  total: number;
  erfuellt: number;
  offen: number;
  entfaellt: number;
  nichtBewertet: number;
  /**
   * Offen without a Mangelbeschreibung. The source checklists carry no severity,
   * so "kritisch" is not invented; what can be said truthfully is which open
   * points are still undocumented and therefore cannot be handed to the Errichter.
   */
  offenOhneMangel: number;
  /** Whole percent of items that have an answer (Erfüllt, Offen or Entfällt). */
  fortschritt: number;
}

export function summarizeItems(
  items: readonly { id: string }[],
  answers: AbnahmeAnswers,
): AbnahmeSummary {
  let erfuellt = 0;
  let offen = 0;
  let entfaellt = 0;
  let offenOhneMangel = 0;
  for (const { id } of items) {
    const s = stateOf(answers, id);
    if (s.selected === "Erfüllt") erfuellt++;
    else if (s.selected === "Entfällt") entfaellt++;
    else if (s.selected === "Offen") {
      offen++;
      if (s.mangel.trim() === "") offenOhneMangel++;
    }
  }
  const total = items.length;
  const bewertet = erfuellt + offen + entfaellt;
  return {
    total,
    erfuellt,
    offen,
    entfaellt,
    nichtBewertet: total - bewertet,
    offenOhneMangel,
    fortschritt: percent(bewertet, total),
  };
}

export function summarizeSection(section: ChecklistSection, answers: AbnahmeAnswers): AbnahmeSummary {
  return summarizeItems(section.items, answers);
}

export function summarizeTemplate(template: ChecklistTemplate, answers: AbnahmeAnswers): AbnahmeSummary {
  return summarizeItems(template.sections.flatMap((s) => s.items), answers);
}

export interface Mangel {
  /** 1-based, derived from order — never stored, so it cannot go stale when an item changes. */
  nr: number;
  itemId: string;
  reference: string;
  beschreibung: string;
}

/** The Mängelliste of the prototype, derived instead of maintained. */
export function deriveMaengel(template: ChecklistTemplate, answers: AbnahmeAnswers): Mangel[] {
  const out: Mangel[] = [];
  for (const section of template.sections) {
    for (const item of section.items) {
      const s = stateOf(answers, item.id);
      if (s.selected === "Offen") {
        out.push({ nr: out.length + 1, itemId: item.id, reference: `${item.id} – ${item.label}`, beschreibung: s.mangel.trim() });
      }
    }
  }
  return out;
}
