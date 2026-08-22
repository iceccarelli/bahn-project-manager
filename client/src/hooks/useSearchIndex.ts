import { useMemo } from "react";
import { useAllData } from "@/hooks/useDataQuery";
import { buildSearchIndex } from "@shared/search-index";
import type { SearchEntry } from "@shared/search";

const EMPTY: SearchEntry[] = [];

/**
 * The index, built once and shared.
 *
 * Two problems this solves, both measured rather than guessed:
 *
 * 1. Building it costs a few hundred milliseconds of main thread. The header
 *    search is on every route, so building at mount put that cost on every
 *    navigation — including /anmeldung, where the wizard's step buttons were
 *    still moving when the harness tried to click one. Nothing needs the index
 *    until somebody actually searches, so nothing builds it until then.
 *
 * 2. The header palette and each page's filter box would otherwise build their
 *    own copy of the same 3,000 entries. The cache is keyed on the projects
 *    array itself — a WeakMap, so a superseded array is collected with its
 *    index rather than held alive by a string key nobody clears.
 */
const CACHE = new WeakMap<object, SearchEntry[]>();

export function useSearchIndex(enabled: boolean): SearchEntry[] {
  const { data } = useAllData();
  const projects = data?.projects;
  return useMemo(() => {
    if (!enabled || !projects) return EMPTY;
    const cached = CACHE.get(projects);
    if (cached) return cached;
    const built = buildSearchIndex(projects);
    CACHE.set(projects, built);
    return built;
  }, [enabled, projects]);
}
