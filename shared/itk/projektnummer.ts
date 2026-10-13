/**
 * Projektnummern in the Prüfstelle workbook carry sub-numbers ("G.011500001.01.01"); the project itself is the root
 * ("G.011500001"). Short numbers ("G.01150000") and the "3T190511" form are their own root. Pure; used to link a
 * Prüfbericht to the Projekte search.
 */
export function projektnummerRoot(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const m = /^(G\.\d+)(?:\.\d+)+$/.exec(v);
  return m ? (m[1] as string) : v;
}
