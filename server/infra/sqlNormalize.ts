/**
 * SQL twin of `normProjektnummer` (shared/project-identity.ts: upper-case, every whitespace removed). The prefilters that load
 * candidate projects must find exactly what the JavaScript rule calls the same number, or an existing project is invisible to
 * the import / the link candidates and gets duplicated. Covers space, tab, LF, CR, VT, FF and the non-breaking space.
 * `column` is a trusted identifier (never user input).
 */
const STRIP = ["' '", "CHAR(9)", "CHAR(10)", "CHAR(11)", "CHAR(12)", "CHAR(13)", "UNHEX('C2A0')"];

export function pnSql(column: string): string {
  return STRIP.reduce((expr, lit) => `REPLACE(${expr}, ${lit}, '')`, `UPPER(${column})`);
}
