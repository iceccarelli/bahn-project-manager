import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { isTechnik, type Technik } from "@shared/abnahme/types";

export const DEFAULT_TECHNIK: Technik = "ZIM";

/**
 * The URL is the state of *which* Abnahme is open — `?tab=abnahme&technik=Video&project=12` —
 * so it can be linked from the project dialog, survives a reload and works with
 * the back button. What was answered is not in the URL (see useAbnahmeSession).
 * Unknown values fall back to the default instead of throwing: a stale link must
 * open something usable.
 */
export function useAbnahmeRoute() {
  const [pathname, navigate] = useLocation();
  const search = useSearch();

  const { technik, projectId, pruefberichtId } = useMemo(() => {
    const params = new URLSearchParams(search);
    const t = params.get("technik");
    const p = Number(params.get("project"));
    const r = Number(params.get("pruefbericht"));
    return {
      technik: isTechnik(t) ? t : DEFAULT_TECHNIK,
      projectId: Number.isInteger(p) && p > 0 ? p : null,
      // which of the project's linked Prüfberichte the user chose (only meaningful when several are eligible)
      pruefberichtId: Number.isInteger(r) && r > 0 ? r : null,
    };
  }, [search]);

  const update = useCallback(
    (changes: { technik?: Technik; projectId?: number | null; pruefberichtId?: number | null }) => {
      const params = new URLSearchParams(search);
      if (changes.technik !== undefined) params.set("technik", changes.technik);
      if (changes.projectId !== undefined) {
        if (changes.projectId === null) params.delete("project");
        else params.set("project", String(changes.projectId));
        params.delete("pruefbericht"); // a choice belongs to one project
      }
      if (changes.pruefberichtId !== undefined) {
        if (changes.pruefberichtId === null) params.delete("pruefbericht");
        else params.set("pruefbericht", String(changes.pruefberichtId));
      }
      navigate(`${pathname}?${params.toString()}`, { replace: true });
    },
    [navigate, pathname, search],
  );

  return {
    technik,
    projectId,
    pruefberichtId,
    setTechnik: (next: Technik) => update({ technik: next, pruefberichtId: null }),
    setProjectId: (next: number | null) => update({ projectId: next }),
    setPruefberichtId: (next: number | null) => update({ pruefberichtId: next }),
  };
}
