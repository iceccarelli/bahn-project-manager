/**
 * The `projektLink` column is only sometimes a link.
 *
 * Measured over the shipped data: 138 of 1,298 rows carry something, and only
 * 66 of those parse as an http(s) URL. The other 72 are free-text notes that
 * were typed into the same cell —
 *
 *   "ITK - noch offen; BS - noch offen ; BS an Hr. Engstfeld über"
 *   "BS - lt. PL zurzeit keine Prüfung notwendig, Mieterauftaktge"
 *
 * — and rendering those as an anchor produces a *relative* href, so the tab
 * that opens lands on the app's own 404 page. Three separate places rendered
 * the raw value; this is the one rule they now share.
 */

/** The value as a navigable absolute URL, or null when it is not one. */
export function projectLinkUrl(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    return new URL(v).toString();
  } catch {
    return null;
  }
}

/** The value as a note: present, but not a link. Null when it is a link or empty. */
export function projectLinkNote(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  return projectLinkUrl(v) ? null : v;
}
