/**
 * One generation stamp for every document this app produces.
 *
 * Two forms, from one instant:
 *
 *   label()     "22.08.2026, 14:07 Uhr"  — printed in the document
 *   fileStamp() "2026-08-22_1407"        — appended to the filename
 *
 * They come from the same function so a PDF and the file it arrived in can
 * never disagree about when it was made. The Checkliste export used to print
 * only the date, so two exports of the same project on the same day produced
 * two identical filenames and two documents a reader could not tell apart —
 * the second silently overwrote the first in the download folder.
 *
 * Time zone: Europe/Berlin, explicitly. The stamp goes into a document that is
 * filed and read months later, and "14:07" is only meaningful if everyone
 * agrees which 14:07 it is. A browser in another zone would otherwise stamp a
 * different wall-clock time for the same instant. When the runtime has no ICU
 * time-zone data, `Intl` falls back to local time; the label says which zone it
 * used rather than pretending.
 */

const ZONE = "Europe/Berlin";

/** Formatted date and time, for printing inside a document. */
export function generatedLabel(at: Date | string = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "unbekannt";
  const fmt = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ZONE,
  });
  return `${fmt.format(d).replace(", ", ", ")} Uhr`;
}

/**
 * Sortable, filename-safe stamp: `2026-08-22_1407`.
 *
 * Date first so a folder of exports sorts chronologically, and the time
 * included so two exports on one day are two distinct files.
 */
export function fileStamp(at: Date | string = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "unbekannt";
  const parts = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ZONE,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}_${get("hour")}${get("minute")}`;
}

/** Filename-safe fragment: keeps letters, digits, dot and dash. */
export function safeFilePart(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * A document filename with the generation stamp always last.
 *
 * `Projektblatt_G.011540063_Langenselbold_2026-08-22_1407.pdf`
 *
 * Empty parts are dropped rather than leaving `__` in the name.
 */
export function documentFilename(
  kind: string,
  parts: Array<string | null | undefined>,
  at: Date | string = new Date(),
  extension = "pdf",
): string {
  const body = [kind, ...parts.map(safeFilePart)].filter(Boolean).join("_");
  return `${body}_${fileStamp(at)}.${extension}`;
}

/** The line every generated document carries in its footer. */
export function generatedFooter(at: Date | string = new Date(), by?: string | null): string {
  const who = String(by ?? "").trim();
  return who
    ? `Erzeugt am ${generatedLabel(at)} von ${who} · Bahn Project Manager`
    : `Erzeugt am ${generatedLabel(at)} · Bahn Project Manager`;
}
