/**
 * The search index.
 *
 * What was there before: `apiClient.projects.searchSuggestions` walked all
 * 1,298 projects on every keystroke, collected raw substring matches into a Set
 * and stopped at ten. It matched on `includes` over the untouched string, so
 * "muenchen" found nothing for "München", "langenselbold " with a trailing
 * space found nothing at all, a typo found nothing, and the ten it returned
 * were whichever ten came first in file order rather than the ten that matter.
 * It could not find a Gewerk, a region, a view or a page, and the suggestion it
 * returned was a bare string with no indication of what kind of thing it was.
 *
 * This file is the whole search: a flat, pre-folded index built once from the
 * data, and a scorer that ranks exact over prefix over word-prefix over
 * substring over fuzzy. Everything is synchronous and allocation-light, because
 * it runs on every keystroke over ~3,000 entries and must not be the reason a
 * character appears late.
 *
 * German folding, done twice
 * --------------------------
 * A reader types "Munchen", "Muenchen" or "München" and means the same station.
 * Neither folding alone covers that: expanding ü→ue turns "München" into
 * "muenchen" and loses the "munchen" typist; stripping the umlaut turns it into
 * "munchen" and loses the "muenchen" typist. Both forms are indexed and the
 * query is folded both ways, so all three spellings land on the same station.
 */

export type HitKind =
  | "projekt"
  | "station"
  | "person"
  | "region"
  | "gewerk"
  | "status"
  | "seite";

export interface SearchEntry {
  kind: HitKind;
  /** What the reader sees as the first line. */
  label: string;
  /** Context under it — never a placeholder; absent when there is none. */
  sublabel?: string;
  /** Where choosing this goes. */
  href: string;
  /** How many records stand behind it. Breaks ties towards the busier answer. */
  weight: number;
  /**
   * Whole folded strings — both foldings, deduped. Most entries have no umlaut
   * and collapse to one, which is why deduping here is worth doing: it halves
   * the work of the inner loop for the common case.
   *
   * The first `primaryLen` of these come from the entry's own label; the rest
   * are auxiliary terms. Matching the label is worth more than matching
   * something the entry merely mentions — without that distinction the station
   * "Bensheim" outranked a project whose station happens to be Bensheim by 21
   * points out of 1,077, which is not a margin anyone should rely on.
   */
  haystacks: string[];
  /** How many leading entries of `haystacks` came from the label. */
  primaryLen: number;
  /**
   * Every distinct word from those strings, pre-split.
   *
   * Splitting inside the scorer allocated an array per field per term per
   * entry — roughly 40,000 arrays per keystroke, which is most of where the
   * first version's 25 ms went.
   */
  words: string[];
  /** How many leading entries of `words` came from the label. */
  primaryWordLen: number;
  projectId?: number;
}

export interface SearchHit extends SearchEntry {
  score: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /**
   * A spelling the index does have, when the query as typed found little and
   * this is close. Offered, never applied: silently searching for something
   * other than what was typed is how a search engine loses trust.
   */
  correction: string | null;
  /** Milliseconds the scoring pass took, for the perf assertion. */
  tookMs: number;
}

/** Combining marks left behind by NFD. \p{M} rather than a range: a
 * character class holding combining characters is itself a lint error. */
const DIACRITICS = /\p{M}/gu;
const NON_ALNUM = /[^a-z0-9]+/g;

/** ä→ae, ö→oe, ü→ue, ß→ss. The spelling a German keyboard-less typist uses. */
export function foldExpanded(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(NON_ALNUM, " ")
    .trim();
}

/** ä→a, ö→o, ü→u, ß→ss. The spelling an autocorrect or a phone produces. */
export function foldLoose(input: string): string {
  return input
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(NON_ALNUM, " ")
    .trim();
}

const tokens = (s: string): string[] => (s ? s.split(" ").filter(Boolean) : []);

/**
 * Levenshtein distance, banded and early-exiting.
 *
 * Bounded by `max`: the moment every value in a row exceeds it the strings
 * cannot come back under it, so the rest of the matrix is never computed. Over
 * a 3,000-entry index this is the difference between a search that keeps up
 * with typing and one that does not.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0] as number;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (prev[j] as number) + 1,
        (curr[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length] as number;
}

/** How wrong a word of this length is allowed to be. */
export function toleranceFor(term: string): number {
  if (term.length <= 3) return 0;
  if (term.length <= 6) return 1;
  return 2;
}

/** Kind weighting: what a reader most often means when the text is ambiguous. */
const KIND_BONUS: Record<HitKind, number> = {
  seite: 90,
  gewerk: 70,
  station: 60,
  projekt: 50,
  person: 40,
  region: 30,
  status: 20,
};

/** Matching the entry's own name, rather than something it mentions. */
const LABEL_BONUS = 150;

/** Score one already-folded query term against one entry. Higher is better. */
function scoreTerm(entry: SearchEntry, term: string, tolerance: number): number {
  let best = 0;
  for (let i = 0; i < entry.haystacks.length; i++) {
    const field = entry.haystacks[i] as string;
    const bonus = i < entry.primaryLen ? LABEL_BONUS : 0;
    if (field === term) return 1000 + bonus;
    if (field.startsWith(term)) {
      const excess = field.length - term.length;
      const s = 820 - (excess > 100 ? 100 : excess) + bonus;
      if (s > best) best = s;
    } else if (field.includes(term) && best < 460 + bonus) {
      best = 460 + bonus;
    }
  }
  if (best >= 900 + LABEL_BONUS) return best;

  for (let i = 0; i < entry.words.length; i++) {
    const word = entry.words[i] as string;
    const bonus = i < entry.primaryWordLen ? LABEL_BONUS : 0;
    if (word === term && best < 900 + bonus) best = 900 + bonus;
    else if (word.startsWith(term) && best < 700 + bonus) best = 700 + bonus;
  }
  if (best >= 460 || tolerance === 0) return best;

  // Fuzzy last, and only when nothing better exists: it is the only part of the
  // scorer that is not a string comparison.
  for (const word of entry.words) {
    if (word.length + tolerance < term.length || word.length - tolerance > term.length) continue;
    const d = editDistance(term, word, tolerance);
    if (d <= tolerance) {
      const s = 300 - d * 80;
      if (s > best) best = s;
    }
  }
  return best;
}

export interface SearchOptions {
  limit?: number;
  /** Restrict to these kinds. Absent means everything. */
  kinds?: readonly HitKind[];
}

/**
 * Rank the index against a query.
 *
 * Every term must hit something (AND), because a reader typing two words is
 * narrowing, not widening. The per-term scores are summed so a hit that matches
 * both words beats one that matches either twice.
 */
export function search(
  index: readonly SearchEntry[],
  query: string,
  options: SearchOptions = {},
): SearchResult {
  const started = performance.now();
  const limit = options.limit ?? 12;
  const expanded = tokens(foldExpanded(query));
  const loose = tokens(foldLoose(query));
  const terms = expanded.length > 0 ? expanded : loose;
  if (terms.length === 0) return { hits: [], correction: null, tookMs: 0 };

  const tolerances = terms.map(toleranceFor);
  const kinds = options.kinds;
  const hits: SearchHit[] = [];

  for (const entry of index) {
    if (kinds && !kinds.includes(entry.kind)) continue;
    let total = 0;
    for (let i = 0; i < terms.length; i++) {
      const s = scoreTerm(entry, terms[i] as string, tolerances[i] as number);
      // Every term must hit: two words are a reader narrowing, not widening.
      if (s === 0) {
        total = -1;
        break;
      }
      total += s;
    }
    if (total < 0) continue;
    hits.push({
      ...entry,
      score: total + KIND_BONUS[entry.kind] + Math.min(Math.round(Math.log2(entry.weight + 1) * 6), 40),
    });
  }

  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "de"));

  /*
   * The correction is a second pass, and only when the first one did badly.
   *
   * Computing it inline — an edit distance against every word of every entry
   * that failed to match — cost 25 ms per keystroke on a 3,000-entry index, so
   * the search was slower than the typing it was meant to keep up with. It now
   * runs against the label dictionary only, and only when there is nothing
   * strong to show, which is the one moment a reader wants it.
   */
  const strong = hits.length > 0 && (hits[0] as SearchHit).score >= 700;
  let correction: string | null = null;
  if (!strong) {
    const longest = terms.reduce((a, b) => (b.length > a.length ? b : a), "");
    if (longest.length >= 4) {
      const tolerance = Math.max(1, toleranceFor(longest));
      let bestDistance = tolerance + 1;
      for (const entry of index) {
        if (kinds && !kinds.includes(entry.kind)) continue;
        const candidate = entry.haystacks[0];
        if (!candidate) continue;
        if (Math.abs(candidate.length - longest.length) > tolerance) continue;
        const d = editDistance(longest, candidate, tolerance);
        if (d > 0 && d < bestDistance) {
          bestDistance = d;
          correction = entry.label;
        }
      }
    }
  }

  return { hits: hits.slice(0, limit), correction, tookMs: performance.now() - started };
}

/** Group hits in the order the palette renders them, preserving rank inside. */
export function groupHits(hits: readonly SearchHit[]): Array<{ kind: HitKind; hits: SearchHit[] }> {
  const order: HitKind[] = ["seite", "gewerk", "station", "projekt", "person", "region", "status"];
  const out: Array<{ kind: HitKind; hits: SearchHit[] }> = [];
  for (const kind of order) {
    const group = hits.filter((h) => h.kind === kind);
    if (group.length > 0) out.push({ kind, hits: group });
  }
  return out;
}

export const KIND_LABEL: Record<HitKind, string> = {
  seite: "Seiten & Ansichten",
  gewerk: "Gewerke",
  station: "Stationen",
  projekt: "Projekte",
  person: "Personen",
  region: "Bahnhofsmanagement",
  status: "Status",
};

/** Build one entry, folding the label together with any extra search terms. */
export function entry(
  kind: HitKind,
  label: string,
  href: string,
  opts: { sublabel?: string; weight?: number; terms?: readonly string[]; projectId?: number } = {},
): SearchEntry {
  const haystacks: string[] = [];
  const words: string[] = [];
  const absorb = (source: string) => {
    for (const folded of [foldExpanded(source), foldLoose(source)]) {
      if (!folded || haystacks.includes(folded)) continue;
      haystacks.push(folded);
      for (const word of tokens(folded)) if (!words.includes(word)) words.push(word);
    }
  };
  // Label first, so everything it contributes occupies the leading slots and
  // the scorer can tell a name from a mention by index alone.
  absorb(label);
  const primaryLen = haystacks.length;
  const primaryWordLen = words.length;
  for (const term of opts.terms ?? []) if (term) absorb(term);

  return {
    kind,
    label,
    sublabel: opts.sublabel,
    href,
    weight: opts.weight ?? 1,
    projectId: opts.projectId,
    haystacks,
    primaryLen,
    words,
    primaryWordLen,
  };
}

/**
 * Suggestions for a filter box, as plain terms.
 *
 * A page search filters the table it sits above — it must not offer to navigate
 * somewhere else, so pages and views are excluded and only the vocabularies
 * that narrow a result set are returned. Deduped by label, because a station
 * and a project can carry the same words and offering the same word twice makes
 * the list look broken.
 */
export function suggestTerms(
  index: readonly SearchEntry[],
  query: string,
  limit = 8,
): Array<{ label: string; kind: HitKind; sublabel?: string }> {
  const { hits } = search(index, query, {
    limit: limit * 3,
    kinds: ["station", "person", "region", "status", "projekt", "gewerk"],
  });
  const seen = new Set<string>();
  const out: Array<{ label: string; kind: HitKind; sublabel?: string }> = [];
  for (const hit of hits) {
    const key = hit.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: hit.label, kind: hit.kind, sublabel: hit.sublabel });
    if (out.length >= limit) break;
  }
  return out;
}
