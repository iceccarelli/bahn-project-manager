/**
 * Client side of the ITK Prüfberichte (server mode only — they are stored in the database, there is no browser-local
 * copy to derive from; the demo build shows none of this). Access is the same rule the server enforces
 * (shared/itk/access.ts); the client uses it only to not offer what it would be refused.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/_core/hooks/useAuth";
import { SERVER_MODE, serverApi } from "@/realtime/serverApi";
import { mayImportPruefberichte, mayViewPruefberichte, type Grant } from "@shared/itk/access";
import type { ListInput, PruefberichtPage } from "@shared/itk/pruefbericht-contract";
import type { PruefberichtView } from "@shared/itk/pruefbericht-view";

export const PRUEFBERICHTE_KEY = ["server", "pruefberichte"] as const;

export function usePruefberichteAccess(): { view: boolean; import: boolean } {
  const { session } = useAuth() as ReturnType<typeof useAuth> & { session?: Grant | null };
  if (!SERVER_MODE || !session) return { view: false, import: false };
  return { view: mayViewPruefberichte(session), import: mayImportPruefberichte(session) };
}

export function usePruefberichtView(enabled = true) {
  return useQuery({
    queryKey: [...PRUEFBERICHTE_KEY, "view"],
    queryFn: () => serverApi.pruefberichte.view.query() as Promise<PruefberichtView>,
    staleTime: 30_000,
    enabled: enabled && SERVER_MODE,
  });
}

export type PruefberichtFilters = Omit<ListInput, "cursor" | "limit">;

export function usePruefberichtList(filters: PruefberichtFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...PRUEFBERICHTE_KEY, "list", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      serverApi.pruefberichte.list.query({ ...filters, limit: 100, ...(pageParam ? { cursor: pageParam } : {}) }) as Promise<PruefberichtPage>,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    enabled: enabled && SERVER_MODE,
  });
}
