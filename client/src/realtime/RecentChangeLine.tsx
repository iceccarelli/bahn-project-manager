import type { RecentChange } from "./projectSyncEngine";

const LABELS: Record<string, string> = {
  projektstand: "Projektstand", station: "Station", projektleiter: "Projektleiter", kommentar: "Kommentar",
  bahnhofsmanagement: "Bahnhofsmanagement", projektbeschreibung: "Beschreibung", eigvEinstufung: "EIGV-Einstufung",
  terminProjektvorstellung: "Termin Projektvorstellung", projektnummer: "Projektnummer",
  bahnhofsnummer: "Bahnhofsnummer", streckennummer: "Streckennummer", projektLink: "Projekt-Link",
};
export const fieldLabel = (f: string) => LABELS[f] ?? f;

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "gerade eben";
  if (s < 60) return `vor ${s} Sekunden`;
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} ${m === 1 ? "Minute" : "Minuten"}`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} ${h === 1 ? "Stunde" : "Stunden"}`;
  const d = Math.round(h / 24);
  return `vor ${d} ${d === 1 ? "Tag" : "Tagen"}`;
}

/** "Projektstand  EP → AP · Markus · vor 2 Sekunden" — the concrete change, never "something changed". */
export function RecentChangeLine({ change, now }: { change: RecentChange; now?: number }) {
  return (
    <p className="text-xs text-muted-foreground" data-testid="recent-change">
      <span className="font-medium">{fieldLabel(change.field)}</span>{" "}
      {change.from ?? "—"} → {change.to ?? "—"} · {change.actorName ?? "Unbekannt"} · {relativeTime(change.at, now)}
    </p>
  );
}
