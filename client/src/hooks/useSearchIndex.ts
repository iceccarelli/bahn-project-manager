import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAllData } from "@/hooks/useDataQuery";
import { buildSearchIndex, staticEntries } from "@shared/search-index";
import { entry, type SearchEntry } from "@shared/search";
import type { SearchWireResult } from "@shared/search-contract";
import { SERVER_MODE, serverApi } from "@/realtime/serverApi";

const EMPTY: SearchEntry[] = [];

/**
 * The searchable entries behind the command palette and the filter boxes.
 *
 *   server build: fixed pages/Gewerke (shared) + candidates the SERVER computes for the caller's authorization scope
 *                 for the typed term (`search.query`, debounced, bounded). No dataset ever reaches the browser.
 *   demo build:   built once from the browser-local rows (the only data a static deployment has).
 *
 * Both hooks exist in every artifact's source, but SERVER_MODE is a build-time constant, so exactly one runs.
 */
const CACHE = new WeakMap<object, SearchEntry[]>();

function useLocalSearchIndex(enabled: boolean, _query: string): SearchEntry[] {
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

const STATIC = staticEntries();

function useServerSearchIndex(enabled: boolean, query: string): SearchEntry[] {
  const deferred = useDeferredValue(query.trim());
  // 150 ms typing debounce: a keystroke burst is one request
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(deferred), 150);
    return () => clearTimeout(t);
  }, [deferred]);
  const q = useQuery({
    queryKey: ["server", "search", term],
    enabled: enabled && term.length >= 2,
    queryFn: () => serverApi.search.query.query({ q: term }) as Promise<SearchWireResult>,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return useMemo(() => {
    if (!enabled) return EMPTY;
    const dynamic = (q.data?.entries ?? []).map(e => entry(e.kind, e.label, e.href, { sublabel: e.sublabel, weight: e.weight, terms: e.terms, projectId: e.projectId }));
    return [...STATIC, ...dynamic];
  }, [enabled, q.data]);
}

export const useSearchIndex: (enabled: boolean, query?: string) => SearchEntry[] = SERVER_MODE
  ? (useServerSearchIndex as (enabled: boolean, query?: string) => SearchEntry[])
  : (useLocalSearchIndex as (enabled: boolean, query?: string) => SearchEntry[]);
