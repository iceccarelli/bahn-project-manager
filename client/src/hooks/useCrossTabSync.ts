/**
 * What a second tab knows, and when.
 *
 * ---------------------------------------------------------------------------
 * The defect this closes
 * ---------------------------------------------------------------------------
 * The persistence layer is the reader's own browser: apiClient writes projects,
 * the audit trail and checklist drafts into localStorage. Inside one tab that
 * is airtight — every mutation updates the cache optimistically and then
 * invalidates, so the table, the Gewerk tabs, the Dashboard counters and the
 * Änderungshistorie cannot disagree.
 *
 * Between two tabs of the same browser it was not. localStorage is shared, but
 * TanStack Query's cache is per document: tab A wrote "Zustimmung erteilt",
 * tab B kept showing "offen" — not for a moment, but until it was reloaded.
 * Two people at one desk, or one person with the Dashboard on a second screen,
 * were looking at figures that had already been overwritten, with nothing on
 * screen saying so. That is exactly the drift this project exists to remove.
 *
 * A `storage` event fires only in the *other* documents of the same origin, so
 * the writing tab never hears its own write and there is no loop.
 *
 * ---------------------------------------------------------------------------
 * What this does NOT do, stated plainly
 * ---------------------------------------------------------------------------
 * This is one browser. Two people on two machines still do not see each
 * other's edits, because nothing is written to a server: the client reads
 * /data.json and keeps its changes locally. Real multi-user sync needs the API
 * in server/ deployed against a database, and that is an architectural stage,
 * not a hook. Nothing here should be read as making that claim.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/useDataQuery";

/**
 * Keys whose contents are rendered somewhere. Matched by prefix, so a schema
 * bump (bahn_projects_v3 → v4) keeps working without touching this list.
 */
const WATCHED = ["bahn_projects_v", "bahn_audit_log", "bahn_checklists_v"];

/**
 * Coalescing window. Thirty rapid status changes in one tab produce thirty
 * storage events in the other; refetching once per event would re-read and
 * re-parse the whole 1,298-project store thirty times. One trailing refetch
 * shows the same final state for a fraction of the work.
 */
const COALESCE_MS = 250;

export function useCrossTabSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      timer = null;
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    };

    const onStorage = (event: StorageEvent) => {
      // key === null means the other tab called localStorage.clear(): every
      // watched store is gone at once, and "nothing changed" is the one answer
      // that cannot be right.
      const relevant =
        event.key === null || WATCHED.some((prefix) => event.key?.startsWith(prefix));
      if (!relevant) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(refresh, COALESCE_MS);
    };

    window.addEventListener("storage", onStorage);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [queryClient]);
}
