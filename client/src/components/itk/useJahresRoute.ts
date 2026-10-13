import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";

/** `?year=2023` selects a year, `?year=ohne` the Prüfzeilen without a date, no parameter means all years. */
export type YearSelection = number | "ohne" | "alle";

export function parseYearSelection(raw: string | null): YearSelection {
  if (raw === "ohne") return "ohne";
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : "alle";
}

/** The selected year lives in the URL, like the Abnahme's Technik: linkable, reload-safe, back-button friendly. */
export function useJahresRoute() {
  const [pathname, navigate] = useLocation();
  const search = useSearch();
  const selection = useMemo(() => parseYearSelection(new URLSearchParams(search).get("year")), [search]);

  const select = useCallback(
    (next: YearSelection) => {
      const params = new URLSearchParams(search);
      if (next === "alle") params.delete("year");
      else params.set("year", String(next));
      navigate(`${pathname}?${params.toString()}`, { replace: true });
    },
    [navigate, pathname, search],
  );

  return { selection, select };
}
