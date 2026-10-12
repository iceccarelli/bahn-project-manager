import { stateOf } from "./summary";
import type { AbnahmeAnswers, ChecklistItem, ChecklistSection, ChecklistTemplate } from "./types";

export const ABNAHME_FILTERS = ["alle", "offen", "nicht-bewertet", "erfuellt", "entfaellt"] as const;
export type AbnahmeFilter = (typeof ABNAHME_FILTERS)[number];

export function isAbnahmeFilter(value: unknown): value is AbnahmeFilter {
  return typeof value === "string" && (ABNAHME_FILTERS as readonly string[]).includes(value);
}

/** Lower-cased and de-accented, so "pruefkriterien" finds "Prüfkriterien". */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/\p{M}/gu, "");
}

function matchesFilter(filter: AbnahmeFilter, selected: ReturnType<typeof stateOf>["selected"]): boolean {
  switch (filter) {
    case "alle": return true;
    case "offen": return selected === "Offen";
    case "erfuellt": return selected === "Erfüllt";
    case "entfaellt": return selected === "Entfällt";
    case "nicht-bewertet": return selected === null;
  }
}

export interface FilteredSection {
  section: ChecklistSection;
  items: readonly ChecklistItem[];
}

/**
 * Sections reduced to the items matching `query` (id, label or Mangel text;
 * every whitespace-separated term must match) and `filter`. Sections with no
 * remaining item are dropped, so an empty result is an empty array.
 */
export function filterTemplate(
  template: ChecklistTemplate,
  answers: AbnahmeAnswers,
  query: string,
  filter: AbnahmeFilter,
): FilteredSection[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const out: FilteredSection[] = [];
  for (const section of template.sections) {
    const items = section.items.filter((item) => {
      const s = stateOf(answers, item.id);
      if (!matchesFilter(filter, s.selected)) return false;
      if (terms.length === 0) return true;
      const haystack = fold(`${item.id} ${item.label} ${s.mangel} ${section.number} ${section.title}`);
      return terms.every((t) => haystack.includes(t));
    });
    if (items.length > 0) out.push({ section, items });
  }
  return out;
}
