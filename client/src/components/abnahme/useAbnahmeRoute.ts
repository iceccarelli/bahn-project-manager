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

  const { technik, projectId } = useMemo(() => {
    const params = new URLSearchParams(search);
    const t = params.get("technik");
    const p = Number(params.get("project"));
    return {
      technik: isTechnik(t) ? t : DEFAULT_TECHNIK,
      projectId: Number.isInteger(p) && p > 0 ? p : null,
    };
  }, [search]);

  const update = useCallback(
    (changes: { technik?: Technik; projectId?: number | null }) => {
      const params = new URLSearchParams(search);
      if (changes.technik !== undefined) params.set("technik", changes.technik);
      if (changes.projectId !== undefined) {
        if (changes.projectId === null) params.delete("project");
        else params.set("project", String(changes.projectId));
      }
      navigate(`${pathname}?${params.toString()}`, { replace: true });
    },
    [navigate, pathname, search],
  );

  return {
    technik,
    projectId,
    setTechnik: (next: Technik) => update({ technik: next }),
    setProjectId: (next: number | null) => update({ projectId: next }),
  };
}
