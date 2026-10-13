import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";

/**
 * Selected filters live in the URL (`?tab=pdf-codes&technik=ELA&year=2024`): linkable from another tab, reload-safe,
 * back-button friendly — the same arrangement as the Abnahme's Technik and the Jahresansicht's year. Setting a value
 * to "" removes it; every other parameter (notably `tab`) is kept.
 */
export function useUrlParams<K extends string>(names: readonly K[]) {
  const [pathname, navigate] = useLocation();
  const search = useSearch();
  const values = useMemo(() => {
    const p = new URLSearchParams(search);
    return Object.fromEntries(names.map((n) => [n, p.get(n) ?? ""])) as Record<K, string>;
  }, [search, names]);

  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      const p = new URLSearchParams(search);
      for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      navigate(`${pathname}?${p.toString()}`, { replace: true });
    },
    [navigate, pathname, search],
  );
  return { values, set };
}
